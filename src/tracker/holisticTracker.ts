/*
 * HolisticLandmarker backend: body plus both hands in one graph.
 *
 * Chosen over adding HandLandmarker as a second graph because Holistic
 * returns the hands already separated by side, derived from the same body.
 * A standalone hand model detects hands independently, so each one has to be
 * matched back to an arm -- via a handedness classifier that flips when hands
 * are close together, or nearest-wrist matching that has to stay consistent
 * with the mirror swap. Holistic removes that problem rather than solving it.
 *
 * Face landmarks come back whether or not they are wanted, but blendshapes
 * are opt-in and stay off while face tracking is deferred (SPEC.md 11).
 */

import {
  HolisticLandmarker,
  type HolisticLandmarkerResult,
  type Landmark,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import {
  BLENDSHAPE_COUNT,
  BLENDSHAPE_INDEX,
} from "./faceBlendshapes.ts";
import {
  HAND_LANDMARK_COUNT,
  LANDMARK_COUNT,
  type FaceFrame,
  type HandFrame,
  type PoseFrame,
} from "../types.ts";
import { VideoTracker, visionFileset, type TrackerDelegate } from "./tracker.ts";

const MODEL_PATH = "/models/holistic_landmarker.task";

export interface HolisticTrackerOptions {
  readonly minPoseDetectionConfidence?: number;
  readonly minPosePresenceConfidence?: number;
  readonly minHandLandmarksConfidence?: number;
}

/** Mutable hand buffer; the frame exposes it as a readonly HandFrame. */
interface HandBuffer {
  world: Float32Array;
  image: Float32Array;
  present: boolean;
}

export class HolisticTracker extends VideoTracker<HolisticLandmarker> {
  override readonly name = "holistic";
  override readonly tracksHands = true;

  private readonly options: HolisticTrackerOptions;

  private readonly world = new Float32Array(LANDMARK_COUNT * 3);
  private readonly image = new Float32Array(LANDMARK_COUNT * 3);
  private readonly visibility = new Float32Array(LANDMARK_COUNT);
  private readonly faceScores = new Float32Array(BLENDSHAPE_COUNT);
  private facePresent = false;

  private readonly left: HandBuffer = {
    world: new Float32Array(HAND_LANDMARK_COUNT * 3),
    image: new Float32Array(HAND_LANDMARK_COUNT * 2),
    present: false,
  };
  private readonly right: HandBuffer = {
    world: new Float32Array(HAND_LANDMARK_COUNT * 3),
    image: new Float32Array(HAND_LANDMARK_COUNT * 2),
    present: false,
  };

  constructor(options: HolisticTrackerOptions = {}) {
    super();
    this.options = options;
  }

  protected override async build(delegate: TrackerDelegate): Promise<HolisticLandmarker> {
    const fileset = await visionFileset();
    return HolisticLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      minPoseDetectionConfidence: this.options.minPoseDetectionConfidence ?? 0.6,
      minPosePresenceConfidence: this.options.minPosePresenceConfidence ?? 0.6,
      minHandLandmarksConfidence: this.options.minHandLandmarksConfidence ?? 0.5,
      // The face graph runs regardless; this adds the blendshape classifier
      // on top, which is the part that costs extra (SPEC.md 13).
      outputFaceBlendshapes: true,
      outputPoseSegmentationMasks: false,
    });
  }

  protected override process(
    landmarker: HolisticLandmarker,
    video: HTMLVideoElement,
    timestampMs: number,
  ): PoseFrame | null {
    const result: HolisticLandmarkerResult = landmarker.detectForVideo(video, timestampMs);

    const world = result.poseWorldLandmarks[0];
    const image = result.poseLandmarks[0];
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

      this.visibility[i] = p.visibility ?? 1;
    }

    this.fillFace(result.faceBlendshapes[0]);

    fillHand(this.left, result.leftHandWorldLandmarks[0], result.leftHandLandmarks[0]);
    fillHand(this.right, result.rightHandWorldLandmarks[0], result.rightHandLandmarks[0]);

    return {
      world: this.world,
      image: this.image,
      visibility: this.visibility,
      timestampMs,
      leftHand: this.left as HandFrame,
      rightHand: this.right as HandFrame,
      face: { scores: this.faceScores, present: this.facePresent } as FaceFrame,
    };
  }

  /**
   * Scatters the reported categories into a fixed layout.
   *
   * Matched by name rather than by position: the order is documented but
   * relying on it would make a silent total misattribution the failure mode
   * of any upstream change.
   */
  private fillFace(classification: { categories: { categoryName: string; score: number }[] } | undefined): void {
    if (!classification || classification.categories.length === 0) {
      this.facePresent = false;
      return;
    }
    this.faceScores.fill(0);
    for (const c of classification.categories) {
      const i = BLENDSHAPE_INDEX[c.categoryName];
      if (i !== undefined) this.faceScores[i] = c.score;
    }
    this.facePresent = true;
  }
}

/**
 * Holistic labels hands by the SUBJECT's side, the same convention as the
 * pose landmarks, so no reassignment is needed here. Mirroring is applied
 * downstream in the coordinate conversion, as for everything else.
 */
function fillHand(
  buffer: HandBuffer,
  landmarks: Landmark[] | undefined,
  image: NormalizedLandmark[] | undefined,
): void {
  if (!landmarks || landmarks.length < HAND_LANDMARK_COUNT) {
    buffer.present = false;
    return;
  }
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    const lm = landmarks[i];
    if (lm) {
      const o = i * 3;
      buffer.world[o] = lm.x;
      buffer.world[o + 1] = lm.y;
      buffer.world[o + 2] = lm.z;
    }
    const px = image?.[i];
    if (px) {
      buffer.image[i * 2] = px.x;
      buffer.image[i * 2 + 1] = px.y;
    }
  }
  buffer.present = true;
}
