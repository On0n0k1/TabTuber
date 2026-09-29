/*
 * One-euro filter bank for landmark smoothing (SPEC.md section 6).
 *
 * Chosen over a plain low-pass or EMA because it adapts: the cutoff rises
 * with measured speed, so it stays tight during fast motion and smooths hard
 * when still. A fixed low-pass forces a choice between lag and jitter and
 * both are bad for live use.
 *
 * Applied to raw MediaPipe world landmarks, before the coordinate conversion.
 * That keeps filtering independent of the mirror setting -- filtering after
 * conversion would make toggling the mirror look like a sudden jump.
 *
 * Depth gets its own, more aggressive parameters. Monocular z is materially
 * noisier than x and y, and treating all three axes alike means either a
 * jittery depth axis or an over-smoothed lateral one.
 */

export interface OneEuroParams {
  /** Cutoff at rest, Hz. Lower is smoother and laggier. */
  minCutoff: number;
  /** Speed coefficient. Higher follows fast motion more closely. */
  beta: number;
  /** Cutoff for the derivative estimate, Hz. Rarely needs changing. */
  dCutoff: number;
}

export const DEFAULT_XY_PARAMS: OneEuroParams = {
  minCutoff: 1.4,
  beta: 0.06,
  dCutoff: 1,
};

/** Depth is the unreliable axis, so it is filtered harder (SPEC.md 5.5, 6). */
export const DEFAULT_Z_PARAMS: OneEuroParams = {
  minCutoff: 0.7,
  beta: 0.02,
  dCutoff: 1,
};

/** Used for the first frame and whenever a timestamp fails to advance. */
const FALLBACK_DT = 1 / 30;

function smoothingAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Filters a flat array of 3D points in place-free fashion: reads `input`,
 * writes `out`. Both must hold `count * 3` floats.
 */
export class LandmarkFilter {
  enabled = true;
  xy: OneEuroParams = { ...DEFAULT_XY_PARAMS };
  z: OneEuroParams = { ...DEFAULT_Z_PARAMS };

  private readonly count: number;
  private readonly value: Float32Array;
  private readonly derivative: Float32Array;
  private lastTimestampMs = -1;
  private primed = false;

  // Written out rather than declared as a constructor parameter property:
  // node's strip-only TypeScript mode rejects those, and the check scripts
  // run directly under node without a build step.
  constructor(count: number) {
    this.count = count;
    this.value = new Float32Array(count * 3);
    this.derivative = new Float32Array(count * 3);
  }

  /** Call when tracking resumes after a gap, so stale state is not blended in. */
  reset(): void {
    this.primed = false;
    this.lastTimestampMs = -1;
  }

  apply(out: Float32Array, input: Float32Array, timestampMs: number): void {
    if (!this.enabled) {
      out.set(input);
      // Keep state current while bypassed, so re-enabling does not jump from
      // a pose the subject left several seconds ago.
      this.value.set(input);
      this.derivative.fill(0);
      this.primed = true;
      this.lastTimestampMs = timestampMs;
      return;
    }

    if (!this.primed) {
      out.set(input);
      this.value.set(input);
      this.derivative.fill(0);
      this.primed = true;
      this.lastTimestampMs = timestampMs;
      return;
    }

    const elapsed = (timestampMs - this.lastTimestampMs) / 1000;
    // Non-advancing or absurd timestamps happen on tab restore and device
    // switches; a bad dt would otherwise blow the derivative term up.
    const dt = elapsed > 0 && elapsed < 1 ? elapsed : FALLBACK_DT;
    this.lastTimestampMs = timestampMs;

    const aXY = smoothingAlpha(this.xy.dCutoff, dt);
    const aZ = smoothingAlpha(this.z.dCutoff, dt);

    for (let i = 0; i < this.count; i++) {
      const base = i * 3;
      for (let axis = 0; axis < 3; axis++) {
        const k = base + axis;
        const params = axis === 2 ? this.z : this.xy;
        const dAlpha = axis === 2 ? aZ : aXY;

        const x = input[k] ?? 0;
        const prev = this.value[k] ?? 0;

        const rate = (x - prev) / dt;
        const smoothedRate =
          dAlpha * rate + (1 - dAlpha) * (this.derivative[k] ?? 0);
        this.derivative[k] = smoothedRate;

        const cutoff = params.minCutoff + params.beta * Math.abs(smoothedRate);
        const alpha = smoothingAlpha(cutoff, dt);
        const filtered = alpha * x + (1 - alpha) * prev;

        this.value[k] = filtered;
        out[k] = filtered;
      }
    }
  }
}
