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

import { HAND, PALM_RIM } from "../tracker/handLandmarks.ts";
import { LM, SOLVER_LANDMARKS, STANDING_LANDMARKS } from "../tracker/landmarks.ts";
import {
  BONE_INDEX,
  BONE_COUNT,
  DRIVEN_BONES,
  isFingerBone,
  isLegBone,
  type AvatarPose,
  type HumanBoneName,
} from "../types.ts";
import { midpoint, readPoint } from "./coords.ts";
import { flexAxisOf, restDirOf } from "./referenceRig.ts";
import { DEFAULT_IDLE_PARAMS, writeIdleDelta, type IdleParams } from "./idlePose.ts";
import { RELAXED_POSE } from "./relaxedPose.ts";
import {
  angleOf,
  copyQ,
  cross,
  fromBasis,
  fromUnitVectors,
  identity,
  invert,
  multiply,
  dot,
  normalize,
  quat,
  rotateV3,
  scaleRotation,
  setAxisAngle,
  slerp,
  twistAbout,
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
  /** Derive forearm roll from the hand (SPEC.md 5.6). */
  twist: boolean;
  /**
   * Correct the tracker's palm/back depth ambiguity (SPEC.md 5.6.2).
   *
   * On by default, but switchable: it compensates for a specific failure of
   * one tracking model, observed on one setup, and a model that does not have
   * that failure would not need it.
   */
  correctHandDepthFlip: boolean;
  /**
   * Minimum projected palm area before a flip verdict is trusted, as a
   * fraction of the hand's projected size squared. Dimensionless, so it
   * transfers across hand sizes and camera distances (SPEC.md 12.1).
   */
  flipMinArea: number;
  /** Consecutive frames that must agree before the verdict changes. */
  flipHysteresis: number;
  /**
   * Hard limit on forearm roll, degrees.
   *
   * Generous on purpose. The rest pose is palm-down, which is already around
   * 75 degrees pronated, so the real range from there toward palm-up is about
   * 160 degrees -- a tighter limit would clip genuine motion. This exists to
   * bound a pathological solve, not to model the joint.
   */
  maxTwistDegrees: number;
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
  /**
   * Disbelieve a leg segment that points upward (SPEC.md 5.8).
   *
   * The tracker reports confident visibility for legs that have left the
   * frame and puts them somewhere arbitrary, so a hallucinated knee above the
   * hip swings the leg up through the body. No leg does that, so the
   * direction is evidence the landmarks are wrong regardless of what
   * confidence came with them.
   */
  rejectRaisedLegs: boolean;
  /**
   * Drive the 30 finger bones from the hand landmarks (SPEC.md 12, item 3).
   *
   * Off by default and experimental. Fingers make residual jitter MORE
   * visible rather than less, because they give the eye more detail to notice
   * wobble in, and their landmarks are the noisiest part of the hand. Whether
   * that trade is worth it depends on the camera and how close the subject
   * sits, so it is a choice rather than a default.
   */
  fingers: boolean;
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
  correctHandDepthFlip: true,
  flipMinArea: 0.15,
  flipHysteresis: 3,
  maxTwistDegrees: 160,
  posture: "sitting",
  useHandLandmarks: true,
  rejectRaisedLegs: true,
  fingers: false,
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

/** One hand's landmarks, in both the spaces the solver needs. */
export interface HandInput {
  /** HAND_LANDMARK_COUNT * 3, three.js space, from handToThree. */
  readonly world: Float32Array;
  /**
   * HAND_LANDMARK_COUNT * 2, normalised image space, mirrored to match.
   *
   * Carried because the projection is the only unambiguous evidence of which
   * side of the hand faces the camera; see `detectDepthFlip`.
   */
  readonly image: Float32Array;
}

export interface HandPoints {
  readonly left: HandInput | null;
  readonly right: HandInput | null;
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
/**
 * Each finger as landmark joints and the bones between them.
 *
 * The joints are one longer than the bones, because a bone is the segment
 * between two joints. MediaPipe's names and VRM's disagree in two places and
 * both are handled here rather than at every use: MediaPipe's PINKY is VRM's
 * Little, and the thumb has a metacarpal where the others have an
 * intermediate, which is a real anatomical difference rather than a naming
 * one -- the thumb has one fewer joint past the palm.
 */
const FINGER_CHAINS: readonly {
  readonly joints: readonly [number, number, number, number];
  readonly bones: readonly [string, string, string];
}[] = [
  {
    joints: [HAND.THUMB_CMC, HAND.THUMB_MCP, HAND.THUMB_IP, HAND.THUMB_TIP],
    bones: ["ThumbMetacarpal", "ThumbProximal", "ThumbDistal"],
  },
  {
    joints: [HAND.INDEX_MCP, HAND.INDEX_PIP, HAND.INDEX_DIP, HAND.INDEX_TIP],
    bones: ["IndexProximal", "IndexIntermediate", "IndexDistal"],
  },
  {
    joints: [HAND.MIDDLE_MCP, HAND.MIDDLE_PIP, HAND.MIDDLE_DIP, HAND.MIDDLE_TIP],
    bones: ["MiddleProximal", "MiddleIntermediate", "MiddleDistal"],
  },
  {
    joints: [HAND.RING_MCP, HAND.RING_PIP, HAND.RING_DIP, HAND.RING_TIP],
    bones: ["RingProximal", "RingIntermediate", "RingDistal"],
  },
  {
    joints: [HAND.PINKY_MCP, HAND.PINKY_PIP, HAND.PINKY_DIP, HAND.PINKY_TIP],
    bones: ["LittleProximal", "LittleIntermediate", "LittleDistal"],
  },
];

/**
 * How far above horizontal a leg segment may point before it is disbelieved.
 *
 * A thigh goes down, or forward when the knee is raised. It does not go UP --
 * not from a chair, not from standing, not in anything a performer does at a
 * desk. The tracker does not know that: it reports confident visibility for
 * legs that have left the frame (SPEC.md 5.8), and where it puts them is
 * arbitrary, so a hallucinated knee lands above the hip and the leg swings up
 * through the body.
 *
 * Ten degrees of slack, which covers a knee raised to just past horizontal
 * and nothing a leg cannot do. Expressed as the sine because that is what a
 * normalised direction's Y component is (SPEC.md 12.1).
 */
const MAX_LEG_RISE = Math.sin((10 * Math.PI) / 180);

const TRUSTWORTHY = 0.9;

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
  /**
   * Last trusted rotation per bone, and where a bone sits before it has ever
   * been seen.
   *
   * Fingers start from the relaxed curl rather than from the humanoid rest,
   * which is straight: a hand that has never been tracked should not hold its
   * fingers out like a mannequin. Every other bone starts at rest, which is
   * where the arm chain already puts it.
   */
  private readonly lastGood: Q4[] = Array.from({ length: BONE_COUNT }, (_, i) => {
    const q = identity(quat());
    const bone = DRIVEN_BONES[i] as HumanBoneName;
    return isFingerBone(bone) ? copyQ(q, RELAXED_POSE[i] as Q4) : q;
  });
  private readonly sinceGood = new Float32Array(BONE_COUNT).fill(Number.MAX_SAFE_INTEGER);
  private lastTimestampMs = -1;

  /**
   * Per-bone idle deltas for this frame, rebuilt once per solve rather than
   * per bone. Composed onto every bone regardless of tracking, since the
   * spine is never gated and would otherwise never breathe (SPEC.md 8).
   */
  private readonly idleDelta = new Float32Array(BONE_COUNT * 4);
  private idleElapsed = 0;

  /**
   * Depth-flip verdict per hand, with the hysteresis counter behind it.
   * `flipped` is what is currently applied; `pending` is what the evidence
   * has been saying, and only replaces it after enough consecutive frames.
   */
  private readonly flipState = {
    left: { flipped: false, pending: false, agreed: 0 },
    right: { flipped: false, pending: false, agreed: 0 },
  };

  private readonly qRoll = quat();

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
  private readonly fa = v3();
  private readonly fb = v3();
  private readonly fDir = v3();
  private readonly fLocal = v3();
  private readonly qFinger = quat();
  private readonly qFingerLocal = quat();
  private readonly qParentInv = quat();
  /**
   * Whether the hand belonging to the fingers currently being solved is still
   * being driven.
   *
   * A field rather than a seventh parameter on setBone, which knows the bone
   * but not the side. It cannot go stale: nothing writes a finger bone except
   * solveFingers, and that sets this first.
   */
  private fingersHaveHand = false;
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

    /*
     * Legs are written in BOTH postures, and only standing reads landmarks.
     *
     * Sitting used to skip them entirely, leaving resetAll's identity in
     * place -- which is a local rotation, so the legs inherited the hips and
     * swung up whenever the chest leaned. Writing them with no confidence
     * sends them through the gating path instead, where the leg fallback is
     * expressed against the floor (see setBone). The character then reads as
     * standing whatever the subject's lower body is doing, which is what
     * SPEC.md 5.8 intended all along.
     */
    const legsTracked = this.options.posture === "standing";
    this.solveLeg(points, visibility, pose, "left", dt, legsTracked);
    this.solveLeg(points, visibility, pose, "right", dt, legsTracked);

    this.solveSway(imagePoints, pose, dt);
    // Eyes are procedural (SPEC.md 8).
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

      /*
       * Hold, then decay. Without the timeout a permanently occluded limb
       * would freeze forever in whatever position it was last seen.
       *
       * A FINGER DOES NOT DECAY WHILE ITS HAND IS STILL THERE. A limb that
       * leaves frame is usually gone -- someone has lowered an arm -- so
       * relaxing it is the better guess. A finger whose hand is visible is
       * almost never gone: it is momentarily behind another finger, or lost
       * to one bad frame. Relaxing it changes the shape of a hand you can
       * see, for something the performer did not do, where holding is wrong
       * only until the next frame that sees it.
       *
       * Once the HAND has been gated out that argument stops applying, and
       * the usual one takes over: the hand is below the camera, and fingers
       * frozen in whatever they last did are no better than a frozen arm.
       *
       * The condition is the hand bone's own gate weight -- the mean over the
       * wrist and the index and pinky knuckles, which is a steadier answer to
       * "is there a hand here" than any single landmark, and already carries
       * the blend band that stops it chattering at the edge of visibility.
       * Above zero rather than fully trusted, so a partly occluded hand keeps
       * its fingers.
       */
      const holdIndefinitely = isFingerBone(bone) && this.fingersHaveHand;
      const decay = holdIndefinitely
        ? 0
        : opts.decaySeconds <= 0
          ? 1
          : Math.min(1, Math.max(0, (age - opts.holdSeconds) / opts.decaySeconds));

      /*
       * Legs fall back toward the FLOOR, not toward their parent.
       *
       * Every other bone's relaxed pose is a local rotation, so an untracked
       * one keeps whatever its parent is doing -- an arm hangs from the
       * shoulder, which is what an arm does. A leg that inherits the hips
       * swings up as the chest leans, because leaning the torso rotates the
       * hips and the legs come along. Legs do not do that: a standing person
       * leaning forward still has their legs under them.
       *
       * `qInv` is the inverse of the parent's world rotation, which is
       * already computed above to turn the solved world rotation into a local
       * one. Using it as the relaxed target sets this bone's WORLD rotation
       * to identity, which is its rest direction -- straight down for a leg.
       * So the fallback is expressed against the floor while every other
       * bone's stays against its parent.
       */
      const relaxed = isLegBone(bone) ? this.qInv : (RELAXED_POSE[idx] as Q4);
      slerp(this.qFallback, this.lastGood[idx] as Q4, relaxed, decay);
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
    hand: HandInput | null,
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

    /*
     * Forearm roll and hand orientation are solved together.
     *
     * A full hand orientation is built first, then the part of it that
     * rotates about the forearm's own axis is extracted and given to the
     * forearm; the hand keeps the remainder automatically, since its local
     * rotation is computed against the forearm that now carries the twist.
     *
     * This replaces measuring the roll as an angle between reference vectors
     * projected perpendicular to the forearm, which was singular whenever the
     * palm normal lined up with the forearm -- the projection collapsed and
     * noise chose the angle, so the hand shook at that one orientation while
     * the input was perfectly still.
     */
    let haveHand: boolean;
    if (this.usePalmFrame(hand)) {
      const input = hand as HandInput;
      if (this.options.correctHandDepthFlip) this.updateFlipVerdict(input, side);
      haveHand = this.solvePalm(input.world, side);
      if (haveHand) this.unrollPalm(side);
    } else {
      haveHand = this.solveHandFromPose(points, visibility, lm, side, handBone);
    }

    if (haveHand && this.options.twist) {
      // rel = hand orientation expressed relative to the un-rolled forearm.
      invert(this.qa, this.qb);
      multiply(this.qa, this.qa, this.qPalm);
      const conditioning = twistAbout(this.qTwist, this.qa, restDirOf(lowerBone));
      // Faded out rather than cut off near the degenerate case, so an
      // impossible hand position produces no twist instead of a noisy one,
      // and crossing into that region does not pop.
      scaleRotation(this.qTwist, this.qTwist, smoothstep(0.1, 0.35, conditioning));
      this.clampTwist(this.qTwist, restDirOf(lowerBone));
      multiply(this.qb, this.qb, this.qTwist);
    }

    this.setBone(pose, lowerBone, this.qb, this.worldOf(upperBone), lowerConfidence, dt);

    if (haveHand) {
      this.setBone(pose, handBone, this.qPalm, this.worldOf(lowerBone), handConfidence, dt);
    }

    /*
     * Fingers last, and OUTSIDE the haveHand branch.
     *
     * After the hand because every finger hangs off its world rotation. But
     * not conditional on it: resetAll puts every bone at identity each frame
     * and only a bone some stage WRITES reaches the gating path, so skipping
     * the call when the hand was not seen did not hold the fingers -- it
     * snapped them straight, which is the one thing they must not do.
     *
     * Landmarks are passed only when the palm frame is real; the pose
     * backend's three knuckle estimates cannot say anything about a finger.
     * Without them the call still runs, with no confidence, which is what
     * asks for the held value.
     *
     * palmX/Y/Z still describe this side here. unrollPalm rolls `qPalm`
     * without touching them, and that roll maps palmZ to its own negation,
     * which a projection does not care about.
     */
    if (this.options.fingers) {
      const landmarks = haveHand && hand && this.usePalmFrame(hand) ? hand.world : null;
      this.solveFingers(landmarks, pose, side, landmarks ? handConfidence : 0, dt);
    }
  }

  /**
   * The 30 finger bones, from the 21 hand landmarks (SPEC.md 12, item 3).
   *
   * Each bone is the segment between two landmarks, turned into a world
   * rotation the same way the arm bones are: the rotation that carries the
   * bone's REST direction onto its measured one. Swing only, which for a
   * finger is all there is -- a finger has no roll about its own axis, and
   * two points could not recover one anyway.
   *
   * The rest direction comes from the HAND bone rather than from
   * `restDirOf(fingerBone)`. Finger bones are not in the reference rig, so
   * that would fall back to +X, which is right for the left hand and exactly
   * backwards for the right. In the humanoid rest pose the fingers continue
   * along the hand's own axis, so the hand's direction is both correct and
   * the honest statement of why.
   */
  private solveFingers(
    hand: Float32Array | null,
    pose: AvatarPose,
    side: Side,
    confidence: number,
    dt: number,
  ): void {
    const handBone = `${side}Hand` as HumanBoneName;
    // Read before any finger is written; setBone only ever writes the weight
    // of the bone it was given, so the hand's is still this frame's.
    this.fingersHaveHand = (this.weights[BONE_INDEX[handBone]] ?? 0) > 0;

    for (const chain of FINGER_CHAINS) {
      // Reset per finger: each one hangs off the hand, not off the last
      // finger solved.
      let parentWorld = this.worldOf(handBone);

      for (let i = 0; i < chain.bones.length; i++) {
        const boneName = `${side}${chain.bones[i]}` as HumanBoneName;

        /*
         * No landmarks: hand the bone its own parent as the "solved" value
         * and no confidence. setBone ignores the rotation entirely at zero
         * weight and returns the held one, so what is passed does not matter
         * -- only that the bone is written at all, which is what keeps it off
         * the identity that resetAll left behind.
         */
        if (!hand) {
          this.setBone(pose, boneName, parentWorld, parentWorld, 0, dt);
          parentWorld = this.worldOf(boneName);
          continue;
        }

        readPoint(this.fa, hand, chain.joints[i] as number);
        readPoint(this.fb, hand, chain.joints[i + 1] as number);
        sub(this.fDir, this.fb, this.fa);

        // A collapsed segment is a landmark the tracker did not resolve, not
        // a finger of zero length. Abandoning the rest of the chain leaves
        // those bones to the gating path, which holds and decays them.
        if (vectorLength(this.fDir) < 1e-6) break;
        normalize(this.fDir, this.fDir);

        /*
         * Solved in the PARENT'S frame, not against the world axis.
         *
         * `fromUnitVectors` returns the shortest arc, which carries no twist
         * about the axis it rotates onto. The hand, by contrast, is a full
         * basis and does carry roll. Taking the shortest arc in world space
         * and then expressing it against the hand therefore left the hand's
         * roll in the finger, inverted: a hand rolled ninety degrees twisted
         * every straight finger by ninety degrees, which is what a palm
         * turned to face the camera does.
         *
         * Rotating the measured direction into the parent's frame first
         * removes the roll from the comparison entirely -- what is left is
         * the bend of this joint relative to the one before it, which is what
         * a joint angle means. Composing back with the parent hands setBone
         * the world rotation it expects.
         */
        /*
         * Each bone's OWN rest direction, not the hand's. The four fingers
         * do lie along the hand's axis, but the thumb rests about 40 degrees
         * off it, and borrowing the hand's direction applied that difference
         * as a permanent rotation -- to a metacarpal that lives inside the
         * palm, which dragged the palm out of shape with it.
         */
        invert(this.qParentInv, parentWorld);
        rotateV3(this.fLocal, this.qParentInv, this.fDir);

        /*
         * Past the knuckle, a finger is a HINGE.
         *
         * The first joint of each chain has two degrees of freedom: it flexes
         * and it spreads. The two beyond it have one, because there is no
         * joint in a finger that splays it at the middle or the tip. Letting
         * the solver put rotation on that axis therefore reproduces nothing
         * anyone can do, and spends the whole axis on tracking noise -- on
         * twenty of the thirty bones.
         *
         * Flattening the measured direction onto the joint's bending plane
         * is all it takes: what is left can only bend. A direction lying
         * along the plane's normal has no bend in it to recover and is left
         * alone, which cannot happen to a real finger but can to a bad frame.
         */
        if (i > 0) {
          const flex = flexAxisOf(boneName);
          if (flex) {
            const sideways = dot(this.fLocal, flex);
            this.fLocal[0] -= flex[0] * sideways;
            this.fLocal[1] -= flex[1] * sideways;
            this.fLocal[2] -= flex[2] * sideways;
            if (vectorLength(this.fLocal) > 1e-4) normalize(this.fLocal, this.fLocal);
            else rotateV3(this.fLocal, this.qParentInv, this.fDir);
          }
        }

        fromUnitVectors(this.qFingerLocal, restDirOf(boneName), this.fLocal);
        multiply(this.qFinger, parentWorld, this.qFingerLocal);
        this.setBone(pose, boneName, this.qFinger, parentWorld, confidence, dt);
        parentWorld = this.worldOf(boneName);
      }
    }
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
    tracked: boolean,
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
    /*
     * Untracked legs are written with no confidence rather than skipped. At
     * zero weight setBone ignores the rotation entirely and returns the
     * fallback, so what is passed does not matter -- only that the bone is
     * written, which is what keeps it off the identity resetAll left behind.
     *
     * A segment pointing upward is disbelieved outright, whatever the tracker
     * says its visibility is. That combination -- confident about a landmark
     * it has invented -- is the documented failure for out-of-frame legs, and
     * believing it even partly is what swings a leg up through the body.
     */
    const confidence = (landmarks: readonly number[], direction: Readonly<V3>): number => {
      if (!tracked) return 0;
      if (this.options.rejectRaisedLegs && (direction[1] ?? 0) > MAX_LEG_RISE) return 0;
      return meanVisibility(visibility, landmarks);
    };

    this.setBone(pose, upperBone, this.qa, hips, confidence([lm.hip, lm.knee], this.axisX), dt);

    readPoint(this.pc, points, lm.ankle);
    normalize(this.axisY, sub(this.axisY, this.pc, this.pb));
    fromUnitVectors(this.qb, restDirOf(lowerBone), this.axisY);
    this.setBone(
      pose,
      lowerBone,
      this.qb,
      this.worldOf(upperBone),
      confidence([lm.knee, lm.ankle], this.axisY),
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
      // The foot is the one segment that legitimately points forward and
      // slightly up, so it is judged on the shin above it instead.
      confidence([lm.ankle, lm.heel, lm.foot], this.axisY),
      dt,
    );
  }

  /**
   * Decides whether the tracker has the hand rolled 180 degrees about its own
   * axis, and records the verdict.
   *
   * WHY THIS HAPPENS. Monocular hand tracking cannot always tell the palm
   * from the back of the hand: both project to a similar outline, and the
   * model resolves it by inference rather than measurement. When it decides
   * wrong -- reliably so for a hand hanging downward, where the hand is
   * angled away and self-occluding -- it reports the nearest hand pose
   * consistent with the wrong answer, which is the real hand rolled 180
   * degrees about its forward axis. The avatar then renders a hand rotated
   * 180 degrees, and nothing downstream can recover it, because the error is
   * in the data before the solver sees it.
   *
   * WHY IT IS DETECTABLE. The in-image ARRANGEMENT of the landmarks follows
   * from the picture the camera produced, and a projection cannot be wrong
   * about the order of points it contains. The model's reconstruction is an
   * inference, and that is what fails. A 180 degree roll reverses the palm's
   * winding, so comparing the two readings exposes it.
   *
   * Note that a pure DEPTH inversion would be invisible here, and
   * deliberately so: depth does not enter either winding, and two hands that
   * differ only in depth are projectively identical. That ambiguity is real
   * and unresolvable from one image. This detects the case that is not
   * ambiguous -- where the reconstruction disagrees with the picture.
   *
   * Two guards, because the detector degrades where the solver does:
   *
   * - AREA. Edge-on, the palm triangle projects to nearly nothing and its
   *   winding becomes noise. Below `flipMinArea` the verdict is not trusted
   *   and the previous one is held, which beats guessing and badly beats
   *   oscillating.
   * - HYSTERESIS. A borderline hand would otherwise alternate frame to
   *   frame, which reads worse than a steady wrong answer. The verdict only
   *   changes after `flipHysteresis` consecutive frames of agreement.
   */
  private updateFlipVerdict(hand: HandInput, side: Side): void {
    const state = this.flipState[side];
    const wrist = PALM_RIM[0] as number;
    const index = HAND.INDEX_MCP;
    const pinky = HAND.PINKY_MCP;

    // Winding of the palm triangle as the camera sees it. Image y runs down
    // where three.js y runs up, so consistent readings have OPPOSITE signs.
    const ax = (hand.image[index * 2] ?? 0) - (hand.image[wrist * 2] ?? 0);
    const ay = (hand.image[index * 2 + 1] ?? 0) - (hand.image[wrist * 2 + 1] ?? 0);
    const bx = (hand.image[pinky * 2] ?? 0) - (hand.image[wrist * 2] ?? 0);
    const by = (hand.image[pinky * 2 + 1] ?? 0) - (hand.image[wrist * 2 + 1] ?? 0);
    const seen = ax * by - ay * bx;

    // Normalised by the hand's own projected size, so the threshold carries
    // no units and holds for any hand at any distance (SPEC.md 12.1).
    const span = Math.max(Math.hypot(ax, ay), 1e-6);
    if (Math.abs(seen) / (span * span) < this.options.flipMinArea) {
      state.agreed = 0;
      return;
    }

    // The same triangle as the model reconstructed it.
    const cx = (hand.world[index * 3] ?? 0) - (hand.world[wrist * 3] ?? 0);
    const cy = (hand.world[index * 3 + 1] ?? 0) - (hand.world[wrist * 3 + 1] ?? 0);
    const dx = (hand.world[pinky * 3] ?? 0) - (hand.world[wrist * 3] ?? 0);
    const dy = (hand.world[pinky * 3 + 1] ?? 0) - (hand.world[wrist * 3 + 1] ?? 0);
    const believed = cx * dy - cy * dx;

    const rolled = Math.sign(seen) === Math.sign(believed);
    if (rolled === state.pending) {
      state.agreed++;
    } else {
      state.pending = rolled;
      state.agreed = 1;
    }
    if (state.agreed >= this.options.flipHysteresis) state.flipped = rolled;
  }

  /**
   * Undoes the 180 degree roll by rolling back.
   *
   * Applied to the solved orientation rather than to the landmarks, because
   * the error is a rotation about an axis that is not aligned to anything in
   * particular, and once the palm frame exists that axis is simply its own
   * local X. Post-multiplying keeps it in the hand's frame, so it rolls the
   * hand about itself rather than about the world.
   */
  private unrollPalm(side: Side): void {
    if (!this.options.correctHandDepthFlip) return;
    if (!this.flipState[side].flipped) return;
    setAxisAngle(this.qRoll, [1, 0, 0], Math.PI);
    multiply(this.qPalm, this.qPalm, this.qRoll);
  }

  /** True while a hand's orientation is being corrected; shown in the panel. */
  isDepthFlipped(side: Side): boolean {
    return this.flipState[side].flipped;
  }

  private usePalmFrame(hand: HandInput | null): boolean {
    return this.options.useHandLandmarks && hand !== null;
  }

  /**
   * Full hand orientation from the palm.
   *
   * Three points: wrist to middle knuckle for the long axis, index knuckle to
   * pinky knuckle across the palm. Deliberately the simple version.
   *
   * A five-point area-weighted fit over the whole palm rim was tried and
   * measured 1.14x less jitter, but it was reverted along with the
   * conditioning-aware smoothing when the hands regressed. Neither was shown
   * to be the cause -- the fit is sign-stable under noise and the rest-pose
   * conventions match the VRM -- but a simpler solver is easier to diagnose,
   * and 1.14x did not justify the extra surface while something is wrong.
   * See SPEC.md 12.
   *
   * Writes `qPalm` and returns false if the landmarks are degenerate.
   */
  private solvePalm(hand: Float32Array, side: Side): boolean {
    readPoint(this.pa, hand, PALM_RIM[0] as number);
    readPoint(this.pb, hand, HAND.MIDDLE_MCP);
    readPoint(this.sa, hand, HAND.INDEX_MCP);
    readPoint(this.sb, hand, HAND.PINKY_MCP);

    sub(this.palmX, this.pb, this.pa);
    if (vectorLength(this.palmX) < 1e-5) return false;
    normalize(this.palmX, this.palmX);

    sub(this.palmZ, this.sb, this.sa);
    cross(this.palmY, this.palmX, this.palmZ);
    if (vectorLength(this.palmY) < 1e-6) return false;
    normalize(this.palmY, this.palmY);

    // The hands are mirror images, so one side's frame comes out left-handed
    // without this flip.
    const sign = HAND_SIGN[side];
    this.palmX[0] *= sign;
    this.palmX[1] *= sign;
    this.palmX[2] *= sign;
    this.palmY[0] *= sign;
    this.palmY[1] *= sign;
    this.palmY[2] *= sign;

    normalize(this.palmZ, cross(this.palmZ, this.palmX, this.palmY));
    normalize(this.palmY, cross(this.palmY, this.palmZ, this.palmX));

    fromBasis(this.qPalm, this.palmX, this.palmY, this.palmZ);
    return true;
  }

  /**
   * Hand orientation from the pose model's three knuckle estimates.
   *
   * The fallback for backends without real hand landmarks. Same output shape
   * as solvePalm, so the forearm roll is extracted identically; the input is
   * simply much weaker (SPEC.md 5.6).
   */
  private solveHandFromPose(
    points: Float32Array,
    visibility: Float32Array,
    lm: ArmLandmarks,
    side: Side,
    handBone: HumanBoneName,
  ): boolean {
    if (meanVisibility(visibility, [lm.index, lm.pinky]) < this.options.visibilityThreshold) {
      return false;
    }

    readPoint(this.ta, points, lm.wrist);
    readPoint(this.tb, points, lm.index);
    readPoint(this.tc, points, lm.pinky);

    midpoint(this.handMid, points, lm.index, lm.pinky);
    sub(this.palmX, this.handMid, this.ta);
    if (vectorLength(this.palmX) < 1e-5) return false;
    normalize(this.palmX, this.palmX);

    sub(this.sa, this.tb, this.ta);
    sub(this.sb, this.tc, this.ta);
    cross(this.palmY, this.sa, this.sb);
    if (vectorLength(this.palmY) < 1e-6) return false;
    normalize(this.palmY, this.palmY);

    const sign = TWIST_SIGN[side];
    this.palmY[0] *= sign;
    this.palmY[1] *= sign;
    this.palmY[2] *= sign;

    const restSign = restDirOf(handBone)[0] < 0 ? -1 : 1;
    this.palmX[0] *= restSign;
    this.palmX[1] *= restSign;
    this.palmX[2] *= restSign;

    normalize(this.palmZ, cross(this.palmZ, this.palmX, this.palmY));
    normalize(this.palmY, cross(this.palmY, this.palmZ, this.palmX));
    fromBasis(this.qPalm, this.palmX, this.palmY, this.palmZ);
    return true;
  }

  /** Keeps forearm roll inside an anatomically possible range. */
  private clampTwist(twist: Q4, axis: Readonly<V3>): void {
    const limit = (this.options.maxTwistDegrees * Math.PI) / 180;
    const angle = angleOf(twist);
    if (angle <= limit) return;

    // angleOf is unsigned, so recover the sign from the axial component.
    const sign =
      twist[0] * axis[0] + twist[1] * axis[1] + twist[2] * axis[2] >= 0 ? 1 : -1;
    setAxisAngle(twist, axis, sign * limit);
  }
}

/** Frame-rate independent approach factor for a given time constant. */
function approach(dt: number, tau: number): number {
  return tau <= 0 ? 1 : Math.min(1, 1 - Math.exp(-dt / tau));
}

function vectorLength(a: Readonly<V3>): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function meanVisibility(visibility: Float32Array, indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += visibility[i] ?? 0;
  return sum / indices.length;
}
