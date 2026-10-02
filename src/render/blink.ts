/*
 * Procedural blinking (SPEC.md section 8).
 *
 * Nothing tracks the face, so without this the avatar stares. It is the
 * highest ratio of aliveness to code in the project, which is why it is here
 * well before face tracking.
 *
 * Runs at render rate rather than tracker rate: a blink is around 120ms, so
 * at 30Hz it would land on three or four samples and read as a stutter.
 */

/** VRM 1.0 preset expression name. */
export const BLINK_EXPRESSION = "blink";

export interface BlinkParams {
  enabled: boolean;
  /** Shortest and longest gap between blinks, seconds. */
  minInterval: number;
  maxInterval: number;
  /** One close-and-open, seconds. */
  duration: number;
  /** Chance a blink is immediately followed by a second one. */
  doubleChance: number;
}

export const DEFAULT_BLINK_PARAMS: BlinkParams = {
  enabled: true,
  minInterval: 2.6,
  maxInterval: 6.5,
  duration: 0.13,
  doubleChance: 0.18,
};

export class Blink {
  params: BlinkParams = { ...DEFAULT_BLINK_PARAMS };

  private timer = 0;
  private phase = 0;
  private closing = false;
  private queued = 0;

  constructor() {
    this.timer = this.nextInterval();
  }

  private nextInterval(): number {
    const { minInterval, maxInterval } = this.params;
    return minInterval + Math.random() * Math.max(0, maxInterval - minInterval);
  }

  /** Returns the eyelid weight for this frame, 0 open to 1 closed. */
  update(dt: number): number {
    if (!this.params.enabled) return 0;

    if (this.closing) {
      this.phase += dt / Math.max(0.01, this.params.duration);
      if (this.phase >= 1) {
        this.closing = false;
        this.phase = 0;
        // A queued double blink follows immediately; otherwise wait again.
        this.timer = this.queued > 0 ? 0 : this.nextInterval();
        if (this.queued > 0) this.queued--;
      }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.closing = true;
        this.phase = 0;
        if (this.queued === 0 && Math.random() < this.params.doubleChance) {
          this.queued = 1;
        }
      }
    }

    if (!this.closing) return 0;
    // Sine over the half period: closes and opens smoothly, and never
    // overshoots the way an eased triangle can.
    return Math.sin(this.phase * Math.PI);
  }
}
