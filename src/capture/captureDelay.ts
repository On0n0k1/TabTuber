/*
 * How long the camera and the browser spent before a frame reached the page.
 *
 * Lives here, on the main thread, rather than on the tracker. It is derived
 * from `VideoFrameCallbackMetadata.captureTime`, which only
 * `requestVideoFrameCallback` supplies -- and once the tracker moves into a
 * worker it has no <video> to call that on, and `VideoFrame.timestamp` is a
 * different clock entirely rather than a substitute (SPEC.md 4.1).
 *
 * The preview element stays on the main thread under every transport, and a
 * frame callback already runs on it to count camera FPS, so the figure costs
 * nothing to keep. That matters because it is the only visibility into the
 * part of the chain nothing downstream can see, and SPEC.md 9.2 budgets
 * latency with it: a PoseFrame is stamped when it is received, so measuring
 * from that stamp misses everything before it -- tens of milliseconds on a
 * USB webcam, and the single largest term.
 */

/** Weight of each new sample. The delay is a property of the device, not of
 *  the frame, and a per-frame value jitters by more than it varies. */
const SMOOTHING = 0.1;

export class CaptureDelay {
  private smoothed = 0;
  private reported = false;

  /**
   * Feed one frame callback.
   *
   * `captureTime` shares performance.now()'s timebase and is populated for
   * camera sources, which is what this always is. Browsers that do not
   * supply it leave the reading unavailable rather than wrong.
   */
  sample(now: DOMHighResTimeStamp, metadata?: VideoFrameCallbackMetadata): void {
    const captureTime = metadata?.captureTime;
    if (captureTime === undefined) return;

    const delay = Math.max(0, now - captureTime);
    this.smoothed = this.reported
      ? this.smoothed + (delay - this.smoothed) * SMOOTHING
      : delay;
    this.reported = true;
  }

  /** 0 when the browser will not say, which the latency readout renders as
   *  a partial figure rather than a smaller one (SPEC.md 9.2). */
  get ms(): number {
    return this.smoothed;
  }

  /** Whether the browser supplies the figure at all. */
  get available(): boolean {
    return this.reported;
  }

  /** A new stream is a new device; the old smoothing does not describe it. */
  reset(): void {
    this.smoothed = 0;
    this.reported = false;
  }
}
