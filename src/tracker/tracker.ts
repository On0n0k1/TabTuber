/*
 * Tracking backend interface and the shared video-driven loop.
 *
 * Two backends exist deliberately (SPEC.md 11). Holistic is the default: it
 * tracks better overall and is the only one supplying real hand landmarks.
 * PoseLandmarker remains selectable as a fallback and as an independent
 * reference -- when a pose looks wrong, switching backends separates "the
 * tracker is struggling" from "this backend is struggling", which a single
 * implementation cannot tell you.
 *
 * Subclasses are the only place MediaPipe types may appear; everything
 * downstream sees PoseFrame.
 */

import { FilesetResolver } from "@mediapipe/tasks-vision";
import type { PoseFrame } from "../types.ts";

export const WASM_PATH = "/mediapipe/wasm";

export type TrackerDelegate = "GPU" | "CPU";
export type PoseFrameHandler = (frame: PoseFrame) => void;

export interface Tracker {
  /** Shown in the panel so the active backend is never ambiguous. */
  readonly name: string;
  readonly ready: boolean;
  readonly delegate: TrackerDelegate;
  /** Inference time only -- not end-to-end pipeline latency. */
  readonly inferenceMs: number;
  /**
   * Camera sensor to frame callback, in ms, or 0 when the browser will not
   * say.
   *
   * The part of the chain nothing downstream can see. A PoseFrame is stamped
   * when the callback runs, so measuring from that stamp misses everything
   * the camera and the browser did before handing the frame over -- which on
   * a USB webcam is tens of milliseconds and the single largest term
   * (SPEC.md 9.2).
   */
  readonly captureDelayMs: number;
  /** Set when inference failed fatally; tracking has stopped. */
  readonly lastError: string | null;
  init(): Promise<void>;
  attach(video: HTMLVideoElement): void;
  detach(): void;
  onFrame(cb: PoseFrameHandler): () => void;
  dispose(): void;
}

interface Closeable {
  close(): void;
}

/** WasmFileset is not exported by tasks-vision, so it is inferred here. */
type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let filesetPromise: Promise<VisionFileset> | null = null;

/** Shared across backends: resolving it twice would fetch the wasm twice. */
export function visionFileset(): Promise<VisionFileset> {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_PATH);
  return filesetPromise;
}

export abstract class VideoTracker<L extends Closeable> implements Tracker {
  abstract readonly name: string;

  protected landmarker: L | null = null;
  private video: HTMLVideoElement | null = null;
  private handle: number | null = null;
  private readonly handlers = new Set<PoseFrameHandler>();

  private delegateInUse: TrackerDelegate = "GPU";
  private lastInferenceMs = 0;
  private lastCaptureDelayMs = 0;
  private failure: string | null = null;
  /** detectForVideo rejects non-monotonic timestamps, and a paused or looped
   *  video can repeat one, so the last value is tracked and nudged past. */
  private lastTimestamp = -1;

  /** Construct the underlying MediaPipe task on the given delegate. */
  protected abstract build(delegate: TrackerDelegate): Promise<L>;

  /** Run inference and convert the result. Return null to emit nothing. */
  protected abstract process(
    landmarker: L,
    video: HTMLVideoElement,
    timestampMs: number,
  ): PoseFrame | null;

  get ready(): boolean {
    return this.landmarker !== null;
  }

  get delegate(): TrackerDelegate {
    return this.delegateInUse;
  }

  get inferenceMs(): number {
    return this.lastInferenceMs;
  }

  get captureDelayMs(): number {
    return this.lastCaptureDelayMs;
  }

  get lastError(): string | null {
    return this.failure;
  }

  async init(): Promise<void> {
    this.failure = null;
    try {
      this.landmarker = await this.build("GPU");
      this.delegateInUse = "GPU";
    } catch (err) {
      // The GPU delegate fails on some drivers and in some headless contexts.
      // CPU is materially slower but keeps the app usable rather than dead.
      console.warn(`${this.name}: GPU delegate unavailable, falling back to CPU`, err);
      this.landmarker = await this.build("CPU");
      this.delegateInUse = "CPU";
    }
  }

  onFrame(cb: PoseFrameHandler): () => void {
    this.handlers.add(cb);
    return () => this.handlers.delete(cb);
  }

  attach(video: HTMLVideoElement): void {
    if (!this.landmarker) throw new Error(`${this.name}: init() must run before attach()`);
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

  private readonly step = (
    now: DOMHighResTimeStamp,
    metadata?: VideoFrameCallbackMetadata,
  ): void => {
    const video = this.video;
    const landmarker = this.landmarker;
    if (!video || !landmarker) return;

    /*
     * `captureTime` shares performance.now()'s timebase and is populated for
     * camera sources, which is what this always is. Smoothed because it is a
     * property of the device rather than of the frame, and a per-frame value
     * jitters by more than it varies.
     *
     * Absent on browsers that do not supply it, in which case the latency
     * readout says so rather than quietly reporting a smaller number.
     */
    const captureTime = metadata?.captureTime;
    if (captureTime !== undefined) {
      const delay = Math.max(0, now - captureTime);
      this.lastCaptureDelayMs = this.lastCaptureDelayMs === 0
        ? delay
        : this.lastCaptureDelayMs + (delay - this.lastCaptureDelayMs) * 0.1;
    }

    // Zero dimensions happen briefly on device switches; inferring on that
    // throws inside wasm rather than returning an empty result.
    if (video.videoWidth > 0) {
      const timestamp = now > this.lastTimestamp ? now : this.lastTimestamp + 1;
      this.lastTimestamp = timestamp;

      const started = performance.now();
      let frame: PoseFrame | null = null;
      try {
        frame = this.process(landmarker, video, timestamp);
      } catch (err) {
        /*
         * A throw here used to kill tracking outright: the callback below
         * never ran, the loop stopped, and the only symptom was a live camera
         * feed driving nothing. Inference failures are reported and the loop
         * is detached deliberately rather than left to die silently.
         *
         * Detaching rather than continuing because these failures are
         * structural -- a graph that cannot open will not open on the next
         * frame either, and retrying would flood the console sixty times a
         * second with the same message.
         */
        this.failure = String(err);
        console.error(`${this.name}: inference failed, tracking stopped`, err);
        this.detach();
        return;
      }
      this.lastInferenceMs = performance.now() - started;

      if (frame) for (const cb of this.handlers) cb(frame);
    }

    this.handle = video.requestVideoFrameCallback(this.step);
  };

  dispose(): void {
    this.detach();
    this.landmarker?.close();
    this.landmarker = null;
    this.handlers.clear();
  }
}
