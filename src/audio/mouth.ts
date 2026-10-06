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
  /**
   * Seconds for the mouth to hand back from the voice to the camera.
   *
   * Asymmetric on purpose: the voice takes the mouth INSTANTLY and gives it
   * back slowly. Speech must never lag, so there can be no fade in that
   * direction. Coming back the other way has to be unhurried, because the
   * speech gate can drop for a moment inside a sentence, and a mouth that
   * flicked to the camera and back on every such gap is exactly the lip-sync
   * artefact SPEC.md 13.3 kept the camera away from the mouth to avoid.
   */
  cameraHandover: number;
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
  // Longer than the speech gate's own hangover, so a gap the gate does not
  // absorb still does not reach the mouth.
  cameraHandover: 0.4,
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
  /**
   * How much of the mouth the voice currently owns, 1 to 0.
   *
   * 1 the instant there is something to say, released over cameraHandover
   * once there is not. The camera's contribution is scaled by what is left.
   */
  private voiceShare = 0;
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
  /**
   * `cameraJaw` is how far the camera says the jaw is open, 0 to 1, or null
   * when there is no camera mouth to use.
   *
   * Only the jaw, deliberately. SPEC.md 13.4 measured the blendshape set and
   * found jaw among the robust half and the vowel-shaping ones -- pucker,
   * funnel, stretch -- among the weak. A silent mouth reads as open or shut
   * anyway; nobody lip-reads an avatar, so the shape of a soundless vowel
   * carries almost nothing while being the part most likely to be wrong.
   */
  update(
    energy: number,
    dt: number,
    out: Map<string, number>,
    vowelWeights?: ReadonlyMap<string, number> | null,
    cameraJaw?: number | null,
  ): void {
    for (const v of VISEMES) out.set(v, 0);

    const open = Math.min(1, energy) * this.params.openness;
    const voiced = open > this.params.silence;

    /*
     * How much of the mouth the voice still owns. Straight to 1 when there is
     * something to say, and released over cameraHandover when there is not.
     */
    this.voiceShare = voiced
      ? 1
      : Math.max(0, this.voiceShare - dt / Math.max(this.params.cameraHandover, 1e-4));

    if (voiced) this.writeVoice(open, dt, out, vowelWeights);
    // Reset rather than freeze, so the next utterance does not resume
    // mid-shape from whatever was held when you stopped.
    else this.held = this.hold;

    if (cameraJaw === null || cameraJaw === undefined) return;

    /*
     * The larger of the two, which as the code stands is always the camera's:
     * the voice only writes a viseme on a frame it owns outright, and on any
     * such frame the camera's share is scaled to zero. The two cannot both be
     * non-zero, so this is defensive rather than load-bearing -- and it is
     * the right defence, since a mouth cannot be opened twice and summing
     * would push past the openness ceiling every other path respects.
     */
    const fromCamera = cameraJaw * this.params.openness * (1 - this.voiceShare);
    out.set("aa", Math.max(out.get("aa") ?? 0, fromCamera));
  }

  /** The voice-driven visemes, unchanged by anything the camera does. */
  private writeVoice(
    open: number,
    dt: number,
    out: Map<string, number>,
    vowelWeights?: ReadonlyMap<string, number> | null,
  ): void {
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
