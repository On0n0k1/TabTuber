/*
 * Landmark -> bone rotation solver (SPEC.md section 5).
 *
 * Writes LOCAL rotations for each driven bone into an AvatarPose. Assumes the
 * target rig has identity rest orientation on every bone, which is what
 * three-vrm's normalised humanoid provides and what the reference rig models.
 * So a bone's world rest direction is just tail - head, and no per-bone basis
 * correction is needed.
 *
 * Method: build a world rotation per bone, then convert to local by removing
 * the parent's accumulated world rotation. Parents are always solved first.
 *
 * Positions are never copied to the rig -- only rotations. That is why avatar
 * proportions are free and no skeleton matching against the user is required
 * (SPEC.md section 2).
 */

import { LM, SOLVER_LANDMARKS } from "../tracker/landmarks.ts";
import {
  BONE_INDEX,
  BONE_COUNT,
  type AvatarPose,
  type HumanBoneName,
} from "../types.ts";
import { midpoint, readPoint } from "./coords.ts";
import { restDirOf } from "./referenceRig.ts";
import {
  copyQ,
  cross,
  dot,
  fromBasis,
  fromUnitVectors,
  identity,
  invert,
  multiply,
  normalize,
  quat,
  rejectFrom,
  rotateV3,
  setAxisAngle,
  slerp,
  sub,
  v3,
  type Q4,
  type V3,
} from "./math.ts";

export interface SolverOptions {
  /**
   * Share of total torso rotation taken by spine, chest and upperChest.
   * Must sum to 1. Bending at one joint reads as a hinge; spreading it
   * across three reads as a spine (SPEC.md 5.4). Ratios are provisional and
   * want tuning against a real model (SPEC.md 13).
   */
  torsoSplit: [number, number, number];
  /** Share of head rotation taken by the neck rather than the head bone. */
  neckShare: number;
  /** Derive forearm roll from the hand plane (SPEC.md 5.6). */
  twist: boolean;
  /** Below this mean visibility a chain is released to rest (SPEC.md 5.7). */
  visibilityThreshold: number;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  torsoSplit: [0.3, 0.3, 0.4],
  neckShare: 0.4,
  twist: true,
  visibilityThreshold: 0.5,
};

/**
 * The hand-plane normal flips sign between hands, because the hands are
 * mirror images. One bit per side, and the overall polarity is confirmed
 * visually against the stick figure (SPEC.md 13).
 */
const TWIST_SIGN = { left: 1, right: -1 } as const;

type Side = "left" | "right";

interface ArmLandmarks {
  shoulder: number;
  elbow: number;
  wrist: number;
  index: number;
  pinky: number;
}

const ARM: Record<Side, ArmLandmarks> = {
  left: {
    shoulder: LM.LEFT_SHOULDER,
    elbow: LM.LEFT_ELBOW,
    wrist: LM.LEFT_WRIST,
    index: LM.LEFT_INDEX,
    pinky: LM.LEFT_PINKY,
  },
  right: {
    shoulder: LM.RIGHT_SHOULDER,
    elbow: LM.RIGHT_ELBOW,
    wrist: LM.RIGHT_WRIST,
    index: LM.RIGHT_INDEX,
    pinky: LM.RIGHT_PINKY,
  },
};

/** Signed angle from `a` to `b` measured about unit `axis`. */
function signedAngleAbout(
  a: Readonly<V3>,
  b: Readonly<V3>,
  axis: Readonly<V3>,
  scratchA: V3,
  scratchB: V3,
  scratchC: V3,
): number {
  normalize(scratchA, rejectFrom(scratchA, a, axis));
  normalize(scratchB, rejectFrom(scratchB, b, axis));
  cross(scratchC, scratchA, scratchB);
  return Math.atan2(dot(scratchC, axis), dot(scratchA, scratchB));
}

export class PoseSolver {
  options: SolverOptions;

  /** World rotation per bone, indexed by BONE_INDEX. Reused across frames. */
  private readonly world: Q4[] = Array.from({ length: BONE_COUNT }, () => quat());

  // Scratch. The solver allocates nothing per frame.
  private readonly hipMid = v3();
  private readonly shoulderMid = v3();
  private readonly earMid = v3();
  private readonly handMid = v3();
  private readonly axisX = v3();
  private readonly axisY = v3();
  private readonly axisZ = v3();
  private readonly pa = v3();
  private readonly pb = v3();
  private readonly pc = v3();
  private readonly sa = v3();
  private readonly sb = v3();
  private readonly sc = v3();
  private readonly ref = v3();
  private readonly normal = v3();
  private readonly qa = quat();
  private readonly qb = quat();
  private readonly qTwist = quat();
  // Private to setWorld. Sharing scratch with callers let an argument be
  // destroyed before it was read; see the local-rotation note there.
  private readonly qInv = quat();
  private readonly qLocal = quat();
  // Private to computeTwist, which reads landmarks after its caller has
  // already stored the wrist it still needs.
  private readonly ta = v3();
  private readonly tb = v3();
  private readonly tc = v3();
  private readonly torso = quat();
  private readonly headWorld = quat();
  private readonly ident = quat();

  constructor(options: SolverOptions = DEFAULT_SOLVER_OPTIONS) {
    this.options = { ...options };
    identity(this.ident);
  }

  /**
   * `points` is LANDMARK_COUNT * 3 in three.js space, already converted by
   * mpToThree. The solver never flips an axis itself.
   */
  solve(points: Float32Array, visibility: Float32Array, pose: AvatarPose): void {
    pose.confidence = meanVisibility(visibility, SOLVER_LANDMARKS);

    this.resetAll(pose);
    this.solveTorso(points, pose);
    this.solveHead(points, visibility, pose);
    this.solveArm(points, visibility, pose, "left");
    this.solveArm(points, visibility, pose, "right");
    // Legs and eyes stay at rest: legs are not driven in the seated profile
    // (SPEC.md 5.7) and eyes are procedural (SPEC.md section 8).
  }

  /** Bones no solver stage writes must be at rest, not stale from last frame. */
  private resetAll(pose: AvatarPose): void {
    for (let i = 0; i < BONE_COUNT; i++) {
      identity(this.world[i] as Q4);
      const o = i * 4;
      pose.rotations[o] = 0;
      pose.rotations[o + 1] = 0;
      pose.rotations[o + 2] = 0;
      pose.rotations[o + 3] = 1;
    }
  }

  private setWorld(pose: AvatarPose, bone: HumanBoneName, world: Readonly<Q4>, parentWorld: Readonly<Q4>): void {
    const idx = BONE_INDEX[bone];
    copyQ(this.world[idx] as Q4, world);

    // local = parentWorld^-1 * world.
    //
    // qInv and qLocal are used nowhere else on purpose. Callers routinely
    // pass one of the shared scratch quaternions as `world`, and inverting
    // the parent into that same buffer would destroy the argument before it
    // is read.
    invert(this.qInv, parentWorld);
    multiply(this.qLocal, this.qInv, world);

    const o = idx * 4;
    pose.rotations[o] = this.qLocal[0];
    pose.rotations[o + 1] = this.qLocal[1];
    pose.rotations[o + 2] = this.qLocal[2];
    pose.rotations[o + 3] = this.qLocal[3];
  }

  private worldOf(bone: HumanBoneName): Readonly<Q4> {
    return this.world[BONE_INDEX[bone]] as Q4;
  }

  /**
   * Torso orientation from the shoulder line against the hip line, spread
   * across the three spine segments (SPEC.md 5.4).
   *
   * Hips stay at identity: the waist is anchored and everything rotates
   * relative to it (SPEC.md 5.5).
   */
  private solveTorso(points: Float32Array, pose: AvatarPose): void {
    midpoint(this.hipMid, points, LM.LEFT_HIP, LM.RIGHT_HIP);
    midpoint(this.shoulderMid, points, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER);

    normalize(this.axisY, sub(this.axisY, this.shoulderMid, this.hipMid));

    readPoint(this.pa, points, LM.LEFT_SHOULDER);
    readPoint(this.pb, points, LM.RIGHT_SHOULDER);
    normalize(this.axisX, sub(this.axisX, this.pa, this.pb));

    // left x up = forward, then rebuild left from up x forward so the basis
    // is orthonormal. Landmark-derived axes never are exactly.
    normalize(this.axisZ, cross(this.axisZ, this.axisX, this.axisY));
    normalize(this.axisX, cross(this.axisX, this.axisY, this.axisZ));

    fromBasis(this.torso, this.axisX, this.axisY, this.axisZ);

    const [s0, s1] = this.options.torsoSplit;
    // Cumulative shares, so upperChest lands exactly on the full torso
    // rotation rather than approximately.
    const cumulative: [number, number, number] = [s0, s0 + s1, 1];
    const chain: HumanBoneName[] = ["spine", "chest", "upperChest"];

    let parent: Readonly<Q4> = this.worldOf("hips");
    for (let i = 0; i < chain.length; i++) {
      const bone = chain[i] as HumanBoneName;
      slerp(this.qTwist, this.ident, this.torso, cumulative[i] as number);
      this.setWorld(pose, bone, this.qTwist, parent);
      parent = this.worldOf(bone);
    }
  }

  /**
   * Full head orientation from nose and both ears -- three points give yaw,
   * pitch and roll, so no face tracking is needed for this (SPEC.md 5.6).
   */
  private solveHead(points: Float32Array, visibility: Float32Array, pose: AvatarPose): void {
    const upperChest = this.worldOf("upperChest");
    if (meanVisibility(visibility, [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) < this.options.visibilityThreshold) {
      this.setWorld(pose, "neck", upperChest, upperChest);
      this.setWorld(pose, "head", upperChest, this.worldOf("neck"));
      return;
    }

    midpoint(this.earMid, points, LM.LEFT_EAR, LM.RIGHT_EAR);
    readPoint(this.pa, points, LM.NOSE);
    normalize(this.axisZ, sub(this.axisZ, this.pa, this.earMid));

    readPoint(this.pb, points, LM.LEFT_EAR);
    readPoint(this.pc, points, LM.RIGHT_EAR);
    normalize(this.axisX, sub(this.axisX, this.pb, this.pc));

    // forward x left = up, then rebuild left from up x forward.
    normalize(this.axisY, cross(this.axisY, this.axisZ, this.axisX));
    normalize(this.axisX, cross(this.axisX, this.axisY, this.axisZ));

    fromBasis(this.headWorld, this.axisX, this.axisY, this.axisZ);

    // The neck takes a share so the head does not appear to pivot on a ball
    // joint at the shoulders.
    slerp(this.qTwist, upperChest, this.headWorld, this.options.neckShare);
    this.setWorld(pose, "neck", this.qTwist, upperChest);
    this.setWorld(pose, "head", this.headWorld, this.worldOf("neck"));
  }

  /**
   * Arm chain. Shoulders are left at rest for now -- shrug is derivable from
   * shoulder elevation but adds noise, and whether it earns that is still
   * open (SPEC.md 13).
   */
  private solveArm(points: Float32Array, visibility: Float32Array, pose: AvatarPose, side: Side): void {
    const lm = ARM[side];
    const upperChest = this.worldOf("upperChest");
    const shoulderBone = `${side}Shoulder` as HumanBoneName;
    const upperBone = `${side}UpperArm` as HumanBoneName;
    const lowerBone = `${side}LowerArm` as HumanBoneName;
    const handBone = `${side}Hand` as HumanBoneName;

    this.setWorld(pose, shoulderBone, upperChest, upperChest);
    const shoulderWorld = this.worldOf(shoulderBone);

    if (meanVisibility(visibility, [lm.shoulder, lm.elbow, lm.wrist]) < this.options.visibilityThreshold) {
      return;
    }

    // Upper arm: shoulder -> elbow. Swing only; roll about the bone's own
    // axis is not recoverable from two points (SPEC.md 5.6).
    readPoint(this.pa, points, lm.shoulder);
    readPoint(this.pb, points, lm.elbow);
    normalize(this.axisX, sub(this.axisX, this.pb, this.pa));
    fromUnitVectors(this.qa, restDirOf(upperBone), this.axisX);
    this.setWorld(pose, upperBone, this.qa, shoulderWorld);

    // Lower arm: elbow -> wrist.
    readPoint(this.pc, points, lm.wrist);
    normalize(this.axisY, sub(this.axisY, this.pc, this.pb));
    fromUnitVectors(this.qb, restDirOf(lowerBone), this.axisY);

    const twisted = this.computeTwist(points, visibility, lm, side, this.qb, this.axisY);
    if (twisted) multiply(this.qb, this.qTwist, this.qb);
    this.setWorld(pose, lowerBone, this.qb, this.worldOf(upperBone));

    // Hand: wrist -> midpoint of index and pinky.
    midpoint(this.handMid, points, lm.index, lm.pinky);
    normalize(this.axisZ, sub(this.axisZ, this.handMid, this.pc));
    fromUnitVectors(this.qa, restDirOf(handBone), this.axisZ);
    // Carry the forearm twist through, otherwise the hand counter-rotates by
    // exactly the twist that was just applied to its parent.
    if (twisted) multiply(this.qa, this.qTwist, this.qa);
    this.setWorld(pose, handBone, this.qa, this.worldOf(lowerBone));
  }

  /**
   * Forearm roll from the hand plane.
   *
   * Wrist, index and pinky define a plane whose normal rolls with the
   * forearm, which recovers the one rotation two joints cannot give
   * (SPEC.md 5.6). Noisier than the swing, so it is gated and toggleable.
   *
   * Returns true if `this.qTwist` holds a twist to apply.
   */
  private computeTwist(
    points: Float32Array,
    visibility: Float32Array,
    lm: ArmLandmarks,
    side: Side,
    swing: Readonly<Q4>,
    boneAxis: Readonly<V3>,
  ): boolean {
    if (!this.options.twist) return false;
    if (meanVisibility(visibility, [lm.index, lm.pinky]) < this.options.visibilityThreshold) {
      return false;
    }

    readPoint(this.ta, points, lm.wrist);
    readPoint(this.tb, points, lm.index);
    readPoint(this.tc, points, lm.pinky);
    sub(this.sa, this.tb, this.ta);
    sub(this.sb, this.tc, this.ta);
    cross(this.normal, this.sa, this.sb);
    if (normalizeLength(this.normal) < 1e-5) return false;
    normalize(this.normal, this.normal);

    const sign = TWIST_SIGN[side];
    this.normal[0] *= sign;
    this.normal[1] *= sign;
    this.normal[2] *= sign;

    // Where the rest "up" axis ended up after the swing, versus where the
    // hand plane says it should be.
    rotateV3(this.ref, swing, [0, 1, 0]);
    const angle = signedAngleAbout(this.ref, this.normal, boneAxis, this.sa, this.sb, this.sc);
    if (!Number.isFinite(angle)) return false;

    setAxisAngle(this.qTwist, boneAxis, angle);
    return true;
  }
}

function normalizeLength(a: Readonly<V3>): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function meanVisibility(visibility: Float32Array, indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += visibility[i] ?? 0;
  return sum / indices.length;
}
