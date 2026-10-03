/*
 * Non-causal smoothing: filter using the future as well as the past
 * (SPEC.md 6.1).
 *
 * Holding a few solved poses before rendering buys two things no causal
 * filter can provide. A window centred on the rendered frame has equal past
 * and future, so the smoothing introduces no phase lag -- the cost is a fixed
 * latency instead of a smeared response. And a value that spikes for one
 * frame and returns is unambiguous once a future frame exists, where a causal
 * filter cannot tell it from the start of genuine fast motion and must follow
 * it. A transient 180-degree flip of the palm frame has exactly that shape.
 *
 * The estimator is a per-bone MEDOID: among the buffered rotations, the one
 * closest to all the others. A lone outlier is never closest to anything, so
 * it is discarded outright rather than averaged in, and the output is always a
 * real measured pose rather than a blend of a good one and a bad one. Being
 * non-linear it does not soften genuine fast motion the way a mean would.
 */

import {
  BONE_COUNT,
  createAvatarPose,
  type AvatarPose,
} from "../types.ts";

/** Frames of lookahead the ring buffer is sized for. */
export const MAX_LOOKAHEAD = 3;

export class PoseBuffer {
  /**
   * Frames of future to wait for. 0 passes poses straight through, which is
   * the behaviour before this existed.
   */
  lookahead = 1;

  /** The pose to render. Lags the newest input by `lookahead` frames. */
  readonly output: AvatarPose = createAvatarPose();

  private readonly ring: AvatarPose[] = Array.from(
    { length: MAX_LOOKAHEAD * 2 + 1 },
    () => createAvatarPose(),
  );
  private count = 0;
  private head = 0;

  /** Rolling mean frame interval, for an honest latency readout. */
  private intervalMs = 1000 / 30;
  private lastTimestampMs = -1;

  /** Latency this is currently costing, in milliseconds. */
  get latencyMs(): number {
    return this.lookahead * this.intervalMs;
  }

  /** Number of poses the active window spans. */
  private get windowSize(): number {
    return this.lookahead * 2 + 1;
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
    this.lastTimestampMs = -1;
  }

  /**
   * Accepts a solved pose and updates `output`.
   *
   * Returns false while the window is still filling, during which `output`
   * holds the newest pose unfiltered -- better than rendering nothing for the
   * first frames after startup or a tracking gap.
   */
  push(pose: AvatarPose): boolean {
    if (this.lastTimestampMs >= 0) {
      const dt = pose.timestampMs - this.lastTimestampMs;
      // Ignore absurd gaps from tab restore or a device switch.
      if (dt > 0 && dt < 500) this.intervalMs += (dt - this.intervalMs) * 0.1;
    }
    this.lastTimestampMs = pose.timestampMs;

    if (this.lookahead <= 0) {
      copyPose(this.output, pose);
      return true;
    }

    copyPose(this.ring[this.head] as AvatarPose, pose);
    this.head = (this.head + 1) % this.ring.length;
    this.count = Math.min(this.count + 1, this.ring.length);

    const size = this.windowSize;
    if (this.count < size) {
      copyPose(this.output, pose);
      return false;
    }

    this.writeMedoid(size);
    return true;
  }

  /**
   * Writes the per-bone medoid of the newest `size` poses.
   *
   * Scalars and expressions come from the centre frame rather than being
   * combined. They are already smooth, and the medoid exists to reject
   * rotational outliers specifically.
   */
  private writeMedoid(size: number): void {
    const window: AvatarPose[] = [];
    for (let k = 0; k < size; k++) {
      const idx = (this.head - size + k + this.ring.length * 2) % this.ring.length;
      window.push(this.ring[idx] as AvatarPose);
    }

    const centre = window[(size - 1) / 2 | 0] as AvatarPose;
    this.output.rootOffset.set(centre.rootOffset);
    this.output.confidence = centre.confidence;
    this.output.timestampMs = centre.timestampMs;
    this.output.expressions.clear();
    for (const [k, v] of centre.expressions) this.output.expressions.set(k, v);

    for (let b = 0; b < BONE_COUNT; b++) {
      const o = b * 4;
      let best = 0;
      let bestScore = Infinity;

      for (let i = 0; i < size; i++) {
        const a = (window[i] as AvatarPose).rotations;
        let score = 0;
        for (let j = 0; j < size; j++) {
          if (i === j) continue;
          const c = (window[j] as AvatarPose).rotations;
          // |dot| is the cosine of half the angle between them; maximising it
          // minimises angular distance, and the absolute value handles q
          // and -q being the same rotation.
          const d =
            (a[o] ?? 0) * (c[o] ?? 0) +
            (a[o + 1] ?? 0) * (c[o + 1] ?? 0) +
            (a[o + 2] ?? 0) * (c[o + 2] ?? 0) +
            (a[o + 3] ?? 1) * (c[o + 3] ?? 1);
          score -= Math.abs(d);
        }
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }

      const chosen = (window[best] as AvatarPose).rotations;
      this.output.rotations[o] = chosen[o] ?? 0;
      this.output.rotations[o + 1] = chosen[o + 1] ?? 0;
      this.output.rotations[o + 2] = chosen[o + 2] ?? 0;
      this.output.rotations[o + 3] = chosen[o + 3] ?? 1;
    }
  }
}

function copyPose(dst: AvatarPose, src: AvatarPose): void {
  dst.rotations.set(src.rotations);
  dst.rootOffset.set(src.rootOffset);
  dst.confidence = src.confidence;
  dst.timestampMs = src.timestampMs;
  dst.expressions.clear();
  for (const [k, v] of src.expressions) dst.expressions.set(k, v);
}
