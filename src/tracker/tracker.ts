/*
 * Tracking backend interface, the shared landmarker base, and the
 * video-driven loop built on it.
 *
 * Two backends exist deliberately (SPEC.md 11). Holistic is the default: it
 * tracks better overall and is the only one supplying real hand landmarks.
 * PoseLandmarker is body-only and exists for one reason -- Holistic is
 * unaffordable on a slow device. It was removed once, as a diagnostic
 * reference that never settled a question, and is back on different grounds:
 * a phone spends 288ms per inference against a desktop's 20ms, and three of
 * Holistic's five sub-graphs are the hands and the face (SPEC.md 9.5).
 *
 * Backends therefore declare what they CANNOT do, and the UI greys out the
 * controls that depend on it rather than leaving them live over a tracker
 * that will never feed them.
 *
 * Subclasses are the only place MediaPipe types may appear; everything
 * downstream sees PoseFrame.
 *
 * The base is split in two because the tracker has to run in a worker, where
 * there is no <video> and no requestVideoFrameCallback (SPEC.md 4.1).
 * `LandmarkerTracker` owns everything that is not the loop -- building the
 * graph, the delegate, the rate cap, inference timing, error state -- and is
 * driven one frame at a time by whoever has frames. `VideoTracker` adds the
 * main thread's loop. The backends subclass the latter and are unaware of
 * which driver is pushing frames at them.
 */

import { FilesetResolver } from "@mediapipe/tasks-vision";
import type { PoseFrame } from "../types.ts";
import { assetUrls } from "./assets.ts";

export type TrackerDelegate = "GPU" | "CPU";

/**
 * Selectable backends, as strings so a stored value can be validated against
 * the set (see readSetting). Order is the order the UI cycles through.
 */
export const TRACKER_BACKENDS = ["holistic", "pose"] as const;

export type TrackerBackend = (typeof TRACKER_BACKENDS)[number];

/**
 * Which delegate to build the graph on.
 *
 * `auto` is the shipping behaviour: GPU, with CPU as the fallback when the
 * graph will not open. The explicit values exist to measure, which `auto`
 * cannot do -- it reports whichever delegate it landed on, and landing on one
 * is not the same as having asked for it.
 *
 * A forced choice never silently becomes the other one. A measurement that
 * quietly changes what it is measuring is worse than one that fails, and this
 * readout is what the mobile default gets decided from (SPEC.md 9.4).
 */
export type DelegatePreference = "auto" | "GPU" | "CPU";

export const DELEGATE_PREFERENCES: readonly DelegatePreference[] = [
  "auto",
  "GPU",
  "CPU",
];

export type PoseFrameHandler = (frame: PoseFrame) => void;

/**
 * Anything a backend can run inference on.
 *
 * All three are `TexImageSource`, which is what MediaPipe's `detectForVideo`
 * accepts, so a backend never has to care which one it was handed. The worker
 * deals in `VideoFrame` (from a transferred MediaStreamTrackProcessor stream)
 * or `ImageBitmap`; the main thread deals in the <video> element it already
 * owns.
 */
export type FrameSource = HTMLVideoElement | ImageBitmap | VideoFrame;

/**
 * Width and height of a frame, whatever kind it is.
 *
 * Duck-typed rather than `instanceof`, deliberately: `HTMLVideoElement` is
 * not defined in a worker, so testing against it there throws a
 * ReferenceError rather than returning false.
 */
export function frameSize(source: FrameSource): readonly [number, number] {
  if ("videoWidth" in source) return [source.videoWidth, source.videoHeight];
  if ("displayWidth" in source) return [source.displayWidth, source.displayHeight];
  return [source.width, source.height];
}

export interface Tracker {
  /** Shown in the panel so the active backend is never ambiguous. */
  readonly name: string;
  /**
   * What this backend CAN do, not what it is currently doing.
   *
   * Capability, because that is the question the UI has: whether a control
   * may be offered at all. Whether face blendshapes are switched on is a
   * separate thing the owner of that setting already knows.
   */
  readonly tracksHands: boolean;
  readonly tracksFace: boolean;
  readonly ready: boolean;
  readonly delegate: TrackerDelegate;
  /** Inference time only -- not end-to-end pipeline latency. */
  readonly inferenceMs: number;
  /** Set when inference failed fatally; tracking has stopped. */
  readonly lastError: string | null;
  /**
   * Cap on inference rate in Hz. 0 runs on every camera frame.
   *
   * Tracking and rendering share a thread (SPEC.md 4), so an inference that
   * costs more than a frame does not merely track slowly -- it starves the
   * render loop and takes the whole page down with it. On a phone one
   * detectForVideo measured 270ms, which is the entire budget (SPEC.md 9.4).
   *
   * Skipping camera frames hands the slice back. It buys smoothness rather
   * than accuracy: §6's interpolator slerps toward the newest pose, so a
   * halved tracking rate costs far less than a halved frame rate does.
   *
   * Mutable on a running tracker, unlike the delegate, because nothing about
   * the graph depends on it.
   */
  maxInferenceHz: number;
  init(): Promise<void>;
  /**
   * Push one frame through the graph.
   *
   * Part of the interface because there are two drivers now: the main
   * thread's `requestVideoFrameCallback` loop, and the worker pulling from a
   * transferred stream (SPEC.md 4.1). Returns false when the frame was
   * declined -- by the rate cap, by zero dimensions, or because inference has
   * stopped -- which tells a caller holding a VideoFrame that it still owns
   * it.
   */
  infer(source: FrameSource, timestampMs: number, now: number): boolean;
  /** Main-thread driver only; the worker has no <video> to attach. */
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

export type FilesetProvider = () => Promise<VisionFileset>;

let provider: FilesetProvider | null = null;

/**
 * Override how the fileset is obtained.
 *
 * The worker needs a different one: the ES-module flavour of the wasm glue,
 * and `ModuleFactory` re-armed immediately before each task is built
 * (worker/wasmGlue.ts explains both). Installing it here rather than
 * branching inside the backends keeps them unaware of which thread they are
 * on, which is the point of the split in `LandmarkerTracker`.
 */
export function setFilesetProvider(next: FilesetProvider | null): void {
  provider = next;
  filesetPromise = null;
}

/** Shared across backends: resolving it twice would fetch the wasm twice. */
export function visionFileset(): Promise<VisionFileset> {
  /*
   * A provider is called per build rather than cached, because the worker's
   * has a side effect that has to happen before every `createFromOptions`
   * and not once per page.
   */
  if (provider) return provider();
  filesetPromise ??= FilesetResolver.forVisionTasks(assetUrls().wasm);
  return filesetPromise;
}

/**
 * A tracking backend without a loop.
 *
 * Holds everything that is the same whether frames arrive from a <video> on
 * the main thread or from a transferred stream in a worker: the graph, the
 * delegate it opened on, the rate cap, inference timing and error state.
 * Callers push frames in through `infer`.
 */
export abstract class LandmarkerTracker<L extends Closeable> {
  abstract readonly name: string;
  abstract readonly tracksHands: boolean;
  abstract readonly tracksFace: boolean;

  protected constructor(
    private readonly preference: DelegatePreference = "auto",
  ) {}

  protected landmarker: L | null = null;
  private readonly handlers = new Set<PoseFrameHandler>();

  private delegateInUse: TrackerDelegate = "GPU";
  private lastInferenceMs = 0;
  private failure: string | null = null;
  /** detectForVideo rejects non-monotonic timestamps, and a paused or looped
   *  video can repeat one, so the last value is tracked and nudged past. */
  private lastTimestamp = -1;
  /** 0 runs inference on every camera frame; see Tracker.maxInferenceHz. */
  private inferenceHz = 0;
  /** Start of the last inference, so the cap is measured start to start. */
  private lastInferenceAt = 0;

  /** Construct the underlying MediaPipe task on the given delegate. */
  protected abstract build(delegate: TrackerDelegate): Promise<L>;

  /** Run inference and convert the result. Return null to emit nothing. */
  protected abstract process(
    landmarker: L,
    source: FrameSource,
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

  get lastError(): string | null {
    return this.failure;
  }

  get maxInferenceHz(): number {
    return this.inferenceHz;
  }

  set maxInferenceHz(hz: number) {
    // Clamped rather than trusted: this is reachable from a panel control and
    // a stored setting, and a negative or NaN cap would disable the throttle
    // silently instead of failing.
    this.inferenceHz = Number.isFinite(hz) && hz > 0 ? hz : 0;
  }

  /**
   * Whether this camera frame should be inferred on.
   *
   * Start to start rather than end to start: the interval is a rate cap, and
   * measuring from the end of the previous inference would make the realised
   * rate depend on how long inference took, which is the thing being capped.
   */
  private inferenceDue(now: number): boolean {
    if (this.inferenceHz <= 0) return true;
    if (
      this.lastInferenceAt > 0 &&
      now - this.lastInferenceAt < 1000 / this.inferenceHz
    ) {
      return false;
    }
    this.lastInferenceAt = now;
    return true;
  }

  /**
   * Narrows a delegate that a feature makes impossible.
   *
   * Overridden rather than handled inside `build`, because this class records
   * what it built on: a subclass that substituted a delegate privately would
   * leave the panel reporting one thing while the graph ran on another, and
   * that readout is load-bearing (SPEC.md 9.4).
   */
  protected constrainDelegate(delegate: TrackerDelegate): TrackerDelegate {
    return delegate;
  }

  async init(): Promise<void> {
    this.failure = null;

    if (this.preference !== "auto") {
      // Forced: a failure is reported rather than papered over with the other
      // delegate, so what the panel shows is always what was asked for.
      const delegate = this.constrainDelegate(this.preference);
      this.landmarker = await this.build(delegate);
      this.delegateInUse = delegate;
      return;
    }

    const first = this.constrainDelegate("GPU");
    try {
      this.landmarker = await this.build(first);
      this.delegateInUse = first;
      return;
    } catch (err) {
      if (first === "CPU") throw err;
      /*
       * The GPU delegate fails outright on some drivers and in some headless
       * contexts, and CPU keeps the app usable rather than dead.
       *
       * Not the slower option on every device, which this comment used to
       * claim. On mobile the WebGL delegate reads its output tensors back
       * with synchronous glReadPixels, measured at 73% of the main thread and
       * 270ms per inference on a phone where CPU does no readback at all
       * (SPEC.md 9.4). Which one wins is a per-device question, which is why
       * it can now be forced.
       */
      console.warn(`${this.name}: GPU delegate unavailable, falling back to CPU`, err);
      this.landmarker = await this.build("CPU");
      this.delegateInUse = "CPU";
    }
  }

  onFrame(cb: PoseFrameHandler): () => void {
    this.handlers.add(cb);
    return () => this.handlers.delete(cb);
  }

  /**
   * Run one frame through the graph and emit whatever comes out.
   *
   * The driver decides WHEN a frame arrives; this decides whether to spend an
   * inference on it. Returns false when the frame was skipped or inference
   * has stopped, which lets a driver releasing frames know it still owns this
   * one.
   *
   * `now` is separate from `timestampMs` because the rate cap is measured
   * against the clock while the graph is fed a monotonic frame stamp, and on
   * the worker's transport those are not the same number.
   */
  infer(source: FrameSource, timestampMs: number, now: number): boolean {
    const landmarker = this.landmarker;
    if (!landmarker || this.failure) return false;

    /*
     * Zero dimensions happen briefly on device switches; inferring on that
     * throws inside wasm rather than returning an empty result.
     */
    const [width] = frameSize(source);
    if (width <= 0) return false;
    if (!this.inferenceDue(now)) return false;

    // detectForVideo rejects a non-monotonic timestamp, and both drivers can
    // repeat one -- a paused video on the main thread, a clock that is not
    // performance.now() in the worker.
    const timestamp = timestampMs > this.lastTimestamp ? timestampMs : this.lastTimestamp + 1;
    this.lastTimestamp = timestamp;

    const started = performance.now();
    let frame: PoseFrame | null = null;
    try {
      frame = this.process(landmarker, source, timestamp);
    } catch (err) {
      /*
       * A throw here used to kill tracking outright: the callback below
       * never ran, the loop stopped, and the only symptom was a live camera
       * feed driving nothing. Inference failures are reported and the driver
       * is told to stop rather than left to die silently.
       *
       * Stopping rather than continuing because these failures are
       * structural -- a graph that cannot open will not open on the next
       * frame either, and retrying would flood the console sixty times a
       * second with the same message.
       */
      this.failure = String(err);
      console.error(`${this.name}: inference failed, tracking stopped`, err);
      this.onInferenceFailed();
      return false;
    }
    this.lastInferenceMs = performance.now() - started;

    if (frame) for (const cb of this.handlers) cb(frame);
    return frame !== null;
  }

  /** Hook for a driver that has a loop to tear down. */
  protected onInferenceFailed(): void {}

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.handlers.clear();
  }
}

/**
 * A landmarker driven by a <video> on the main thread.
 *
 * This is the original loop, and it stays for two reasons: it is what runs
 * when the worker cannot be used at all (SPEC.md 4.1's last "done when"), and
 * it is the only driver that can see `VideoFrameCallbackMetadata`.
 */
export abstract class VideoTracker<L extends Closeable>
  extends LandmarkerTracker<L>
  implements Tracker
{
  private video: HTMLVideoElement | null = null;
  private handle: number | null = null;

  attach(video: HTMLVideoElement): void {
    if (!this.ready) throw new Error(`${this.name}: init() must run before attach()`);
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

  /** A fatal inference failure stops the loop; see LandmarkerTracker.infer. */
  protected override onInferenceFailed(): void {
    this.detach();
  }

  private readonly step = (now: DOMHighResTimeStamp): void => {
    const video = this.video;
    if (!video) return;

    // A frame skipped by the rate cap still reschedules, so the loop keeps
    // running rather than stopping at the first throttled frame.
    this.infer(video, now, now);

    // Cleared by onInferenceFailed when inference died; do not restart it.
    if (this.video) this.handle = video.requestVideoFrameCallback(this.step);
  };

  override dispose(): void {
    this.detach();
    super.dispose();
  }
}
