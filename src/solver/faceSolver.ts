/*
 * ARKit blendshapes -> VRM expressions and gaze (SPEC.md 13).
 *
 * Three things, of two very different kinds.
 *
 * BLINK and GAZE are direct measurements. The model reports eyelid closure
 * and eye direction, and the avatar has a matching expression and a matching
 * pair of eye bones. Nothing is being decided.
 *
 * EMOTIONS ARE NOT HERE. Inferring them was tried and removed: it has to
 * decide that a smile plus a cheek squint means `happy` at some weight, and
 * that judgement is wrong often enough that an avatar committing to an
 * expression the performer was not making reads worse than one staying
 * neutral. It is also the wrong model of what an expression is for a
 * performer -- a chosen beat rather than a fact about their face -- so it
 * moved to manual control; see ExpressionControl.
 *
 * The mouth is deliberately absent: the microphone keeps it (SPEC.md 13.3).
 * Visual visemes are the noisiest part of a face model and lip sync is what
 * viewers notice most.
 */

import { shape } from "../tracker/faceBlendshapes.ts";

export interface FaceParams {
  /** Master switch; the face graph runs regardless, this is the mapping. */
  enabled: boolean;
  /** Drive blinking from the camera instead of the procedural timer. */
  trackBlink: boolean;
  /** Drive eye direction from the camera. */
  trackGaze: boolean;
  /**
   * Treat blinking as open-or-shut rather than a continuous amount.
   *
   * Blinking is very nearly binary in life, and the tracker's reading is
   * noisy, so interpolating between the two states mostly interpolates
   * between readings of noise -- eyelids that tremble rather than blink. With
   * this on, `blinkLow` and `blinkHigh` become a hysteresis band: below the
   * floor the eye opens, above the ceiling it shuts, and in between it holds
   * whatever it was. A single threshold would chatter whenever the signal sat
   * near it; two with a gap between cannot.
   */
  blinkSnap: boolean;
  /**
   * Seconds for the eyelid to travel once the state flips.
   *
   * Not zero: an instantaneous jump reads as a glitch rather than a blink. A
   * real eyelid closes in roughly 50 to 100ms.
   */
  blinkSpeed: number;
  /**
   * Blendshape value below which the eye is open.
   *
   * Continuous mode clamps anything lower to zero so a resting face does not
   * sit with its eyelids lowered; snap mode treats it as the lower edge of
   * the hysteresis band.
   */
  blinkLow: number;
  /**
   * Blendshape value treated as eyes fully shut.
   *
   * MediaPipe's eyeBlink scores rarely reach 1 even with eyes firmly closed
   * -- 0.4 to 0.7 is typical, varying with lighting and head angle -- so
   * passing them through unchanged leaves the eyelids at half mast. Watch the
   * Face readout while blinking and set this to the peak actually reported.
   */
  blinkHigh: number;
  /** Degrees of eye rotation at full deflection. */
  gazeRange: number;
}

export const DEFAULT_FACE_PARAMS: FaceParams = {
  enabled: true,
  trackBlink: true,
  trackGaze: true,
  blinkSnap: true,
  blinkSpeed: 0.06,
  blinkLow: 0.15,
  blinkHigh: 0.55,
  gazeRange: 18,
};

export interface GazeAngles {
  /** Degrees, positive to the subject's left. */
  yaw: number;
  /** Degrees, positive up. */
  pitch: number;
}

export class FaceSolver {
  params: FaceParams = { ...DEFAULT_FACE_PARAMS };

  readonly gaze: GazeAngles = { yaw: 0, pitch: 0 };
  /** Raw reported blink, before remapping; shown so the range can be set from data. */
  readonly rawBlink = { left: 0, right: 0 };

  /** Latched open/shut state per eye, and the eyelid's travel toward it. */
  private readonly shut = { left: false, right: false };
  private readonly lid = { left: 0, right: 0 };

  /** True while blink is being driven from the camera rather than the timer. */
  get drivingBlink(): boolean {
    return this.params.enabled && this.params.trackBlink;
  }

  /**
   * Writes expression weights into `out` and updates `gaze`.
   *
   * `mirrored` swaps left and right. The subject's left eye appears on the
   * displayed right, exactly as for the body (SPEC.md 5.1), and blinking the
   * wrong eye is the kind of error nobody notices until they watch a replay.
   */
  update(scores: Float32Array, mirrored: boolean, dt: number, out: Map<string, number>): void {
    if (!this.params.enabled) return;

    const L = mirrored ? "Right" : "Left";
    const R = mirrored ? "Left" : "Right";

    if (this.params.trackBlink) {
      this.rawBlink.left = shape(scores, `eyeBlink${L}` as "eyeBlinkLeft");
      this.rawBlink.right = shape(scores, `eyeBlink${R}` as "eyeBlinkRight");
      out.set("blinkLeft", this.eyelid("left", this.rawBlink.left, dt));
      out.set("blinkRight", this.eyelid("right", this.rawBlink.right, dt));
      // `blink` would double up with the per-eye expressions on a model that
      // defines all three, closing the eyes twice over.
      out.set("blink", 0);
    }

    if (this.params.trackGaze) {
      // Each direction is reported per eye; averaging the pair is steadier
      // than either alone and the eyes move together in any case.
      const up = avg(shape(scores, "eyeLookUpLeft"), shape(scores, "eyeLookUpRight"));
      const down = avg(shape(scores, "eyeLookDownLeft"), shape(scores, "eyeLookDownRight"));
      const inward = avg(shape(scores, `eyeLookIn${L}` as "eyeLookInLeft"), shape(scores, `eyeLookIn${R}` as "eyeLookInRight"));
      const outward = avg(shape(scores, `eyeLookOut${L}` as "eyeLookOutLeft"), shape(scores, `eyeLookOut${R}` as "eyeLookOutRight"));

      const range = this.params.gazeRange;
      // In and out are opposite directions for the two eyes, so the signed
      // combination is what carries horizontal direction.
      this.gaze.yaw = (inward - outward) * range * (mirrored ? -1 : 1);
      this.gaze.pitch = (up - down) * range;
    }
  }

  /**
   * One eyelid's position, 0 open to 1 shut.
   *
   * In snap mode the decision is latched with hysteresis and the lid travels
   * toward it, so noise inside the band cannot move the eye at all. In
   * continuous mode the reading is stretched onto the full range instead.
   */
  private eyelid(side: "left" | "right", raw: number, dt: number): number {
    if (!this.params.blinkSnap) {
      this.lid[side] = this.remapBlink(raw);
      this.shut[side] = this.lid[side] > 0.5;
      return this.lid[side];
    }

    if (raw >= this.params.blinkHigh) this.shut[side] = true;
    else if (raw <= this.params.blinkLow) this.shut[side] = false;
    // Between the two the state is held, which is the whole point.

    const target = this.shut[side] ? 1 : 0;
    const speed = this.params.blinkSpeed;
    if (speed <= 0) {
      this.lid[side] = target;
    } else {
      // Linear rather than exponential: an eyelid travels at a rate and
      // arrives, where an exponential approach never quite closes.
      const step = dt / speed;
      this.lid[side] = target > this.lid[side]
        ? Math.min(target, this.lid[side] + step)
        : Math.max(target, this.lid[side] - step);
    }
    return this.lid[side];
  }

  /**
   * Stretches the reported range onto a full close.
   *
   * Not a gain: a plain multiplier would lift the resting value too, leaving
   * the avatar permanently squinting. A floor and a ceiling keep open eyes
   * fully open while letting a partial reading still shut them.
   */
  private remapBlink(value: number): number {
    const { blinkLow, blinkHigh } = this.params;
    if (blinkHigh <= blinkLow) return value;
    return Math.min(1, Math.max(0, (value - blinkLow) / (blinkHigh - blinkLow)));
  }
}

function avg(a: number, b: number): number {
  return (a + b) * 0.5;
}

