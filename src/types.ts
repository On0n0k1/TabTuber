/*
 * Pipeline data contracts.
 *
 * These types are the boundary between stages. Deliberately free of both
 * MediaPipe and three.js types: the tracker must not leak MediaPipe shapes
 * downstream, and the solver must not depend on three.js. See CLAUDE.md.
 *
 * Rotations are stored in a flat Float32Array rather than a Map of objects.
 * That is not premature optimisation -- it is the exact layout the eventual
 * Rust solver expects (SPEC.md section 10: one Float32Array in, one out), so
 * adopting it now means the port changes no call sites.
 */

/** Quaternion, xyzw order (matching three.js and glTF). */
export type Quat = readonly [x: number, y: number, z: number, w: number];

export type Vec3 = readonly [x: number, y: number, z: number];

export const LANDMARK_COUNT = 33;

/** MediaPipe hand topology: wrist plus four joints on each of five fingers. */
export const HAND_LANDMARK_COUNT = 21;

/**
 * One hand, when the tracking backend provides one.
 *
 * Only Holistic supplies these. The pose model carries three crude knuckle
 * estimates inside its own 33 landmarks and nothing more, which is too weak a
 * signal for hand orientation (SPEC.md 5.6).
 */
export interface HandFrame {
  /** HAND_LANDMARK_COUNT * 3, metric, origin at the hand's geometric centre. */
  readonly world: Float32Array;
  /**
   * HAND_LANDMARK_COUNT * 2, normalised image space, x and y only.
   *
   * Depth is deliberately absent: this exists to measure how the hand is
   * presented to the camera, and the whole point is that information hidden
   * in depth is the information that is missing (SPEC.md 12).
   */
  readonly image: Float32Array;
  /** False when the backend ran but found no hand this frame. */
  readonly present: boolean;
}

/**
 * One tracking result.
 *
 * `world` is metric (metres) with the origin at the hip midpoint, and is what
 * the solver uses. `image` is normalised image space and is used for the 2D
 * overlay and for hip sway, which is derived from image position rather than
 * depth because depth is the unreliable axis (SPEC.md 5.5).
 */
export interface PoseFrame {
  /** LANDMARK_COUNT * 3, metric, origin at hip midpoint. */
  readonly world: Float32Array;
  /** LANDMARK_COUNT * 3, normalised image space. */
  readonly image: Float32Array;
  /** LANDMARK_COUNT, 0..1. */
  readonly visibility: Float32Array;
  /** Frame timestamp, milliseconds, monotonic. */
  readonly timestampMs: number;
  /**
   * Null when the backend does not track hands at all, as distinct from a
   * HandFrame with `present: false`, which means it looked and found none.
   * The solver needs to tell those apart to choose its derivation.
   */
  readonly leftHand: HandFrame | null;
  readonly rightHand: HandFrame | null;
}

/**
 * VRM 1.0 humanoid bones this project drives, in buffer order.
 *
 * Names match the VRM 1.0 humanoid spec exactly, so they can be handed to
 * `vrm.humanoid.getNormalizedBoneNode()` without translation.
 *
 * Legs are present but are never driven from landmarks -- seated users have
 * them occluded and MediaPipe hallucinates them confidently (SPEC.md 5.7).
 * They exist because VRM requires them and the idle animation moves them.
 */
export const DRIVEN_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftEye",
  "rightEye",
] as const;

export type HumanBoneName = (typeof DRIVEN_BONES)[number];

export const BONE_COUNT = DRIVEN_BONES.length;

/** Index of each bone within an AvatarPose rotation buffer. */
export const BONE_INDEX: Readonly<Record<HumanBoneName, number>> =
  Object.freeze(
    Object.fromEntries(DRIVEN_BONES.map((name, i) => [name, i])) as Record<
      HumanBoneName,
      number
    >,
  );

/**
 * Solved avatar state for one frame.
 *
 * Instances are reused across frames -- the solver writes in place and the
 * renderer reads before the next solve. Do not retain a reference expecting
 * it to stay stable.
 */
export interface AvatarPose {
  /** BONE_COUNT * 4, xyzw, local rotation relative to the normalised rest pose. */
  readonly rotations: Float32Array;
  /**
   * Hip translation in metres. Clamped horizontal sway only; depth stays 0
   * because monocular depth is too unstable to translate on (SPEC.md 5.5).
   */
  readonly rootOffset: Float32Array;
  /**
   * VRM expression weights, 0..1. Written by procedural blink and lip sync
   * today; this is the seam that makes face tracking additive later rather
   * than a restructure (SPEC.md 4).
   */
  readonly expressions: Map<string, number>;
  /** Overall tracking confidence, 0..1. Drives the blend to idle. */
  confidence: number;
  timestampMs: number;
}

export function createAvatarPose(): AvatarPose {
  const rotations = new Float32Array(BONE_COUNT * 4);
  // Identity rotation, not zero: a zero quaternion is not a rotation and
  // would collapse the skeleton if read before the first solve.
  for (let i = 0; i < BONE_COUNT; i++) rotations[i * 4 + 3] = 1;

  return {
    rotations,
    rootOffset: new Float32Array(3),
    expressions: new Map(),
    confidence: 0,
    timestampMs: 0,
  };
}

export function readBoneQuat(pose: AvatarPose, bone: HumanBoneName): Quat {
  const o = BONE_INDEX[bone] * 4;
  const r = pose.rotations;
  return [r[o] ?? 0, r[o + 1] ?? 0, r[o + 2] ?? 0, r[o + 3] ?? 1];
}

export function writeBoneQuat(
  pose: AvatarPose,
  bone: HumanBoneName,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const o = BONE_INDEX[bone] * 4;
  pose.rotations[o] = x;
  pose.rotations[o + 1] = y;
  pose.rotations[o + 2] = z;
  pose.rotations[o + 3] = w;
}
