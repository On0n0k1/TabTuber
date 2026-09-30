/*
 * Owns whichever tracking backend is active and swaps between them.
 *
 * Downstream code subscribes once, here, rather than to a backend instance,
 * so switching does not require every consumer to re-register. That is what
 * makes the backend a runtime choice instead of a build-time one -- the point
 * being to compare Holistic's body tracking against PoseLandmarker's directly
 * and keep a rollback (SPEC.md 5.6).
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

  get current(): Tracker | null {
    return this.active;
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
