/*
 * Decouples rendering from the tracking rate (SPEC.md section 4).
 *
 * Tracking delivers roughly 30 poses a second; the stage renders at 60 or
 * more. Applying a solved pose only when one arrives makes motion visibly
 * stepped, so the renderer instead eases toward the newest solved pose every
 * frame. This is a large share of perceived smoothness and is independent of
 * the one-euro filter: the filter decides what the pose is, this decides how
 * quickly the avatar gets there.
 *
 * Easing is exponential with a time constant, so the result does not change
 * with frame rate -- a 144Hz display converges in the same wall-clock time as
 * a 60Hz one, which a fixed per-frame fraction would not.
 */

import {
  BONE_COUNT,
  createAvatarPose,
  type AvatarPose,
} from "../types.ts";
import { quat, slerp, type Q4 } from "../solver/math.ts";

export class PoseInterpolator {
  /** Read this, not the solver's output, when applying to a rig. */
  readonly current: AvatarPose = createAvatarPose();

  enabled = true;
  /**
   * Seconds to close roughly 63% of the remaining gap. Around one tracker
   * interval is a sensible starting point; lower is snappier and jitterier.
   */
  tau = 0.05;

  private readonly target: AvatarPose = createAvatarPose();
  private readonly a: Q4 = quat();
  private readonly b: Q4 = quat();
  private readonly out: Q4 = quat();

  /** Copies the solved pose, which is reused by the solver each frame. */
  setTarget(pose: AvatarPose): void {
    this.target.rotations.set(pose.rotations);
    this.target.rootOffset.set(pose.rootOffset);
    this.target.confidence = pose.confidence;
    this.target.timestampMs = pose.timestampMs;

    this.target.expressions.clear();
    for (const [k, v] of pose.expressions) this.target.expressions.set(k, v);

    if (!this.enabled) this.snap();
  }

  /** Jumps straight to the target, skipping easing. */
  snap(): void {
    this.current.rotations.set(this.target.rotations);
    this.current.rootOffset.set(this.target.rootOffset);
    this.current.confidence = this.target.confidence;
    this.current.timestampMs = this.target.timestampMs;
    this.current.expressions.clear();
    for (const [k, v] of this.target.expressions) this.current.expressions.set(k, v);
  }

  /** Call once per rendered frame. */
  step(dt: number): void {
    if (!this.enabled) return;

    // Frame-rate independent: the fraction closed depends on elapsed time,
    // not on how many frames happened to be drawn.
    const alpha = this.tau <= 0 ? 1 : Math.min(1, 1 - Math.exp(-dt / this.tau));

    for (let i = 0; i < BONE_COUNT; i++) {
      const o = i * 4;
      this.a[0] = this.current.rotations[o] ?? 0;
      this.a[1] = this.current.rotations[o + 1] ?? 0;
      this.a[2] = this.current.rotations[o + 2] ?? 0;
      this.a[3] = this.current.rotations[o + 3] ?? 1;

      this.b[0] = this.target.rotations[o] ?? 0;
      this.b[1] = this.target.rotations[o + 1] ?? 0;
      this.b[2] = this.target.rotations[o + 2] ?? 0;
      this.b[3] = this.target.rotations[o + 3] ?? 1;

      slerp(this.out, this.a, this.b, alpha);
      this.current.rotations[o] = this.out[0];
      this.current.rotations[o + 1] = this.out[1];
      this.current.rotations[o + 2] = this.out[2];
      this.current.rotations[o + 3] = this.out[3];
    }

    for (let i = 0; i < 3; i++) {
      const from = this.current.rootOffset[i] ?? 0;
      const to = this.target.rootOffset[i] ?? 0;
      this.current.rootOffset[i] = from + (to - from) * alpha;
    }

    this.current.confidence +=
      (this.target.confidence - this.current.confidence) * alpha;

    // Expressions are driven procedurally at render rate, so they are taken
    // as-is rather than eased a second time.
    for (const [k, v] of this.target.expressions) {
      this.current.expressions.set(k, v);
    }
  }
}
