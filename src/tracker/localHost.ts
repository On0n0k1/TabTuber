/*
 * The tracker on the main thread, behind the TrackingHost interface.
 *
 * This is what shipped before the worker and it is kept deliberately: 4.1's
 * last "done when" is that a browser which cannot take the worker path still
 * tracks rather than failing. It costs almost nothing to keep, because step
 * 1 made both backends driver-agnostic.
 *
 * The cost of being here is the one the worker exists to remove: inference
 * and rendering share a thread, so an 82ms frame starves the render loop
 * instead of merely tracking slowly (SPEC.md 9.5).
 */

import type { PoseFrameHandler, Tracker } from "./tracker.ts";
import { TrackerHost, type TrackerStatus } from "./trackerHost.ts";
import { IDLE_SNAPSHOT, type TrackingHost } from "./trackingHost.ts";
import type { TrackerConfig, TrackerSnapshot } from "./worker/protocol.ts";

export class LocalTrackingHost implements TrackingHost {
  private readonly host = new TrackerHost();

  readonly offThread = false;

  /**
   * Read straight off the live tracker.
   *
   * No pushing needed on this side -- the getters are right here, and the
   * snapshot exists only so the worker path can offer the same shape.
   */
  get snapshot(): TrackerSnapshot {
    const t = this.host.current;
    if (!t) return { ...IDLE_SNAPSHOT, maxInferenceHz: this.host.maxInferenceHz };
    return {
      backend: t.name,
      delegate: t.ready ? t.delegate : "-",
      ready: t.ready,
      tracksHands: t.tracksHands,
      tracksFace: t.tracksFace,
      inferenceMs: t.inferenceMs,
      lastError: t.lastError,
      maxInferenceHz: this.host.maxInferenceHz,
    };
  }

  get maxInferenceHz(): number {
    return this.host.maxInferenceHz;
  }

  set maxInferenceHz(hz: number) {
    this.host.maxInferenceHz = hz;
  }

  onFrame(cb: PoseFrameHandler): () => void {
    return this.host.onFrame(cb);
  }

  onStatus(cb: (s: TrackerStatus) => void): () => void {
    return this.host.onStatus(cb);
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.host.setVideo(video);
  }

  /**
   * The backends are imported here rather than at the top of the file, so
   * MediaPipe stays out of the main bundle.
   *
   * It would otherwise ship twice: once in the worker chunk, which is a
   * separate build graph and cannot share with this one, and once here for a
   * tier that most browsers never reach. Paying for both on first load would
   * fall hardest on the slow device this whole item exists for
   * (SPEC.md 9.5).
   */
  async use(config: TrackerConfig): Promise<void> {
    const [{ PoseTracker }, { HolisticTracker }] = await Promise.all([
      import("./poseTracker.ts"),
      import("./holisticTracker.ts"),
    ]);
    const factory = (): Tracker =>
      config.backend === "pose"
        ? new PoseTracker({ delegate: config.delegate })
        : new HolisticTracker({
            faceBlendshapes: config.faceBlendshapes,
            delegate: config.delegate,
          });
    await this.host.use(config.backend, factory);
  }

  dispose(): void {
    this.host.dispose();
  }
}
