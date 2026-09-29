/*
 * Rolling frame-rate meter.
 *
 * Averaged over a window rather than reported per frame: an instantaneous
 * 1/dt reading fluctuates far too much to read while tuning, which is the
 * only reason this exists.
 */

const WINDOW_MS = 500;

export class FpsMeter {
  private frames = 0;
  private windowStart = performance.now();
  private current = 0;

  /** Call once per event being measured. */
  tick(now = performance.now()): void {
    this.frames++;
    const span = now - this.windowStart;
    if (span >= WINDOW_MS) {
      this.current = (this.frames * 1000) / span;
      this.frames = 0;
      this.windowStart = now;
    }
  }

  get fps(): number {
    return this.current;
  }

  /** Reports 0 rather than a stale value once ticks stop arriving. */
  staleAfter(ms: number, now = performance.now()): number {
    return now - this.windowStart > ms ? 0 : this.current;
  }
}
