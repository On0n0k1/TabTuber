/*
 * PoseLandmarker backend: body only.
 *
 * Supplies no real hand data -- landmarks 17 to 22 are three crude knuckle
 * estimates from the body model, which is why hand orientation derived from
 * them is poor (SPEC.md 5.6) -- and no face at all. `solveHandFromPose`
 * already covers a missing hand on any backend, so the degradation is
 * automatic rather than special-cased here.
 *
 * This exists for devices that cannot afford Holistic, not as a quality
 * option: Holistic tracks better on every axis including the body. On a
 * phone an inference costs 288ms against a desktop's 20ms, and the hands and
 * face are three of Holistic's five sub-graphs (SPEC.md 9.5). Giving them up
 * is the one lever large enough to matter.
 */

import { PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { LANDMARK_COUNT, type PoseFrame } from "../types.ts";
import { assetUrls } from "./assets.ts";
import {
  VideoTracker,
  visionFileset,
  type DelegatePreference,
  type FrameSource,
  type TrackerDelegate,
} from "./tracker.ts";

export interface PoseTrackerOptions {
  /** Which delegate to build on; `auto` is GPU with a CPU fallback. Honoured
   *  rather than ignored, because the delegate is the other half of the
   *  mobile question this backend exists for (SPEC.md 9.5). */
  readonly delegate?: DelegatePreference;
  /** Raised from the 0.5 default: a confident miss is better than a confident
   *  hallucination, which is what low thresholds produce on occluded limbs. */
  readonly minPoseDetectionConfidence?: number;
  readonly minPosePresenceConfidence?: number;
  readonly minTrackingConfidence?: number;
}

export class PoseTracker extends VideoTracker<PoseLandmarker> {
  override readonly name = "pose";
  override readonly tracksHands = false;
  override readonly tracksFace = false;

  private readonly options: PoseTrackerOptions;

  // Reused across frames: at 30Hz, allocating typed arrays per frame is pure
  // garbage-collector pressure for no benefit.
  private readonly world = new Float32Array(LANDMARK_COUNT * 3);
  private readonly image = new Float32Array(LANDMARK_COUNT * 3);
  private readonly visibility = new Float32Array(LANDMARK_COUNT);

  constructor(options: PoseTrackerOptions = {}) {
    super(options.delegate ?? "auto");
    this.options = options;
  }

  protected override async build(delegate: TrackerDelegate): Promise<PoseLandmarker> {
    const fileset = await visionFileset();
    return PoseLandmarker.createFromOptions(fileset, {
      // From the seam rather than a const: in a worker the url has to be
      // absolute and is supplied by the main thread (see assets.ts).
      baseOptions: { modelAssetPath: assetUrls().poseModel, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: this.options.minPoseDetectionConfidence ?? 0.6,
      minPosePresenceConfidence: this.options.minPosePresenceConfidence ?? 0.6,
      minTrackingConfidence: this.options.minTrackingConfidence ?? 0.6,
    });
  }

  protected override process(
    landmarker: PoseLandmarker,
    source: FrameSource,
    timestampMs: number,
  ): PoseFrame | null {
    const result: PoseLandmarkerResult = landmarker.detectForVideo(source, timestampMs);
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
      // Null rather than absent: this backend never looks for either.
      leftHand: null,
      rightHand: null,
      face: null,
    };
  }
}
