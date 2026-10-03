/*
 * Decides whether the microphone is hearing speech (SPEC.md section 8).
 *
 * Deliberately not voice activity detection. Real VAD -- the sub-band
 * classifier in WebRTC, or the models Meet and Teams now use -- exists to
 * decide whether to transmit someone's voice. This only decides whether to
 * move a mouth, and nothing here records, transmits or interprets what was
 * said, so the accuracy those systems need would be wasted effort.
 *
 * It rejects transients by duration alone, which is the one property that
 * separates them without any analysis: a keystroke or a click lasts 10 to
 * 30ms, a syllable 50 to 300ms. Requiring the level to stay up for longer
 * than a keystroke can discards typing, mouse clicks and knocks, while
 * sustained non-speech -- a fan, music, someone else talking -- still gets
 * through. That is an accepted limit, not an oversight: catching those needs
 * spectral shape or a model, and the mouth moving to background music is a
 * much smaller problem than the mouth chattering as you type.
 *
 * Hangover holds the gate open briefly after the level drops, so the pauses
 * between words do not snap the mouth shut. Every real VAD does the same.
 */

export interface SpeechGateParams {
  /** Energy above this counts toward opening the gate. */
  openLevel: number;
  /** Seconds the level must hold before the gate opens. Longer than a keystroke. */
  onset: number;
  /** Seconds the gate stays open after the level drops, covering word gaps. */
  hangover: number;
}

export const DEFAULT_SPEECH_GATE: SpeechGateParams = {
  openLevel: 0.06,
  onset: 0.07,
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
