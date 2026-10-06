/*
 * Drives the avatar's mouth from microphone energy (SPEC.md section 8).
 *
 * Two modes, because amplitude and shape are different problems.
 *
 * AMPLITUDE maps energy straight to the `aa` viseme. It is honest -- the
 * mouth opens exactly as far as you are loud -- but the shape never varies,
 * so it reads as a mouth pulsing rather than speaking.
 *
 * ANIMATED keeps that envelope and adds plausible shape: a viseme cycle at
 * speech rate, scaled by the same energy. It does not know which phoneme you
 * said and does not try to; what a viewer registers is that the mouth is
 * closed when silent, opens as far as you are loud, and articulates while it
 * does. Real phoneme detection would be the alternative, and a wrong viseme
 * looks worse than a plain open mouth.
 *
 * Both are driven by the same energy signal, so silence closes the mouth in
 * either mode. That matters more than shape: a mouth that keeps moving after
 * you stop talking is the one thing an audience notices immediately.
 */

/** VRM 1.0 preset visemes this drives. */
export const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type Viseme = (typeof VISEMES)[number];

/**
 * `vowel` blends the five visemes by where the voice sits in the speaker's
 * own calibrated vowel space (SPEC.md 8.1). It falls back to `animated` when
 * no calibration exists, since without one there is no space to place
 * anything in.
 */
export type MouthMode = "amplitude" | "animated" | "vowel";

export interface MouthParams {
  mode: MouthMode;
  /** Ceiling on how far the mouth opens, 0 to 1. */
  openness: number;
  /** Shortest and longest a single viseme is held, seconds. */
  minHold: number;
  maxHold: number;
  /** Below this energy the mouth is treated as closed and the cycle resets. */
  silence: number;
}

export const DEFAULT_MOUTH_PARAMS: MouthParams = {
  mode: "amplitude",
  openness: 0.9,
  // Speech runs at roughly four to seven phonemes a second, so a viseme lasts
  // on the order of 150ms. Randomised within that range, since a fixed period
  // reads as metronomic.
  minHold: 0.09,
  maxHold: 0.2,
  silence: 0.04,
};

/**
 * Weighting of the viseme cycle.
 *
 * Open shapes are commoner than rounded ones in ordinary speech, and a cycle
 * that visited all five equally would look like someone enunciating vowels
 * rather than talking.
 */
const VISEME_WEIGHTS: Record<Viseme, number> = {
  aa: 0.34,
  ih: 0.24,
  ee: 0.18,
  oh: 0.14,
  ou: 0.1,
};

export class Mouth {
  params: MouthParams = { ...DEFAULT_MOUTH_PARAMS };

  private current: Viseme = "aa";
  private next: Viseme = "ih";
  private held = 0;
  private hold = 0.12;

  constructor() {
    this.hold = this.nextHold();
  }

  private nextHold(): number {
    const { minHold, maxHold } = this.params;
    return minHold + Math.random() * Math.max(0, maxHold - minHold);
  }

  private pickViseme(): Viseme {
    let r = Math.random();
    for (const v of VISEMES) {
      r -= VISEME_WEIGHTS[v];
      if (r <= 0) return v;
    }
    return "aa";
  }

  /**
   * Advances the cycle and writes viseme weights into `out`.
   *
   * `vowelWeights`, when supplied, holds the calibrated blend for the current
   * frame; `vowel` mode scales it by the envelope and uses it in place of the
   * cycle. Without it, `vowel` behaves as `animated`.
   */
  update(
    energy: number,
    dt: number,
    out: Map<string, number>,
    vowelWeights?: ReadonlyMap<string, number> | null,
  ): void {
    for (const v of VISEMES) out.set(v, 0);

    const open = Math.min(1, energy) * this.params.openness;
    if (open <= this.params.silence) {
      // Reset rather than freeze, so the next utterance does not resume
      // mid-shape from whatever was held when you stopped.
      this.held = this.hold;
      return;
    }

    if (this.params.mode === "amplitude") {
      out.set("aa", open);
      return;
    }

    if (this.params.mode === "vowel" && vowelWeights) {
      // Weights already sum to 1, so scaling by the envelope keeps the mouth
      // from opening wider than the voice is loud -- the same invariant the
      // crossfade below maintains.
      for (const v of VISEMES) out.set(v, (vowelWeights.get(v) ?? 0) * open);
      return;
    }

    this.held += dt;
    if (this.held >= this.hold) {
      this.held = 0;
      this.hold = this.nextHold();
      this.current = this.next;
      this.next = this.pickViseme();
    }

    // Crossfade between consecutive visemes rather than switching, or the
    // mouth snaps between shapes at the hold rate.
    const t = Math.min(1, this.held / Math.max(this.hold, 1e-4));
    out.set(this.current, open * (1 - t));
    out.set(this.next, open * t);
  }
}
