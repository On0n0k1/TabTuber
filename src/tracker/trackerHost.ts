/*
 * Owns whichever tracking backend is active and swaps between them.
 *
 * Downstream code subscribes once, here, rather than to a backend instance,
 * so switching does not require every consumer to re-register. That is what
 * makes the backend a runtime choice instead of a build-time one, so the
 * non-default backend stays available as a reference and a fallback
 * (SPEC.md 11).
 */

import type { PoseFrame } from "../types.ts";
import type { PoseFrameHandler, Tracker } from "./tracker.ts";

export type TrackerFactory = () => Tracker;

export type TrackerStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly name: string }
  | { readonly kind: "active"; readonly name: string }
  | { readonly kind: "error"; readonly name: string; readonly message: string };

export class TrackerHost {
  private active: Tracker | null = null;
  private video: HTMLVideoElement | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Rising counter so a slow switch cannot overwrite a newer one. */
  private generation = 0;

  private readonly handlers = new Set<PoseFrameHandler>();
  private readonly statusListeners = new Set<(s: TrackerStatus) => void>();
  private status: TrackerStatus = { kind: "idle" };

  /**
   * Inference rate cap, held here rather than on the backend.
   *
   * A backend is replaced whenever the delegate or face tracking changes
   * (see `use`), and a cap that lived only on the instance would silently
   * revert to unthrottled on every one of those switches -- on the device
   * where the cap is the reason the page is usable at all (SPEC.md 9.4).
   */
  private inferenceHz = 0;

  get current(): Tracker | null {
    return this.active;
  }

  get maxInferenceHz(): number {
    return this.inferenceHz;
  }

  set maxInferenceHz(hz: number) {
    this.inferenceHz = hz;
    // The backend clamps; reading it back keeps this from drifting from what
    // is actually in force.
    if (this.active) {
      this.active.maxInferenceHz = hz;
      this.inferenceHz = this.active.maxInferenceHz;
    }
  }

  onFrame(cb: PoseFrameHandler): () => void {
    this.handlers.add(cb);
    return () => this.handlers.delete(cb);
  }

  onStatus(cb: (s: TrackerStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(s: TrackerStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s);
  }

  /** Binds the video that any backend, current or future, attaches to. */
  setVideo(video: HTMLVideoElement | null): void {
    this.video = video;
    if (video && this.active?.ready) this.active.attach(video);
  }

  /**
   * Replaces the active backend. The old one is torn down only once the new
   * one has initialised, so a failed switch leaves tracking running rather
   * than dead.
   */
  async use(name: string, factory: TrackerFactory): Promise<void> {
    const generation = ++this.generation;
    this.setStatus({ kind: "loading", name });

    const next = factory();
    try {
      await next.init();
    } catch (err) {
      next.dispose();
      if (generation === this.generation) {
        this.setStatus({ kind: "error", name, message: String(err) });
      }
      return;
    }

    // A newer switch started while this model was downloading.
    if (generation !== this.generation) {
      next.dispose();
      return;
    }

    this.unsubscribe?.();
    this.active?.dispose();

    this.active = next;
    // Before attach, so the first frame is already throttled.
    next.maxInferenceHz = this.inferenceHz;
    this.unsubscribe = next.onFrame(this.forward);
    if (this.video) next.attach(this.video);

    this.setStatus({ kind: "active", name });
  }

  private readonly forward = (frame: PoseFrame): void => {
    for (const cb of this.handlers) cb(frame);
  };

  dispose(): void {
    this.unsubscribe?.();
    this.active?.dispose();
    this.active = null;
    this.handlers.clear();
    this.statusListeners.clear();
  }
}
