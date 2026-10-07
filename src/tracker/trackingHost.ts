/*
 * What `main.ts` talks to, whichever thread the tracker is on.
 *
 * Two implementations: `WorkerTrackingHost`, which is the point of SPEC.md
 * 4.1, and `LocalTrackingHost`, which wraps the original in-process
 * `TrackerHost` and is what runs when the worker cannot be used at all.
 * Keeping the second one is a requirement rather than caution -- 4.1's last
 * "done when" is that a browser without the chosen frame transport still
 * tracks on the main thread rather than failing.
 *
 * The shape differs from `TrackerHost` in two ways, both forced by the
 * boundary:
 *
 * `use` takes a config rather than a factory. The main thread cannot
 * construct a tracker that lives in the worker, so it describes one.
 *
 * `snapshot` replaces the getters. The debug panel reads four of them every
 * frame, and a round trip per readout would cost more than the thing it
 * measures (SPEC.md 4.1), so the worker pushes state and this returns the
 * last pushed copy.
 */

import type { PoseFrame } from "../types.ts";
import type { PoseFrameHandler } from "./tracker.ts";
import type { TrackerStatus } from "./trackerHost.ts";
import type { TrackerConfig, TrackerSnapshot } from "./worker/protocol.ts";

export interface TrackingHost {
  /** Last state pushed from wherever the tracker is running. */
  readonly snapshot: TrackerSnapshot;
  /** True when tracking is off the main thread. Reported, not inferred: the
   *  panel should not have to guess which path it got. */
  readonly offThread: boolean;
  maxInferenceHz: number;
  onFrame(cb: PoseFrameHandler): () => void;
  onStatus(cb: (s: TrackerStatus) => void): () => void;
  /** Binds the video any backend, current or future, draws frames from. */
  setVideo(video: HTMLVideoElement | null): void;
  use(config: TrackerConfig): Promise<void>;
  dispose(): void;
}

export const IDLE_SNAPSHOT: TrackerSnapshot = {
  backend: "-",
  delegate: "-",
  ready: false,
  tracksHands: false,
  tracksFace: false,
  inferenceMs: 0,
  lastError: null,
  maxInferenceHz: 0,
};

/**
 * One reused `PoseFrame`, filled from each incoming message.
 *
 * The backends reuse their buffers and everything downstream is written
 * against that -- the contract is "the instance is reused, do not retain a
 * reference" (see types.ts). A clone arrives as fresh arrays every frame, so
 * copying into one persistent frame preserves the contract exactly and keeps
 * the per-frame allocation off this thread, which is the thread being
 * cleared.
 */
export class FrameAssembler {
  private world: Float32Array | null = null;
  private image: Float32Array | null = null;
  private visibility: Float32Array | null = null;
  private left: { world: Float32Array; image: Float32Array; present: boolean } | null = null;
  private right: { world: Float32Array; image: Float32Array; present: boolean } | null = null;
  private face: { scores: Float32Array; present: boolean } | null = null;

  /** Lazily sized from the first frame, so no layout constant is duplicated
   *  here -- the backend already decided how long each buffer is. */
  private static fill(into: Float32Array | null, from: Float32Array): Float32Array {
    const target = into?.length === from.length ? into : new Float32Array(from.length);
    target.set(from);
    return target;
  }

  assemble(payload: {
    world: Float32Array;
    image: Float32Array;
    visibility: Float32Array;
    timestampMs: number;
    leftHand: { world: Float32Array; image: Float32Array; present: boolean } | null;
    rightHand: { world: Float32Array; image: Float32Array; present: boolean } | null;
    face: { scores: Float32Array; present: boolean } | null;
  }): PoseFrame {
    this.world = FrameAssembler.fill(this.world, payload.world);
    this.image = FrameAssembler.fill(this.image, payload.image);
    this.visibility = FrameAssembler.fill(this.visibility, payload.visibility);

    // null and `present: false` are different answers and stay different: the
    // solver picks its derivation on that distinction (see types.ts).
    if (payload.leftHand === null) this.left = null;
    else {
      this.left ??= { world: new Float32Array(0), image: new Float32Array(0), present: false };
      this.left.world = FrameAssembler.fill(this.left.world, payload.leftHand.world);
      this.left.image = FrameAssembler.fill(this.left.image, payload.leftHand.image);
      this.left.present = payload.leftHand.present;
    }

    if (payload.rightHand === null) this.right = null;
    else {
      this.right ??= { world: new Float32Array(0), image: new Float32Array(0), present: false };
      this.right.world = FrameAssembler.fill(this.right.world, payload.rightHand.world);
      this.right.image = FrameAssembler.fill(this.right.image, payload.rightHand.image);
      this.right.present = payload.rightHand.present;
    }

    if (payload.face === null) this.face = null;
    else {
      this.face ??= { scores: new Float32Array(0), present: false };
      this.face.scores = FrameAssembler.fill(this.face.scores, payload.face.scores);
      this.face.present = payload.face.present;
    }

    return {
      world: this.world,
      image: this.image,
      visibility: this.visibility,
      timestampMs: payload.timestampMs,
      leftHand: this.left,
      rightHand: this.right,
      face: this.face,
    };
  }
}
