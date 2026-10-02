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

import { PALM } from "../tracker/handLandmarks.ts";
import { LM, SOLVER_LANDMARKS, STANDING_LANDMARKS } from "../tracker/landmarks.ts";
import {
  BONE_INDEX,
  BONE_COUNT,
  type AvatarPose,
  type HumanBoneName,
} from "../types.ts";
import { midpoint, readPoint } from "./coords.ts";
import { restDirOf } from "./referenceRig.ts";
import { DEFAULT_IDLE_PARAMS, writeIdleDelta, type IdleParams } from "./idlePose.ts";
import { RELAXED_POSE } from "./relaxedPose.ts";
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

/**
 * Which framing the subject is in (SPEC.md 5.8).
 *
 * Manual rather than detected: automatic detection would have to read leg
 * visibility, but the tracker reports confident visibility for hallucinated
 * out-of-frame legs -- the exact failure being worked around. Deciding with
 * the broken signal is circular.
 */
export type PostureMode = "sitting" | "standing";

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
  /**
   * sitting holds the legs in a standing pose and never drives them, which is
   * right for a subject at a desk. standing drives them from landmarks.
   */
  posture: PostureMode;
  /**
   * Prefer the 21-point palm frame over the pose model's three knuckle
   * estimates when a backend supplies hands. Switchable so the two
   * derivations can be compared directly.
   */
  useHandLandmarks: boolean;
  /** At or above this mean visibility a bone is fully driven (SPEC.md 5.7). */
  visibilityThreshold: number;
  /**
   * Width of the smoothstep band below the threshold. A hard cutoff turns a
   * small confidence difference between limbs into two visibly different
   * behaviours; a band makes it a gradual difference instead.
   */
  blendBand: number;
  /** Seconds the last confident rotation is held before it starts decaying. */
  holdSeconds: number;
  /** Seconds to decay from the held rotation to the relaxed pose. */
  decaySeconds: number;
  /** Clamped lateral hip sway, derived from image space (SPEC.md 5.5). */
  sway: SwayOptions;
}

export interface SwayOptions {
  enabled: boolean;
  /** Metres of sway per unit of normalised image displacement. */
  gain: number;
  /** Hard limit in metres. Depth is never swayed; only lateral. */
  max: number;
  /** Seconds of smoothing on the measured hip position. */
  responseSeconds: number;
  /**
   * Seconds over which the neutral centre adapts.
   *
   * Without this, sitting off-centre in frame would lean the avatar
   * permanently. A slowly-adapting baseline self-calibrates, and makes sway
   * mean "moved recently" rather than "is not centred".
   */
  baselineSeconds: number;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  torsoSplit: [0.3, 0.3, 0.4],
  neckShare: 0.4,
  twist: true,
  posture: "sitting",
  useHandLandmarks: true,
  visibilityThreshold: 0.5,
  blendBand: 0.25,
  holdSeconds: 0.4,
  decaySeconds: 1.2,
  sway: {
    enabled: true,
    gain: 0.4,
    max: 0.09,
    responseSeconds: 0.25,
    baselineSeconds: 12,
  },
};

/**
 * The hand-plane normal flips sign between hands, because the hands are
 * mirror images. One bit per side, and the overall polarity is confirmed
 * visually against the stick figure (SPEC.md 13).
 */
const TWIST_SIGN = { left: 1, right: -1 } as const;

/**
 * The palm frame is mirror-symmetric between hands, so one side's basis comes
 * out left-handed without a sign flip. Verified against a synthetic palm-down
 * T-pose in the solver checks.
 */
const HAND_SIGN = { left: 1, right: -1 } as const;

type Side = "left" | "right";

/** Hand landmarks already converted to three.js space, or null if unavailable. */
export interface HandPoints {
  readonly left: Float32Array | null;
  readonly right: Float32Array | null;
}

interface ArmLandmarks {
  shoulder: number;
  elbow: number;
  wrist: number;
  index: number;
  pinky: number;
}

interface LegLandmarks {
  hip: number;
  knee: number;
  ankle: number;
  foot: number;
  heel: number;
}

const LEG: Record<Side, LegLandmarks> = {
  left: {
    hip: LM.LEFT_HIP,
    knee: LM.LEFT_KNEE,
    ankle: LM.LEFT_ANKLE,
    foot: LM.LEFT_FOOT_INDEX,
    heel: LM.LEFT_HEEL,
  },
  right: {
    hip: LM.RIGHT_HIP,
    knee: LM.RIGHT_KNEE,
    ankle: LM.RIGHT_ANKLE,
    foot: LM.RIGHT_FOOT_INDEX,
    heel: LM.RIGHT_HEEL,
  },
};

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

/** Weight at or above which a rotation is trusted enough to remember. */
const TRUSTWORTHY = 0.9;

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

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
  /** Idle motion applied to whatever is not being tracked (SPEC.md 8). */
  idle: IdleParams = { ...DEFAULT_IDLE_PARAMS };

  /** World rotation per bone, indexed by BONE_INDEX. Reused across frames. */
  private readonly world: Q4[] = Array.from({ length: BONE_COUNT }, () => quat());

  /**
   * How much each bone is being driven by tracking this frame, 0 to 1.
   * Exposed so the panel can show why a limb is behaving as it is, rather
   * than leaving it to be inferred from the motion.
   */
  readonly weights = new Float32Array(BONE_COUNT);

  /** Last rotation trusted enough to fall back on, and its age in seconds. */
  private readonly lastGood: Q4[] = Array.from({ length: BONE_COUNT }, () => quat());
  private readonly sinceGood = new Float32Array(BONE_COUNT).fill(Number.MAX_SAFE_INTEGER);
  private lastTimestampMs = -1;

  /**
   * Per-bone idle deltas for this frame, rebuilt once per solve rather than
   * per bone. Composed onto every bone regardless of tracking, since the
   * spine is never gated and would otherwise never breathe (SPEC.md 8).
   */
  private readonly idleDelta = new Float32Array(BONE_COUNT * 4);
  private idleElapsed = 0;

  /** Smoothed hip position and its slowly-adapting neutral, image space. */
  private hipX = Number.NaN;
  private hipBaseline = Number.NaN;

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
  private readonly palmX = v3();
  private readonly palmY = v3();
  private readonly palmZ = v3();
  private readonly qPalm = quat();
  private readonly qa = quat();
  private readonly qb = quat();
  private readonly qTwist = quat();
  // Private to setBone. Sharing scratch with callers let an argument be
  // destroyed before it was read; see the note there.
  private readonly qInv = quat();
  // Private to setBone, for the same reason qInv and qLocal are.
  private readonly qSolved = quat();
  private readonly qFallback = quat();
  private readonly qFinal = quat();
  private readonly qWorld = quat();
  private readonly qIdle = quat();
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
  solve(
    points: Float32Array,
    visibility: Float32Array,
    pose: AvatarPose,
    timestampMs = 0,
    hands: HandPoints | null = null,
    imagePoints: Float32Array | null = null,
  ): void {
    // Legs count toward confidence only when something is driving them.
    pose.confidence =
      this.options.posture === "standing"
        ? meanVisibility(visibility, [...SOLVER_LANDMARKS, ...STANDING_LANDMARKS])
        : meanVisibility(visibility, SOLVER_LANDMARKS);

    const elapsed = (timestampMs - this.lastTimestampMs) / 1000;
    // Guards the first frame and any timestamp that fails to advance.
    const dt = elapsed > 0 && elapsed < 1 ? elapsed : 1 / 30;
    this.lastTimestampMs = timestampMs;

    this.idleElapsed += dt;
    writeIdleDelta(this.idleDelta, this.idleElapsed, this.idle);

    this.resetAll(pose);
    this.solveTorso(points, pose, dt);
    this.solveHead(points, visibility, pose, dt);
    this.solveArm(points, visibility, pose, "left", dt, hands?.left ?? null);
    this.solveArm(points, visibility, pose, "right", dt, hands?.right ?? null);

    if (this.options.posture === "standing") {
      this.solveLeg(points, visibility, pose, "left", dt);
      this.solveLeg(points, visibility, pose, "right", dt);
    }

    this.solveSway(imagePoints, pose, dt);
    // In sitting posture the legs stay at rest, which is a standing pose for
    // them, so the character reads as standing regardless of what the
    // subject's lower body is doing (SPEC.md 5.8). Eyes are procedural (§8).
  }

  /** Bones no solver stage writes must be at rest, not stale from last frame. */
  private resetAll(pose: AvatarPose): void {
    for (let i = 0; i < BONE_COUNT; i++) {
      identity(this.world[i] as Q4);
      this.weights[i] = 0;
      const o = i * 4;
      pose.rotations[o] = 0;
      pose.rotations[o + 1] = 0;
      pose.rotations[o + 2] = 0;
      pose.rotations[o + 3] = 1;
    }
  }

  /**
   * Writes a bone, blending the solved rotation against a fallback according
   * to confidence (SPEC.md 5.7).
   *
   * Blending happens in LOCAL space. The fallback -- last-good decaying to the
   * relaxed pose -- is a local rotation, and holding it locally means a limb
   * does not inherit its parent's drift while it is untracked.
   *
   * `confidence` of 1 means "always trust", used for bones that are not gated.
   */
  private setBone(
    pose: AvatarPose,
    bone: HumanBoneName,
    world: Readonly<Q4>,
    parentWorld: Readonly<Q4>,
    confidence: number,
    dt: number,
  ): void {
    const idx = BONE_INDEX[bone];
    const opts = this.options;

    // qInv and the q* scratch below are used nowhere else on purpose. Callers
    // routinely pass one of the shared scratch quaternions as `world`, and
    // writing into that same buffer would destroy the argument before use.
    invert(this.qInv, parentWorld);
    multiply(this.qSolved, this.qInv, world);

    const weight = smoothstep(
      opts.visibilityThreshold - opts.blendBand,
      opts.visibilityThreshold,
      confidence,
    );
    this.weights[idx] = weight;

    if (weight >= TRUSTWORTHY) {
      copyQ(this.lastGood[idx] as Q4, this.qSolved);
      this.sinceGood[idx] = 0;
      copyQ(this.qFinal, this.qSolved);
    } else {
      const age = (this.sinceGood[idx] ?? 0) + dt;
      this.sinceGood[idx] = age;

      // Hold, then decay. Without the timeout a permanently occluded limb
      // would freeze forever in whatever position it was last seen.
      const decay =
        opts.decaySeconds <= 0
          ? 1
          : Math.min(1, Math.max(0, (age - opts.holdSeconds) / opts.decaySeconds));

      slerp(this.qFallback, this.lastGood[idx] as Q4, RELAXED_POSE[idx] as Q4, decay);
      slerp(this.qFinal, this.qFallback, this.qSolved, weight);
    }

    // Idle rides on top of whatever was decided above, tracked or not.
    const io = idx * 4;
    this.qIdle[0] = this.idleDelta[io] ?? 0;
    this.qIdle[1] = this.idleDelta[io + 1] ?? 0;
    this.qIdle[2] = this.idleDelta[io + 2] ?? 0;
    this.qIdle[3] = this.idleDelta[io + 3] ?? 1;
    multiply(this.qFinal, this.qFinal, this.qIdle);

    multiply(this.qWorld, parentWorld, this.qFinal);
    copyQ(this.world[idx] as Q4, this.qWorld);

    const o = idx * 4;
    pose.rotations[o] = this.qFinal[0];
    pose.rotations[o + 1] = this.qFinal[1];
    pose.rotations[o + 2] = this.qFinal[2];
    pose.rotations[o + 3] = this.qFinal[3];
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
  private solveTorso(points: Float32Array, pose: AvatarPose, dt: number): void {
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
      // Ungated: hips and spine are derived from shoulder and hip landmarks,
      // which are the last things to leave frame for a seated subject.
      this.setBone(pose, bone, this.qTwist, parent, 1, dt);
      parent = this.worldOf(bone);
    }
  }

  /**
   * Full head orientation from nose and both ears -- three points give yaw,
   * pitch and roll, so no face tracking is needed for this (SPEC.md 5.6).
   */
  private solveHead(
    points: Float32Array,
    visibility: Float32Array,
    pose: AvatarPose,
    dt: number,
  ): void {
    const upperChest = this.worldOf("upperChest");
    const confidence = meanVisibility(visibility, [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]);

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
    this.setBone(pose, "neck", this.qTwist, upperChest, confidence, dt);
    this.setBone(pose, "head", this.headWorld, this.worldOf("neck"), confidence, dt);
  }

  /**
   * Arm chain. Shoulders are left at rest for now -- shrug is derivable from
   * shoulder elevation but adds noise, and whether it earns that is still
   * open (SPEC.md 13).
   */
  private solveArm(
    points: Float32Array,
    visibility: Float32Array,
    pose: AvatarPose,
    side: Side,
    dt: number,
    hand: Float32Array | null,
  ): void {
    const lm = ARM[side];
    const upperChest = this.worldOf("upperChest");
    const shoulderBone = `${side}Shoulder` as HumanBoneName;
    const upperBone = `${side}UpperArm` as HumanBoneName;
    const lowerBone = `${side}LowerArm` as HumanBoneName;
    const handBone = `${side}Hand` as HumanBoneName;

    this.setBone(pose, shoulderBone, upperChest, upperChest, 1, dt);
    const shoulderWorld = this.worldOf(shoulderBone);

    // Gated per bone, not per chain. One number for the whole arm meant a
    // hand leaving frame also killed the shoulder, discarding good data.
    const upperConfidence = meanVisibility(visibility, [lm.shoulder, lm.elbow]);
    const lowerConfidence = meanVisibility(visibility, [lm.elbow, lm.wrist]);
    const handConfidence = meanVisibility(visibility, [lm.wrist, lm.index, lm.pinky]);

    // Upper arm: shoulder -> elbow. Swing only; roll about the bone's own
    // axis is not recoverable from two points (SPEC.md 5.6).
    readPoint(this.pa, points, lm.shoulder);
    readPoint(this.pb, points, lm.elbow);
    normalize(this.axisX, sub(this.axisX, this.pb, this.pa));
    fromUnitVectors(this.qa, restDirOf(upperBone), this.axisX);
    this.setBone(pose, upperBone, this.qa, shoulderWorld, upperConfidence, dt);

    // Lower arm: elbow -> wrist.
    readPoint(this.pc, points, lm.wrist);
    normalize(this.axisY, sub(this.axisY, this.pc, this.pb));
    fromUnitVectors(this.qb, restDirOf(lowerBone), this.axisY);

    // A real palm frame beats the pose model's three knuckle estimates for
    // both roll and hand direction, so it is preferred when available.
    const palm = this.usePalmFrame(hand) ? this.solvePalm(hand as Float32Array, side) : false;

    const twisted = palm
      ? this.twistFromPalm(this.qb, this.axisY)
      : this.computeTwist(points, visibility, lm, side, this.qb, this.axisY);
    if (twisted) multiply(this.qb, this.qTwist, this.qb);
    this.setBone(pose, lowerBone, this.qb, this.worldOf(upperBone), lowerConfidence, dt);

    if (palm) {
      // The palm frame is already a full orientation, so it is used directly
      // rather than being rebuilt from a direction plus a separate twist.
      this.setBone(pose, handBone, this.qPalm, this.worldOf(lowerBone), handConfidence, dt);
      return;
    }

    // Fallback: wrist -> midpoint of index and pinky. An 8cm vector from
    // low-fidelity landmarks, which is why the palm frame is preferred.
    midpoint(this.handMid, points, lm.index, lm.pinky);
    normalize(this.axisZ, sub(this.axisZ, this.handMid, this.pc));
    fromUnitVectors(this.qa, restDirOf(handBone), this.axisZ);
    // Carry the forearm twist through, otherwise the hand counter-rotates by
    // exactly the twist that was just applied to its parent.
    if (twisted) multiply(this.qa, this.qTwist, this.qa);
    this.setBone(pose, handBone, this.qa, this.worldOf(lowerBone), handConfidence, dt);
  }

  /**
   * Lateral hip sway (SPEC.md 5.5).
   *
   * Derived from IMAGE space, not world. World landmarks have their origin at
   * the hip midpoint, so the hips sit at zero by construction and cannot
   * report that the body moved at all. Depth is never used: it is the
   * unreliable axis, and the failure mode of swaying on it is the avatar
   * lurching toward and away from the viewer.
   */
  private solveSway(imagePoints: Float32Array | null, pose: AvatarPose, dt: number): void {
    const sway = this.options.sway;
    pose.rootOffset[1] = 0;
    pose.rootOffset[2] = 0;

    if (!sway.enabled || !imagePoints) {
      pose.rootOffset[0] = 0;
      return;
    }

    const measured =
      (((imagePoints[LM.LEFT_HIP * 3] ?? 0.5) + (imagePoints[LM.RIGHT_HIP * 3] ?? 0.5)) / 2);

    // First frame seeds both, so the avatar does not lurch from a zero start.
    if (!Number.isFinite(this.hipX)) {
      this.hipX = measured;
      this.hipBaseline = measured;
    }

    this.hipX += (measured - this.hipX) * approach(dt, sway.responseSeconds);
    this.hipBaseline += (this.hipX - this.hipBaseline) * approach(dt, sway.baselineSeconds);

    const offset = (this.hipX - this.hipBaseline) * sway.gain;
    pose.rootOffset[0] = Math.max(-sway.max, Math.min(sway.max, offset));
  }

  /**
   * Leg chain, standing posture only.
   *
   * Straightforward compared with the arms: no twist is recoverable from
   * hip/knee/ankle alone, and none is worth faking, so each bone is a swing
   * from its rest direction. Feet use the ankle-to-toe direction, which is
   * the noisiest of the three and gated accordingly.
   */
  private solveLeg(
    points: Float32Array,
    visibility: Float32Array,
    pose: AvatarPose,
    side: Side,
    dt: number,
  ): void {
    const lm = LEG[side];
    const hips = this.worldOf("hips");
    const upperBone = `${side}UpperLeg` as HumanBoneName;
    const lowerBone = `${side}LowerLeg` as HumanBoneName;
    const footBone = `${side}Foot` as HumanBoneName;

    readPoint(this.pa, points, lm.hip);
    readPoint(this.pb, points, lm.knee);
    normalize(this.axisX, sub(this.axisX, this.pb, this.pa));
    fromUnitVectors(this.qa, restDirOf(upperBone), this.axisX);
    this.setBone(pose, upperBone, this.qa, hips, meanVisibility(visibility, [lm.hip, lm.knee]), dt);

    readPoint(this.pc, points, lm.ankle);
    normalize(this.axisY, sub(this.axisY, this.pc, this.pb));
    fromUnitVectors(this.qb, restDirOf(lowerBone), this.axisY);
    this.setBone(
      pose,
      lowerBone,
      this.qb,
      this.worldOf(upperBone),
      meanVisibility(visibility, [lm.knee, lm.ankle]),
      dt,
    );

    readPoint(this.pa, points, lm.foot);
    normalize(this.axisZ, sub(this.axisZ, this.pa, this.pc));
    fromUnitVectors(this.qa, restDirOf(footBone), this.axisZ);
    this.setBone(
      pose,
      footBone,
      this.qa,
      this.worldOf(lowerBone),
      meanVisibility(visibility, [lm.ankle, lm.heel, lm.foot]),
      dt,
    );
  }

  private usePalmFrame(hand: Float32Array | null): boolean {
    return this.options.useHandLandmarks && hand !== null;
  }

  /**
   * Full hand orientation from the 21-point palm.
   *
   * Wrist to middle knuckle is the hand's long axis and index-to-pinky
   * knuckle spans the palm. Those are close to perpendicular and both span
   * most of the hand, so the basis is well conditioned -- unlike the pose
   * model's index and pinky knuckles, which sit about 30 degrees apart and
   * yield a normal dominated by noise (SPEC.md 5.6).
   *
   * Writes `qPalm` and returns false if the landmarks are degenerate.
   */
  private solvePalm(hand: Float32Array, side: Side): boolean {
    readPoint(this.pa, hand, PALM.ORIGIN);
    readPoint(this.pb, hand, PALM.FORWARD);
    readPoint(this.sa, hand, PALM.INDEX_SIDE);
    readPoint(this.sb, hand, PALM.PINKY_SIDE);

    sub(this.palmX, this.pb, this.pa);
    sub(this.sc, this.sb, this.sa);
    if (vectorLength(this.palmX) < 1e-5 || vectorLength(this.sc) < 1e-5) return false;

    const sign = HAND_SIGN[side];
    normalize(this.palmX, this.palmX);
    normalize(this.sc, this.sc);

    // up = forward x across, with the per-side flip that keeps both hands
    // right-handed; the hands are mirror images of each other.
    cross(this.palmY, this.palmX, this.sc);
    if (vectorLength(this.palmY) < 1e-4) return false;
    normalize(this.palmY, this.palmY);

    this.palmX[0] *= sign;
    this.palmX[1] *= sign;
    this.palmX[2] *= sign;
    this.palmY[0] *= sign;
    this.palmY[1] *= sign;
    this.palmY[2] *= sign;

    // Re-orthogonalise: landmark-derived axes never are exactly.
    normalize(this.palmZ, cross(this.palmZ, this.palmX, this.palmY));
    normalize(this.palmY, cross(this.palmY, this.palmZ, this.palmX));

    fromBasis(this.qPalm, this.palmX, this.palmY, this.palmZ);
    return true;
  }

  /**
   * Forearm roll measured against the palm frame rather than the pose
   * model's three knuckles. Same method, far better input.
   */
  private twistFromPalm(swing: Readonly<Q4>, boneAxis: Readonly<V3>): boolean {
    if (!this.options.twist) return false;

    rotateV3(this.ref, swing, [0, 1, 0]);
    const angle = signedAngleAbout(this.ref, this.palmY, boneAxis, this.sa, this.sb, this.sc);
    if (!Number.isFinite(angle)) return false;

    setAxisAngle(this.qTwist, boneAxis, angle);
    return true;
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

/** Frame-rate independent approach factor for a given time constant. */
function approach(dt: number, tau: number): number {
  return tau <= 0 ? 1 : Math.min(1, 1 - Math.exp(-dt / tau));
}

function vectorLength(a: Readonly<V3>): number {
  return Math.hypot(a[0], a[1], a[2]);
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
