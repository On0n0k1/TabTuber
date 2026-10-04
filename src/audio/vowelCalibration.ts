/*
 * Guided capture of a speaker's vowel triangle (SPEC.md 8.1).
 *
 * Three sustained vowels, about a second each. `aa`, `ee` and `ou` are the
 * corners of the triangle and every other vowel sits inside it, so `ih` and
 * `oh` are never recorded -- they are derived.
 *
 * Each corner is the MEDIAN of its samples rather than the mean. A held vowel
 * is bracketed by the onset and release of the sound, both of which are
 * spectrally unlike the vowel itself, and a mean would let those drag the
 * corner. A median ignores them.
 */

import type { VowelCalibration, VowelPoint } from "./vowelSpace.ts";

/** The corners actually recorded, in the order they are asked for. */
export const CALIBRATION_STEPS = ["aa", "ee", "ou"] as const;
export type CalibrationStep = (typeof CALIBRATION_STEPS)[number];

/** How each corner is described to the person saying it. */
export const STEP_PROMPTS: Record<CalibrationStep, string> = {
  aa: 'Hold "ahh" as in father',
  ee: 'Hold "eee" as in see',
  ou: 'Hold "ooo" as in boot',
};

/** Seconds of each vowel to capture. */
const CAPTURE_SECONDS = 1.2;
/** Discarded at the start, where the sound is still beginning. */
const SETTLE_SECONDS = 0.3;

export type CalibrationState =
  | { readonly kind: "idle" }
  | { readonly kind: "capturing"; readonly step: CalibrationStep; readonly progress: number }
  | { readonly kind: "done" };

export class VowelCalibrator {
  private stepIndex = 0;
  private elapsed = 0;
  private readonly samples: VowelPoint[] = [];
  private readonly corners: Partial<Record<CalibrationStep, VowelPoint>> = {};
  private status: CalibrationState = { kind: "idle" };

  get state(): CalibrationState {
    return this.status;
  }

  get running(): boolean {
    return this.status.kind === "capturing";
  }

  start(): void {
    this.stepIndex = 0;
    this.elapsed = 0;
    this.samples.length = 0;
    for (const step of CALIBRATION_STEPS) delete this.corners[step];
    this.status = { kind: "capturing", step: CALIBRATION_STEPS[0], progress: 0 };
  }

  cancel(): void {
    this.status = { kind: "idle" };
    this.samples.length = 0;
  }

  /**
   * Feeds one frame. Returns the finished calibration on the frame the last
   * corner completes, and null otherwise.
   *
   * `speaking` gates collection, so a silent pause between prompts neither
   * advances the capture nor contributes a sample of the room.
   */
  update(point: VowelPoint, speaking: boolean, dt: number): VowelCalibration | null {
    if (this.status.kind !== "capturing") return null;
    if (!speaking) return null;

    this.elapsed += dt;
    if (this.elapsed > SETTLE_SECONDS) this.samples.push({ ...point });

    const step = this.status.step;
    this.status = {
      kind: "capturing",
      step,
      progress: Math.min(1, this.elapsed / CAPTURE_SECONDS),
    };
    if (this.elapsed < CAPTURE_SECONDS) return null;

    this.corners[step] = median(this.samples);
    this.samples.length = 0;
    this.elapsed = 0;
    this.stepIndex++;

    const next = CALIBRATION_STEPS[this.stepIndex];
    if (next) {
      this.status = { kind: "capturing", step: next, progress: 0 };
      return null;
    }

    this.status = { kind: "done" };
    return {
      aa: this.corners.aa as VowelPoint,
      ee: this.corners.ee as VowelPoint,
      ou: this.corners.ou as VowelPoint,
    };
  }
}

/** Component-wise median, which the onset and release cannot drag. */
function median(points: readonly VowelPoint[]): VowelPoint {
  if (points.length === 0) return { f1: 500, f2: 1500 };
  const pick = (get: (p: VowelPoint) => number): number => {
    const sorted = points.map(get).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] as number;
  };
  return { f1: pick((p) => p.f1), f2: pick((p) => p.f2) };
}
