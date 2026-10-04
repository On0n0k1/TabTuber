/*
 * Decides whether the microphone is hearing speech (SPEC.md section 8).
 *
 * Deliberately minimal. Noise rejection belongs at the microphone -- a
 * noise-cancelling headset or a decent directional mic solves it better than
 * any envelope follower can, and solves it for every application rather than
 * just this one. Trying to do it here would cost latency on every utterance
 * to fix a problem the hardware already fixes.
 *
 * So this rejects one thing: transients far too brief to be speech. A
 * keystroke lasts 10 to 30ms, a syllable 50 to 300, and the threshold sits
 * between them -- low enough that it barely delays the mouth, high enough to
 * discard typing and clicks. Everything else is the microphone's job.
 *
 * Set `onset` to 0 to disable it entirely.
 *
 * Hangover holds the gate open briefly after the level drops, so the pauses
 * between words do not snap the mouth shut. That costs nothing: it only ever
 * extends how long the mouth stays open.
 */

export interface SpeechGateParams {
  /** Energy above this counts toward opening the gate. */
  openLevel: number;
  /**
   * Seconds the level must hold before the gate opens. Longer than a
   * keystroke, shorter than a syllable. 0 disables the gate.
   */
  onset: number;
  /** Seconds the gate stays open after the level drops, covering word gaps. */
  hangover: number;
}

export const DEFAULT_SPEECH_GATE: SpeechGateParams = {
  openLevel: 0.06,
  // Comfortably above a keystroke, comfortably below a syllable, and half the
  // delay the previous value cost. Lower it further, to 0, if the microphone
  // is already handling noise.
  onset: 0.04,
  hangover: 0.18,
};

export class SpeechGate {
  params: SpeechGateParams = { ...DEFAULT_SPEECH_GATE };

  private above = 0;
  private below = 0;
  private open = false;

  get speaking(): boolean {
    return this.open;
  }

  reset(): void {
    this.above = 0;
    this.below = 0;
    this.open = false;
  }

  /** Returns `energy` while the gate is open, and 0 while it is shut. */
  update(energy: number, dt: number): number {
    if (energy > this.params.openLevel) {
      this.above += dt;
      this.below = 0;
    } else {
      this.below += dt;
      this.above = 0;
    }

    if (!this.open && this.above >= this.params.onset) this.open = true;
    else if (this.open && this.below >= this.params.hangover) this.open = false;

    return this.open ? energy : 0;
  }
}
