/*
 * MediaPipe PoseLandmarker driver.
 *
 * This is the only module allowed to know MediaPipe types. Everything
 * downstream sees PoseFrame (SPEC.md section 4), so swapping the tracking
 * backend later touches nothing else.
 *
 * Detection is driven by requestVideoFrameCallback rather than rAF. That runs
 * inference exactly once per delivered camera frame: rAF at 60Hz against a
 * 30Hz camera would infer twice on half the frames, doubling GPU cost for
 * identical results.
 */

import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { LANDMARK_COUNT, type PoseFrame } from "../types.ts";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/pose_landmarker_full.task";

export type TrackerDelegate = "GPU" | "CPU";

export interface PoseTrackerOptions {
  /** Raised from the 0.5 default: a confident miss is better than a confident
   *  hallucination, which is what low thresholds produce on occluded limbs. */
  readonly minPoseDetectionConfidence?: number;
  readonly minPosePresenceConfidence?: number;
  readonly minTrackingConfidence?: number;
}

export type PoseFrameHandler = (frame: PoseFrame) => void;

export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private handle: number | null = null;
  private readonly handlers = new Set<PoseFrameHandler>();

  private delegateInUse: TrackerDelegate = "GPU";
  private lastInferenceMs = 0;
  /** detectForVideo rejects non-monotonic timestamps, and a paused or looped
   *  video can repeat one, so the last value is tracked and nudged past. */
  private lastTimestamp = -1;

  // Reused across frames: at 30Hz, allocating three typed arrays per frame is
  // pure garbage-collector pressure for no benefit.
  private readonly world = new Float32Array(LANDMARK_COUNT * 3);
  private readonly image = new Float32Array(LANDMARK_COUNT * 3);
  private readonly visibility = new Float32Array(LANDMARK_COUNT);

  get delegate(): TrackerDelegate {
    return this.delegateInUse;
  }

  /** Inference time only -- not end-to-end pipeline latency. */
  get inferenceMs(): number {
    return this.lastInferenceMs;
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  async init(opts: PoseTrackerOptions = {}): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

    const build = (delegate: TrackerDelegate): Promise<PoseLandmarker> =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: opts.minPoseDetectionConfidence ?? 0.6,
        minPosePresenceConfidence: opts.minPosePresenceConfidence ?? 0.6,
        minTrackingConfidence: opts.minTrackingConfidence ?? 0.6,
      });

    try {
      this.landmarker = await build("GPU");
      this.delegateInUse = "GPU";
    } catch (err) {
      // The GPU delegate fails on some drivers and in some headless contexts.
      // CPU is materially slower but keeps the app usable rather than dead.
      console.warn("pose tracker: GPU delegate unavailable, falling back to CPU", err);
      this.landmarker = await build("CPU");
      this.delegateInUse = "CPU";
    }
  }

  onFrame(cb: PoseFrameHandler): () => void {
    this.handlers.add(cb);
    return () => this.handlers.delete(cb);
  }

  attach(video: HTMLVideoElement): void {
    if (!this.landmarker) throw new Error("PoseTracker.init() must run before attach()");
    if (!("requestVideoFrameCallback" in video)) {
      throw new Error("requestVideoFrameCallback is unavailable in this browser");
    }
    this.detach();
    this.video = video;
    this.handle = video.requestVideoFrameCallback(this.step);
  }

  detach(): void {
    if (this.video && this.handle !== null) {
      this.video.cancelVideoFrameCallback(this.handle);
    }
    this.video = null;
    this.handle = null;
  }

  private readonly step = (now: DOMHighResTimeStamp): void => {
    const video = this.video;
    const landmarker = this.landmarker;
    if (!video || !landmarker) return;

    // Zero dimensions happen briefly on device switches; inferring on that
    // throws inside wasm rather than returning an empty result.
    if (video.videoWidth > 0) {
      const timestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
      this.lastTimestamp = timestamp;

      const started = performance.now();
      const result = landmarker.detectForVideo(video, timestamp);
      this.lastInferenceMs = performance.now() - started;

      const frame = this.toFrame(result, timestamp);
      if (frame) for (const cb of this.handlers) cb(frame);
    }

    this.handle = video.requestVideoFrameCallback(this.step);
  };

  private toFrame(
    result: PoseLandmarkerResult,
    timestampMs: number,
  ): PoseFrame | null {
    const world = result.worldLandmarks[0];
    const image = result.landmarks[0];
    if (!world || !image) return null;

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const w = world[i];
      const p = image[i];
      if (!w || !p) continue;

      const o = i * 3;
      this.world[o] = w.x;
      this.world[o + 1] = w.y;
      this.world[o + 2] = w.z;

      this.image[o] = p.x;
      this.image[o + 1] = p.y;
      this.image[o + 2] = p.z;

      // tasks-vision declares visibility as a required number, so this is
      // populated in practice. The fallback only guards a malformed result,
      // and defaults to trusting the landmark rather than gating it off.
      this.visibility[i] = p.visibility ?? 1;
    }

    return {
      world: this.world,
      image: this.image,
      visibility: this.visibility,
      timestampMs,
    };
  }

  dispose(): void {
    this.detach();
    this.landmarker?.close();
    this.landmarker = null;
    this.handlers.clear();
  }
}
