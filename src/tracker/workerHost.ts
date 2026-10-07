/*
 * The main thread's half of the worker tracker (SPEC.md 4.1).
 *
 * Owns the worker, the frame transport, and the last state the worker
 * pushed. Everything downstream of `onFrame` is unchanged -- the boundary is
 * still `PoseFrame`, which is what made this containable.
 */

import { resolveAssetUrls } from "./assets.ts";
import type { PoseFrameHandler } from "./tracker.ts";
import type { TrackerStatus } from "./trackerHost.ts";
import {
  FrameAssembler,
  IDLE_SNAPSHOT,
  type TrackingHost,
} from "./trackingHost.ts";
import type {
  MainToWorker,
  TrackerConfig,
  TrackerSnapshot,
  WorkerToMain,
} from "./worker/protocol.ts";

/**
 * A ReadableStream of camera frames, for the worker to pull from.
 *
 * `MediaStreamTrackProcessor` is the preferred transport and the reason the
 * worker is worth having: its `readable` is transferable, so camera frames
 * never touch the thread being cleared. It is Chromium-only and lives on the
 * main thread rather than in the worker, which is why it is constructed here.
 */
interface TrackProcessor {
  readonly readable: ReadableStream<VideoFrame>;
}

type TrackProcessorCtor = new (init: {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}) => TrackProcessor;

function trackProcessor(): TrackProcessorCtor | null {
  return (
    (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
      .MediaStreamTrackProcessor ?? null
  );
}

/** Whether the zero-copy transport exists at all. */
export function hasStreamTransport(): boolean {
  return trackProcessor() !== null;
}

export class WorkerTrackingHost implements TrackingHost {
  readonly offThread = true;

  private readonly worker: Worker;
  private readonly assembler = new FrameAssembler();
  private readonly handlers = new Set<PoseFrameHandler>();
  private readonly statusListeners = new Set<(s: TrackerStatus) => void>();

  private state: TrackerSnapshot = IDLE_SNAPSHOT;
  private status: TrackerStatus = { kind: "idle" };
  private hz = 0;

  /** The cloned track the processor consumes, so it can be stopped on
   *  teardown without touching the preview's own. */
  private clonedTrack: MediaStreamTrack | null = null;
  /** Set only on the bitmap transport; see `pumpBitmaps`. */
  private bitmapVideo: HTMLVideoElement | null = null;
  private bitmapHandle: number | null = null;
  private bitmapInFlight = false;
  /** Resolved once the worker has its asset urls; nothing can be built
   *  before that, and `use` may be called immediately. */
  private readonly ready: Promise<void>;
  private settleReady: (() => void) | null = null;
  /** Set when the worker said it cannot run; the caller falls back. */
  private fatal: string | null = null;
  /**
   * Worker `performance.now()` minus this thread's, in ms.
   *
   * A worker's `performance.timeOrigin` is its own creation time, so the two
   * clocks are offset by however long the page had been open when it
   * started. Frames are stamped on the worker's clock and read downstream
   * against this thread's -- SPEC.md 9.2 subtracts the stamp from
   * `performance.now()` -- so the offset is applied once here rather than
   * left to skew every latency reading and the pose buffer's lookahead.
   */
  private clockSkew = 0;

  constructor(worker: Worker) {
    this.worker = worker;
    this.ready = new Promise<void>((resolve) => {
      this.settleReady = resolve;
    });

    this.worker.onmessage = this.receive;
    /*
     * A worker that throws while starting is a fallback case, not a crash:
     * the page keeps tracking on the main thread instead (4.1's last "done
     * when"). Recorded so `start` can report it.
     */
    this.worker.onerror = (e: ErrorEvent): void => {
      this.fatal = e.message || "worker failed to start";
      this.settleReady?.();
      this.settleReady = null;
    };

    this.post({ kind: "init", assets: resolveAssetUrls() });
  }

  private post(message: MainToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  private readonly receive = (e: MessageEvent<WorkerToMain>): void => {
    const message = e.data;
    switch (message.kind) {
      case "ready":
        this.clockSkew = message.timeOrigin - performance.timeOrigin;
        this.settleReady?.();
        this.settleReady = null;
        break;
      case "frame": {
        this.state = { ...this.state, inferenceMs: message.frame.inferenceMs };
        const frame = this.assembler.assemble({
          ...message.frame,
          // Onto this thread's clock; see clockSkew.
          timestampMs: message.frame.timestampMs + this.clockSkew,
        });
        for (const cb of this.handlers) cb(frame);
        break;
      }
      case "status":
        this.status = message.status;
        for (const cb of this.statusListeners) cb(message.status);
        break;
      case "snapshot":
        this.state = message.snapshot;
        break;
      case "fatal":
        this.fatal = message.message;
        this.settleReady?.();
        this.settleReady = null;
        break;
    }
  };

  /** Resolves once the worker can build, or reports why it cannot. */
  async start(): Promise<{ ok: boolean; reason: string | null }> {
    await this.ready;
    return this.fatal === null
      ? { ok: true, reason: null }
      : { ok: false, reason: this.fatal };
  }

  get snapshot(): TrackerSnapshot {
    return this.state;
  }

  get maxInferenceHz(): number {
    return this.hz;
  }

  set maxInferenceHz(hz: number) {
    this.hz = Number.isFinite(hz) && hz > 0 ? hz : 0;
    this.post({ kind: "maxInferenceHz", hz: this.hz });
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

  /**
   * Hand the worker a frame source for this video's stream.
   *
   * The track is CLONED rather than consumed: the processor pulls frames out
   * of whatever track it is given, and the preview is still displaying the
   * original (SPEC.md 4.1).
   */
  setVideo(video: HTMLVideoElement | null): void {
    this.releaseTrack();
    if (!video) {
      this.post({ kind: "stop" });
      return;
    }

    const Processor = trackProcessor();
    const source = video.srcObject;
    if (!Processor || !(source instanceof MediaStream)) {
      this.pumpBitmaps(video);
      return;
    }

    const track = source.getVideoTracks()[0];
    if (!track) {
      this.pumpBitmaps(video);
      return;
    }

    const clone = track.clone();
    this.clonedTrack = clone;
    /*
     * maxBufferSize 1: an 82ms inference cannot keep up with a 30fps camera,
     * and without a bound the stream grows a queue of stale frames that
     * tracking then works through in order -- latency rising without limit.
     * Dropping the backlog is the correct trade, and is what the interpolator
     * already assumes (SPEC.md 6, 9.5).
     */
    const processor = new Processor({ track: clone, maxBufferSize: 1 });
    this.post({ kind: "stream", frames: processor.readable }, [processor.readable]);
  }

  /**
   * The transport for browsers without MediaStreamTrackProcessor.
   *
   * Strictly worse than the stream and deliberately second: it leaves a
   * frame grab on the thread the worker exists to clear. It is still worth
   * having, because what it moves is the 61% of the frame spent stalled in
   * `gl.readPixels`, and what it leaves behind is a GPU-side copy
   * (SPEC.md 9.5).
   *
   * One frame in flight at a time. `createImageBitmap` is async, and queuing
   * a bitmap per camera frame against a slower inference would pile up
   * copies the worker will never reach.
   */
  private pumpBitmaps(video: HTMLVideoElement): void {
    if (!("requestVideoFrameCallback" in video)) return;
    this.bitmapVideo = video;

    const step = (now: DOMHighResTimeStamp): void => {
      if (this.bitmapVideo !== video) return;

      if (!this.bitmapInFlight && video.videoWidth > 0) {
        this.bitmapInFlight = true;
        void createImageBitmap(video)
          .then((bitmap) => {
            if (this.bitmapVideo !== video) {
              bitmap.close();
              return;
            }
            // Transferred, not cloned: a bitmap is a GPU handle and copying
            // one would defeat the point of grabbing it this way.
            this.post({ kind: "frame", bitmap, now }, [bitmap]);
          })
          .catch(() => {
            /* A frame grab can fail across a device switch; skip it. */
          })
          .finally(() => {
            this.bitmapInFlight = false;
          });
      }

      this.bitmapHandle = video.requestVideoFrameCallback(step);
    };
    this.bitmapHandle = video.requestVideoFrameCallback(step);
  }

  private releaseTrack(): void {
    this.clonedTrack?.stop();
    this.clonedTrack = null;

    if (this.bitmapVideo && this.bitmapHandle !== null) {
      this.bitmapVideo.cancelVideoFrameCallback(this.bitmapHandle);
    }
    this.bitmapVideo = null;
    this.bitmapHandle = null;
  }

  async use(config: TrackerConfig): Promise<void> {
    await this.ready;
    if (this.fatal !== null) return;
    this.post({ kind: "use", config });
  }

  dispose(): void {
    this.post({ kind: "dispose" });
    this.releaseTrack();
    this.handlers.clear();
    this.statusListeners.clear();
    this.worker.terminate();
  }
}
