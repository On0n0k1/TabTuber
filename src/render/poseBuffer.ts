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
 * The estimator is a per-bone ROBUST AVERAGE: find the medoid, reject samples
 * too far from it to be real movement, then average what remains.
 *
 * Both halves are necessary and a medoid alone is not enough. A medoid picks
 * one real sample, so it carries that sample's full noise -- it has no
 * averaging power at all. Worse, when the subject holds still every sample is
 * equidistant from the others and the choice falls to noise: measured across
 * 22 bones with a window of seven, the bones selected 6.75 distinct samples
 * per frame and never once agreed. Each bone was rendering a different moment,
 * re-rolled every frame, which reads as stuttering and gets worse with a
 * larger window.
 *
 * Averaging alone is not enough either: a single 180-degree outlier in a
 * window of seven drags the mean about 26 degrees off.
 *
 * Rejecting first and averaging after gives both -- noise falls as the square
 * root of the window when still, and outliers never enter the sum. On
 * constant-velocity motion the mean of the window equals its middle sample,
 * so steady movement passes through delayed but undistorted; only
 * acceleration is softened, which is wanted.
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
   * the behaviour before this existed, and is the default.
   *
   * Off by default because its price is a tracker frame interval per frame,
   * and that interval is not a constant. A webcam lengthens its exposure in
   * dim light and drops its frame rate to suit, so the same setting cost
   * 66ms in good light and 190ms in a dim room -- measured at 95ms per frame
   * against an inference time of 8 to 15ms, meaning the pipeline was idle
   * most of the time and the buffer was most of the latency.
   *
   * That is the wrong shape for a default: it is cheapest when everything is
   * already fine and most expensive exactly when the pipeline is struggling.
   * Spike rejection is worth having on a fast camera, so the control stays;
   * it is opt-in, and the Stats readout prices it in milliseconds so the cost
   * is visible before it is paid (SPEC.md 6.1).
   */
  lookahead = 0;

  /**
   * How far a sample may sit from the window's medoid and still be averaged
   * in, in degrees.
   *
   * Anatomical rather than tuned: a joint cannot rotate much beyond 20
   * degrees in a 33ms frame, so anything past this is not movement. Being
   * grounded in human range it transfers across users (SPEC.md 12.1).
   */
  outlierDegrees = 25;

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

    const cosLimit = Math.cos((this.outlierDegrees * Math.PI) / 360);

    for (let b = 0; b < BONE_COUNT; b++) {
      const o = b * 4;

      // 1. Medoid: the sample closest to all the others, used only as a
      //    reference for what counts as an outlier. Its own noise does not
      //    reach the output.
      let ref = 0;
      let bestScore = Infinity;
      for (let i = 0; i < size; i++) {
        const a = (window[i] as AvatarPose).rotations;
        let score = 0;
        for (let j = 0; j < size; j++) {
          if (i === j) continue;
          score -= Math.abs(dot4(a, (window[j] as AvatarPose).rotations, o));
        }
        if (score < bestScore) {
          bestScore = score;
          ref = i;
        }
      }
      const refRot = (window[ref] as AvatarPose).rotations;

      // 2. Average the inliers. Signs are aligned to the reference first,
      //    since q and -q are the same rotation but cancel if summed blindly.
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let sw = 0;
      for (let i = 0; i < size; i++) {
        const a = (window[i] as AvatarPose).rotations;
        const d = dot4(a, refRot, o);
        if (Math.abs(d) < cosLimit) continue;
        const sign = d < 0 ? -1 : 1;
        sx += (a[o] ?? 0) * sign;
        sy += (a[o + 1] ?? 0) * sign;
        sz += (a[o + 2] ?? 0) * sign;
        sw += (a[o + 3] ?? 1) * sign;
      }

      // Normalising the sum is nlerp; over a window this short the difference
      // from a true spherical mean is far below anything visible.
      const len = Math.hypot(sx, sy, sz, sw);
      if (len < 1e-8) {
        this.output.rotations[o] = refRot[o] ?? 0;
        this.output.rotations[o + 1] = refRot[o + 1] ?? 0;
        this.output.rotations[o + 2] = refRot[o + 2] ?? 0;
        this.output.rotations[o + 3] = refRot[o + 3] ?? 1;
        continue;
      }
      this.output.rotations[o] = sx / len;
      this.output.rotations[o + 1] = sy / len;
      this.output.rotations[o + 2] = sz / len;
      this.output.rotations[o + 3] = sw / len;
    }
  }
}

/** Quaternion dot product of bone `o` in two rotation buffers. */
function dot4(a: Float32Array, b: Float32Array, o: number): number {
  return (
    (a[o] ?? 0) * (b[o] ?? 0) +
    (a[o + 1] ?? 0) * (b[o + 1] ?? 0) +
    (a[o + 2] ?? 0) * (b[o + 2] ?? 0) +
    (a[o + 3] ?? 1) * (b[o + 3] ?? 1)
  );
}

function copyPose(dst: AvatarPose, src: AvatarPose): void {
  dst.rotations.set(src.rotations);
  dst.rootOffset.set(src.rootOffset);
  dst.confidence = src.confidence;
  dst.timestampMs = src.timestampMs;
  dst.expressions.clear();
  for (const [k, v] of src.expressions) dst.expressions.set(k, v);
}
