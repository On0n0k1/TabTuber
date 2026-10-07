/*
 * The tracker, off the main thread.
 *
 * This is the whole of SPEC.md 4.1: MediaPipe and `TrackerHost` run here,
 * and nothing else moves. It makes inference no faster -- on the phone a
 * frame is 82ms, 61% of it the thread parked in `gl.readPixels` waiting on
 * the GPU. What it does is take that stall off the thread that draws the
 * avatar, so tracking runs at its own rate while the renderer runs at
 * display rate and 6's interpolator slerps between poses.
 *
 * The solver, the filters, the pose buffer and the avatar all stay on the
 * main thread: the solver costs 0.40ms a frame, and moving it would push an
 * AvatarPose -- a Map of quaternions -- across the boundary instead of three
 * flat typed arrays (SPEC.md 9.5).
 */

import { HolisticTracker } from "../holisticTracker.ts";
import { PoseTracker } from "../poseTracker.ts";
import { setAssetUrls, assetUrls } from "../assets.ts";
import { setFilesetProvider } from "../tracker.ts";
import type { Tracker } from "../tracker.ts";
import { TrackerHost } from "../trackerHost.ts";
import type { PoseFrame } from "../../types.ts";
import { USE_MODULE, armModuleFactory } from "./wasmGlue.ts";
import { FilesetResolver } from "@mediapipe/tasks-vision";
import type {
  FramePayload,
  HandPayload,
  MainToWorker,
  TrackerConfig,
  WorkerToMain,
} from "./protocol.ts";

/*
 * The worker's global, typed narrowly.
 *
 * `lib.dom` and `lib.webworker` cannot both be loaded in one program -- they
 * declare conflicting globals -- and this project compiles against `dom`
 * because everything else needs it. So the three members used here are
 * declared rather than pulling in the other lib.
 */
const ctx = self as unknown as {
  postMessage(message: WorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<MainToWorker>) => void) | null;
};

function send(message: WorkerToMain): void {
  ctx.postMessage(message);
}

const host = new TrackerHost();

/** Set once `init` arrives; nothing can be built before it. */
let initialised = false;

const newTracker = (config: TrackerConfig) => (): Tracker =>
  config.backend === "pose"
    ? new PoseTracker({ delegate: config.delegate })
    : new HolisticTracker({
        faceBlendshapes: config.faceBlendshapes,
        delegate: config.delegate,
      });

/*
 * State the main thread reads rather than asks for.
 *
 * The debug panel samples `backend`, `delegate`, `inferenceMs` and
 * `lastError` every frame; a round trip per sample would make the readout
 * cost more than what it measures (SPEC.md 4.1).
 */
function pushSnapshot(): void {
  const t = host.current;
  send({
    kind: "snapshot",
    snapshot: {
      backend: t?.name ?? "-",
      delegate: t?.ready ? t.delegate : "-",
      ready: t?.ready ?? false,
      tracksHands: t?.tracksHands ?? false,
      tracksFace: t?.tracksFace ?? false,
      inferenceMs: t?.inferenceMs ?? 0,
      lastError: t?.lastError ?? null,
      maxInferenceHz: host.maxInferenceHz,
    },
  });
}

host.onStatus((status) => {
  send({ kind: "status", status });
  pushSnapshot();
});

/**
 * Hands the frame over as a structured clone, not a transfer.
 *
 * Both backends reuse three Float32Arrays per frame deliberately, to keep
 * allocation out of a 30Hz loop. Transferring would be zero-copy but would
 * DETACH those buffers, so the next frame would write into a dead array
 * (SPEC.md 4.1 names this). Cloning copies about 1.5KB per frame, which at
 * tracking rate is tens of kilobytes a second -- far below the cost of
 * giving up the reuse and allocating per frame instead.
 */
function serialise(frame: PoseFrame, inferenceMs: number): FramePayload {
  const hand = (h: PoseFrame["leftHand"]): HandPayload | null =>
    h === null ? null : { world: h.world, image: h.image, present: h.present };

  return {
    world: frame.world,
    image: frame.image,
    visibility: frame.visibility,
    timestampMs: frame.timestampMs,
    leftHand: hand(frame.leftHand),
    rightHand: hand(frame.rightHand),
    face:
      frame.face === null
        ? null
        : { scores: frame.face.scores, present: frame.face.present },
    inferenceMs,
  };
}

host.onFrame((frame) => {
  send({ kind: "frame", frame: serialise(frame, host.current?.inferenceMs ?? 0) });
});

/*
 * The frame pump.
 *
 * `VideoTracker`'s loop needs a <video> and `requestVideoFrameCallback`,
 * neither of which exists here, so the worker drives `infer` itself. The
 * rate cap still lives on the tracker, so a frame it declines is released
 * here rather than held.
 */
let pumping = false;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;

async function pump(stream: ReadableStream<VideoFrame>): Promise<void> {
  await stopPump();
  reader = stream.getReader();
  pumping = true;

  while (pumping) {
    let frame: VideoFrame | undefined;
    try {
      const next = await reader.read();
      if (next.done) break;
      frame = next.value;
    } catch {
      break;
    }
    if (!frame) break;

    try {
      /*
       * Stamped with this thread's clock, NOT `VideoFrame.timestamp`.
       *
       * The frame's own timestamp is microseconds on a media clock, and
       * `PoseFrame.timestampMs` is read downstream as a `performance.now()`
       * reading: SPEC.md 9.2 computes latency as `now - stamp`, and the pose
       * buffer times its lookahead off the same field. Passing the media
       * clock through made that subtraction wildly negative, which the
       * latency readout correctly rendered as "no data".
       *
       * Same value for both arguments, exactly as the main thread's loop
       * does: monotonic, which is all MediaPipe requires of a graph
       * timestamp, and a real clock reading, which is what the rate cap and
       * everything downstream need.
       */
      const now = performance.now();
      /*
       * A snapshot when nothing was emitted, so `inferenceMs` keeps updating
       * with no one in shot.
       *
       * The figure used to come from a live getter on this thread and ticked
       * on every inference whether or not a pose was found. Riding it on the
       * frame message alone would blank the readout exactly when someone is
       * checking whether the tracker is working at all -- which is when they
       * are most likely to be out of frame. Either way this is one message
       * per camera frame, never two.
       */
      if (!host.current?.infer(frame, now, now)) pushSnapshot();
    } finally {
      // Always, including when the rate cap declined this frame: a VideoFrame
      // holds a hardware buffer, and leaking them stalls the camera.
      frame.close();
    }
  }

  await stopPump();
}

async function stopPump(): Promise<void> {
  pumping = false;
  const current = reader;
  reader = null;
  if (!current) return;
  try {
    await current.cancel();
  } catch {
    /* Already errored or closed; nothing to release. */
  }
}

ctx.onmessage = (e: MessageEvent<MainToWorker>): void => {
  const message = e.data;

  switch (message.kind) {
    case "init": {
      setAssetUrls(message.assets);
      /*
       * The worker's own way of getting a fileset: the module flavour of the
       * glue, with ModuleFactory re-armed immediately before each build.
       * wasmGlue.ts explains why both are mandatory here and neither is on
       * the main thread.
       */
      setFilesetProvider(async () => {
        await armModuleFactory(assetUrls().wasm);
        return FilesetResolver.forVisionTasks(assetUrls().wasm, USE_MODULE);
      });
      initialised = true;
      /*
       * A worker's `performance.timeOrigin` is its own creation time, so its
       * `performance.now()` is NOT comparable with the main thread's. The
       * origin goes back with `ready` so the difference can be corrected
       * once, at the boundary, rather than every frame stamp being quietly
       * off by however long the page had been open.
       */
      send({ kind: "ready", timeOrigin: performance.timeOrigin });
      break;
    }

    case "use": {
      if (!initialised) {
        send({ kind: "fatal", message: "use before init" });
        break;
      }
      void host
        .use(message.config.backend, newTracker(message.config))
        .then(pushSnapshot);
      break;
    }

    case "stream": {
      void pump(message.frames);
      break;
    }

    case "frame": {
      // The transport for browsers without MediaStreamTrackProcessor. The
      // bitmap is owned here now, so it is closed either way.
      try {
        /*
         * This thread's clock, not the `now` the main thread sent, so every
         * frame is stamped on one timebase regardless of transport and a
         * single skew correction covers both (see the `ready` message).
         */
        const now = performance.now();
        if (!host.current?.infer(message.bitmap, now, now)) pushSnapshot();
      } finally {
        message.bitmap.close();
      }
      break;
    }

    case "stop": {
      void stopPump();
      break;
    }

    case "maxInferenceHz": {
      host.maxInferenceHz = message.hz;
      pushSnapshot();
      break;
    }

    case "dispose": {
      void stopPump();
      host.dispose();
      break;
    }
  }
};
