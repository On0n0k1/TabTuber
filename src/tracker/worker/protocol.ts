/*
 * The messages crossing the worker boundary.
 *
 * Imports nothing from MediaPipe or three.js on purpose: this file is the
 * contract, and both sides of it compile against this alone.
 *
 * The boundary itself is unchanged from the single-threaded design --
 * `PoseFrame` in, `AvatarPose` out, the solver and everything after it stays
 * on the main thread (SPEC.md 4.1). What is new is that the frame now has to
 * be serialised to get here.
 */

import type { AssetUrls } from "../assets.ts";
import type { TrackerBackend, DelegatePreference } from "../tracker.ts";

/** What to build. Every field is fixed when the graph opens, so a change to
 *  any of them means a rebuild rather than a mutation (see `use`). */
export interface TrackerConfig {
  readonly backend: TrackerBackend;
  readonly faceBlendshapes: boolean;
  readonly delegate: DelegatePreference;
}

/**
 * A PoseFrame flattened for the wire.
 *
 * Hands and face are inlined rather than nested so the whole thing is a
 * handful of typed arrays and booleans. `null` versus `present: false` still
 * means what it means in `PoseFrame`: the backend does not track this at
 * all, as against it looked and found nothing.
 */
export interface FramePayload {
  readonly world: Float32Array;
  readonly image: Float32Array;
  readonly visibility: Float32Array;
  readonly timestampMs: number;
  readonly leftHand: HandPayload | null;
  readonly rightHand: HandPayload | null;
  readonly face: FacePayload | null;
  /** Piggybacked rather than pushed separately: the panel reads it every
   *  frame and a round trip per readout would defeat the point. */
  readonly inferenceMs: number;
}

export interface HandPayload {
  readonly world: Float32Array;
  readonly image: Float32Array;
  readonly present: boolean;
}

export interface FacePayload {
  readonly scores: Float32Array;
  readonly present: boolean;
}

/**
 * What the panel and the banner read, pushed rather than polled.
 *
 * `TrackerHost`'s getters cannot survive the boundary -- the debug panel
 * samples four of them every frame, and a round trip per sample would make
 * the readout cost more than the thing it measures (SPEC.md 4.1).
 */
export interface TrackerSnapshot {
  readonly backend: string;
  readonly delegate: string;
  readonly ready: boolean;
  readonly tracksHands: boolean;
  readonly tracksFace: boolean;
  readonly inferenceMs: number;
  readonly lastError: string | null;
  readonly maxInferenceHz: number;
}

/** Mirrors TrackerStatus, which the banner renders. */
export type StatusPayload =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly name: string }
  | { readonly kind: "active"; readonly name: string }
  | { readonly kind: "error"; readonly name: string; readonly message: string };

export type MainToWorker =
  /** First message, always. Carries the urls the worker cannot resolve. */
  | { readonly kind: "init"; readonly assets: AssetUrls }
  /** Build this backend, keeping the current one serving until it is up. */
  | { readonly kind: "use"; readonly config: TrackerConfig }
  /** A transferred ReadableStream<VideoFrame>; the worker pulls from it. */
  | { readonly kind: "stream"; readonly frames: ReadableStream<VideoFrame> }
  /** One frame, for the transport that cannot transfer a stream. */
  | { readonly kind: "frame"; readonly bitmap: ImageBitmap; readonly now: number }
  /** Stop pulling frames; the camera went away. */
  | { readonly kind: "stop" }
  | { readonly kind: "maxInferenceHz"; readonly hz: number }
  | { readonly kind: "dispose" };

export type WorkerToMain =
  /** Sent once the worker has its urls and is able to build. */
  | { readonly kind: "ready" }
  | { readonly kind: "frame"; readonly frame: FramePayload }
  | { readonly kind: "status"; readonly status: StatusPayload }
  | { readonly kind: "snapshot"; readonly snapshot: TrackerSnapshot }
  /** The worker could not start at all, so the caller falls back to the
   *  main thread rather than leaving the page without tracking. */
  | { readonly kind: "fatal"; readonly message: string };
