/*
 * Solver checks against synthetic landmark sets, run with `npm run check:solver`.
 *
 * The reference rig doubles as ground truth: landmarks placed at the rig's own
 * rest positions must solve to identity on every bone. Anything else means a
 * basis, a sign or a parent chain is wrong. Rotating that same input by a known
 * amount must produce that same known rotation back.
 *
 * This is the point of splitting milestone 3b out (SPEC.md section 12) -- the
 * solver is verifiable with no Blender asset in existence.
 *
 * Never imported by the app, so it is not part of the bundle.
 */

import { LM } from "../tracker/landmarks.ts";
import { HIP_HEIGHT_M, mirrorScalars, mpToThree } from "./coords.ts";
import { BONE_INDEX, LANDMARK_COUNT, createAvatarPose, type HumanBoneName } from "../types.ts";
import { PoseSolver, type HandInput } from "./poseSolver.ts";
import { HAND } from "../tracker/handLandmarks.ts";
import {
  DEFAULT_HAND_XY_PARAMS,
  DEFAULT_HAND_Z_PARAMS,
  LandmarkFilter,
} from "../filter/oneEuro.ts";
import { HAND_LANDMARK_COUNT } from "../types.ts";
import {
  invert as invQ4,
  multiply as mulQ4,
  rotateV3,
  setAxisAngle,
  quat,
  v3,
  type Q4,
  type V3,
} from "./math.ts";

const invQ = (q: Q4): Q4 => invQ4(quat(), q);
const mulQ = (a: Q4, b: Q4): Q4 => mulQ4(quat(), a, b);

let failures = 0;
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

/** Landmarks positioned to match the reference rig's rest pose exactly. */
function restPoseLandmarks(): Float32Array {
  const p = new Float32Array(LANDMARK_COUNT * 3);
  const set = (i: number, x: number, y: number, z: number): void => {
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
  };

  set(LM.LEFT_HIP, 0.09, 0.95, 0);
  set(LM.RIGHT_HIP, -0.09, 0.95, 0);
  set(LM.LEFT_SHOULDER, 0.12, 1.4, 0);
  set(LM.RIGHT_SHOULDER, -0.12, 1.4, 0);
  set(LM.LEFT_ELBOW, 0.4, 1.4, 0);
  set(LM.RIGHT_ELBOW, -0.4, 1.4, 0);
  set(LM.LEFT_WRIST, 0.65, 1.4, 0);
  set(LM.RIGHT_WRIST, -0.65, 1.4, 0);
  // Palm down: index and pinky straddle the hand axis in z, so the plane
  // normal points +Y for both hands after TWIST_SIGN is applied.
  set(LM.LEFT_INDEX, 0.78, 1.4, 0.03);
  set(LM.LEFT_PINKY, 0.78, 1.4, -0.03);
  set(LM.RIGHT_INDEX, -0.78, 1.4, 0.03);
  set(LM.RIGHT_PINKY, -0.78, 1.4, -0.03);
  set(LM.NOSE, 0, 1.55, 0.08);
  set(LM.LEFT_EAR, 0.06, 1.55, -0.02);
  set(LM.RIGHT_EAR, -0.06, 1.55, -0.02);
  return p;
}

function rotateAll(points: Float32Array, q: Readonly<Q4>, pivotY: number): Float32Array {
  const out = new Float32Array(points.length);
  const tmp: V3 = [0, 0, 0];
  const res: V3 = [0, 0, 0];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const o = i * 3;
    tmp[0] = points[o] ?? 0;
    tmp[1] = (points[o + 1] ?? 0) - pivotY;
    tmp[2] = points[o + 2] ?? 0;
    rotateV3(res, q, tmp);
    out[o] = res[0];
    out[o + 1] = res[1] + pivotY;
    out[o + 2] = res[2];
  }
  return out;
}

function boneQuat(rotations: Float32Array, bone: HumanBoneName): Q4 {
  const o = BONE_INDEX[bone] * 4;
  return [rotations[o] ?? 0, rotations[o + 1] ?? 0, rotations[o + 2] ?? 0, rotations[o + 3] ?? 1];
}

function isIdentity(q: Readonly<Q4>, eps = 1e-4): boolean {
  return near(Math.abs(q[3]), 1, eps);
}

const visible = new Float32Array(LANDMARK_COUNT).fill(1);
const pose = createAvatarPose();

/**
 * Idle motion is additive and always on in the app, so it perturbs every
 * rotation by a fraction of a degree. Checks asserting exact tracking math
 * use this; the idle section below opts back in deliberately.
 */
function makeSolver(): PoseSolver {
  const s = new PoseSolver();
  s.idle.amount = 0;
  return s;
}

const solver = makeSolver();

// --- 1. Rest pose must solve to identity on every driven bone ---------------
const rest = restPoseLandmarks();
solver.solve(rest, visible, pose);

const drivenBones: HumanBoneName[] = [
  "spine", "chest", "upperChest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand",
];
for (const bone of drivenBones) {
  const q = boneQuat(pose.rotations, bone);
  check(`rest pose: ${bone} is identity`, isIdentity(q), JSON.stringify(q.map((n) => +n.toFixed(4))));
}
check("rest pose: confidence is 1", near(pose.confidence, 1));

// --- 2. Whole-body yaw must land on the torso, not the arms -----------------
const yaw = quat();
setAxisAngle(yaw, [0, 1, 0], Math.PI / 6);
solver.solve(rotateAll(rest, yaw, 0.95), visible, pose);

// The arms must stay at local identity, which only holds if the spine chain
// absorbed the whole rotation and the parent chain is wired correctly.
for (const bone of ["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm"] as HumanBoneName[]) {
  const q = boneQuat(pose.rotations, bone);
  check(`yawed body: ${bone} stays local-identity`, isIdentity(q, 1e-3), JSON.stringify(q.map((n) => +n.toFixed(4))));
}
check("yawed body: spine took a share", !isIdentity(boneQuat(pose.rotations, "spine")));

// --- 3. A bent elbow must produce the expected forearm rotation -------------
const bent = restPoseLandmarks();
// Forearm swung from +X to +Z, keeping its length; hand follows.
bent[LM.LEFT_WRIST * 3] = 0.4; bent[LM.LEFT_WRIST * 3 + 2] = 0.25;
bent[LM.LEFT_INDEX * 3] = 0.4; bent[LM.LEFT_INDEX * 3 + 2] = 0.38;
bent[LM.LEFT_PINKY * 3] = 0.4; bent[LM.LEFT_PINKY * 3 + 2] = 0.38;
bent[LM.LEFT_INDEX * 3 + 1] = 1.4 + 0.03;
bent[LM.LEFT_PINKY * 3 + 1] = 1.4 - 0.03;
solver.solve(bent, visible, pose);

const forearm = v3();
rotateV3(forearm, boneQuat(pose.rotations, "leftLowerArm"), [1, 0, 0]);
check("bent elbow: left forearm rest axis maps to +Z",
  near(forearm[0], 0, 1e-3) && near(forearm[1], 0, 1e-3) && near(forearm[2], 1, 1e-3),
  JSON.stringify(forearm.map((n) => +n.toFixed(4))));
check("bent elbow: left upper arm unaffected", isIdentity(boneQuat(pose.rotations, "leftUpperArm"), 1e-3));
check("bent elbow: right arm unaffected", isIdentity(boneQuat(pose.rotations, "rightLowerArm"), 1e-3));

// --- 4. The head must respond to head-only motion ---------------------------
//
// Rest-pose identity alone does not prove the head tracks; it only proves it
// does not drift. These rotate nose and both ears and nothing else.
function headTurned(axis: V3, degrees: number): Float32Array {
  const p = restPoseLandmarks();
  const rot = quat();
  setAxisAngle(rot, axis, (degrees * Math.PI) / 180);
  const out = v3();
  for (const i of [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) {
    // Pivot at the head, not the origin, so the torso basis is untouched.
    rotateV3(out, rot, [p[i * 3] ?? 0, (p[i * 3 + 1] ?? 0) - 1.55, p[i * 3 + 2] ?? 0]);
    p[i * 3] = out[0];
    p[i * 3 + 1] = out[1] + 1.55;
    p[i * 3 + 2] = out[2];
  }
  return p;
}

const angleOf = (q: Readonly<Q4>): number =>
  (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;

for (const [axisName, axis] of [["yaw", [0, 1, 0]], ["pitch", [1, 0, 0]]] as [string, V3][]) {
  solver.solve(headTurned(axis, 30), visible, pose);
  const neck = angleOf(boneQuat(pose.rotations, "neck"));
  const head = angleOf(boneQuat(pose.rotations, "head"));

  check(`head ${axisName}: head bone rotates`, head > 1, `${head.toFixed(2)}deg`);
  check(`head ${axisName}: neck takes a share`, neck > 1, `${neck.toFixed(2)}deg`);
  // The chain must account for the full input, or the head lags the subject by
  // a fixed fraction that no amount of tuning elsewhere can recover.
  check(`head ${axisName}: neck + head = input`, Math.abs(neck + head - 30) < 0.5,
    `${neck.toFixed(2)} + ${head.toFixed(2)} = ${(neck + head).toFixed(2)}`);
  // Default neckShare is 0.4, so the split should follow it.
  check(`head ${axisName}: split follows neckShare`, Math.abs(neck / 30 - 0.4) < 0.02,
    `neck share = ${(neck / 30).toFixed(3)}`);
}

// Torso motion must not leak into the head's local rotation.
solver.solve(rotateAll(rest, yaw, 0.95), visible, pose);
check("yawed body: head stays local-identity", isIdentity(boneQuat(pose.rotations, "head"), 1e-3),
  JSON.stringify(boneQuat(pose.rotations, "head").map((n) => +n.toFixed(4))));

// --- 5. Mirroring must be a rotation, not a reflection ----------------------
//
// Negating x alone is a reflection, which flips handedness; the solver's
// re-orthogonalisation then produces a different rotation entirely, yawing the
// torso and turning the head upside down even on a symmetric pose. These cover
// the real conversion path, which is where that fix lives.

/** Inverse of mpToThree, so a three.js-space pose can be fed in as MediaPipe input. */
function toMediaPipeSpace(points: Float32Array): Float32Array {
  const out = new Float32Array(points.length);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const o = i * 3;
    out[o] = points[o] ?? 0;
    out[o + 1] = -((points[o + 1] ?? 0) - HIP_HEIGHT_M);
    out[o + 2] = -(points[o + 2] ?? 0);
  }
  return out;
}

function solveVia(world: Float32Array, mirror: boolean): void {
  const converted = new Float32Array(LANDMARK_COUNT * 3);
  const vis = new Float32Array(LANDMARK_COUNT);
  mpToThree(converted, world, { mirror });
  mirrorScalars(vis, visible, mirror);
  solver.solve(converted, vis, pose);
}

// A symmetric rest pose must solve to identity whether mirrored or not.
// This is the direct regression test for the upside-down head.
const restWorld = toMediaPipeSpace(rest);
for (const mirror of [false, true]) {
  solveVia(restWorld, mirror);
  for (const bone of ["spine", "chest", "upperChest", "neck", "head"] as HumanBoneName[]) {
    const q = boneQuat(pose.rotations, bone);
    check(`mirror=${mirror}: symmetric rest leaves ${bone} at identity`, isIdentity(q, 1e-3),
      JSON.stringify(q.map((n) => +n.toFixed(4))));
  }
  // Head up must stay up. This is what the screenshot actually showed.
  const up = v3();
  rotateV3(up, boneQuat(pose.rotations, "head"), [0, 1, 0]);
  check(`mirror=${mirror}: head up vector still points up`, (up[1] ?? 0) > 0.99,
    `up=[${up.map((n) => n.toFixed(2)).join(",")}]`);
}

// An asymmetric pose must land on the opposite side when mirrored, with the
// same magnitude -- that is what distinguishes a real mirror from a mangled basis.
const bentWorld = toMediaPipeSpace(bent);

solveVia(bentWorld, false);
const unmirroredLeft = angleOf(boneQuat(pose.rotations, "leftLowerArm"));
const unmirroredRight = angleOf(boneQuat(pose.rotations, "rightLowerArm"));

solveVia(bentWorld, true);
const mirroredLeft = angleOf(boneQuat(pose.rotations, "leftLowerArm"));
const mirroredRight = angleOf(boneQuat(pose.rotations, "rightLowerArm"));

check("unmirrored: the bend is on the left", unmirroredLeft > 10 && unmirroredRight < 1,
  `L=${unmirroredLeft.toFixed(1)} R=${unmirroredRight.toFixed(1)}`);
check("mirrored: the bend moves to the right", mirroredRight > 10 && mirroredLeft < 1,
  `L=${mirroredLeft.toFixed(1)} R=${mirroredRight.toFixed(1)}`);
check("mirrored: the bend keeps its magnitude", Math.abs(mirroredRight - unmirroredLeft) < 0.5,
  `${unmirroredLeft.toFixed(2)} vs ${mirroredRight.toFixed(2)}`);

/**
 * A palm-down hand in T-pose: fingers along the arm, thumb side toward +Z.
 *
 * All five rigid palm landmarks are set, including the ring knuckle. Earlier
 * fixtures set only four and left the fifth at the origin, which went
 * unnoticed while the solver read three of them.
 */
function makeHand(side: "left" | "right", wristX: number, wristY: number): Float32Array {
  const h = new Float32Array(HAND_LANDMARK_COUNT * 3);
  const s = side === "left" ? 1 : -1;
  const set = (i: number, x: number, y: number, z: number): void => {
    h[i * 3] = x; h[i * 3 + 1] = y; h[i * 3 + 2] = z;
  };
  set(HAND.WRIST, wristX, wristY, 0);
  /*
   * Knuckles span the palm: index on the thumb side, pinky opposite, for both
   * hands, with the stagger in reach a real hand has.
   *
   * The middle knuckle sits ON the hand's forward axis, because that axis is
   * how the solver defines forward and the VRM defines it the same way -- its
   * own middle-proximal bone points along the hand. Placing it off-axis here
   * would make "rest solves to identity" false by construction rather than
   * because anything is wrong.
   *
   * Worth knowing: wrist-to-middle-knuckle and wrist-to-knuckle-centroid
   * differ by about 6 degrees on the reference model, since the centroid is
   * pulled toward the pinky. They are not interchangeable definitions.
   */
  set(HAND.INDEX_MCP, wristX + 0.080 * s, wristY, 0.025);
  set(HAND.MIDDLE_MCP, wristX + 0.085 * s, wristY, 0);
  set(HAND.RING_MCP, wristX + 0.080 * s, wristY, -0.012);
  set(HAND.PINKY_MCP, wristX + 0.072 * s, wristY, -0.025);
  return h;
}

/**
 * Adds the fifteen finger joints that `makeHand` leaves at the origin.
 *
 * `curlDeg` bends every joint of every finger by that much, cumulatively down
 * each chain, the way a closing hand does. Zero gives a flat hand with the
 * fingers continuing along the hand's own axis -- which is the humanoid rest
 * pose, and must therefore solve to identity.
 *
 * Flexion carries the fingertips toward the palm. The palm is the XZ plane
 * here and faces -Y, so a curl rotates the finger axis from +X toward -Y,
 * which is negative about Z on the left and positive on the right.
 */
function addFingers(h: Float32Array, side: "left" | "right", curlDeg = 0): Float32Array {
  const s = side === "left" ? 1 : -1;
  const sign = side === "left" ? -1 : 1;
  const get = (i: number): [number, number, number] =>
    [h[i * 3] ?? 0, h[i * 3 + 1] ?? 0, h[i * 3 + 2] ?? 0];
  const set = (i: number, p: readonly [number, number, number]): void => {
    h[i * 3] = p[0]; h[i * 3 + 1] = p[1]; h[i * 3 + 2] = p[2];
  };

  /** Lays a chain of segments out from `from`, bending by curlDeg each time. */
  const chain = (from: number, joints: readonly number[], lengths: readonly number[]): void => {
    let [x, y, z] = get(from);
    const q = quat();
    const dir = v3();
    for (let i = 0; i < joints.length; i++) {
      // Cumulative: a closing finger bends further at every joint along it.
      setAxisAngle(q, [0, 0, 1], sign * (i + 1) * curlDeg * (Math.PI / 180));
      rotateV3(dir, q, [s, 0, 0]);
      x += dir[0] * (lengths[i] as number);
      y += dir[1] * (lengths[i] as number);
      z += dir[2] * (lengths[i] as number);
      set(joints[i] as number, [x, y, z]);
    }
  };

  chain(HAND.INDEX_MCP, [HAND.INDEX_PIP, HAND.INDEX_DIP, HAND.INDEX_TIP], [0.039, 0.023, 0.018]);
  chain(HAND.MIDDLE_MCP, [HAND.MIDDLE_PIP, HAND.MIDDLE_DIP, HAND.MIDDLE_TIP], [0.043, 0.026, 0.019]);
  chain(HAND.RING_MCP, [HAND.RING_PIP, HAND.RING_DIP, HAND.RING_TIP], [0.040, 0.025, 0.018]);
  chain(HAND.PINKY_MCP, [HAND.PINKY_PIP, HAND.PINKY_DIP, HAND.PINKY_TIP], [0.031, 0.019, 0.017]);

  // The thumb starts from the wrist, not from a knuckle, and keeps its own
  // segment count: a metacarpal where the others have an intermediate.
  set(HAND.THUMB_CMC, [(h[0] ?? 0) + 0.021 * s, h[1] ?? 0, 0.021]);
  chain(HAND.THUMB_CMC, [HAND.THUMB_MCP, HAND.THUMB_IP, HAND.THUMB_TIP], [0.036, 0.031, 0.025]);
  return h;
}

/** A hand with all 21 landmarks: palm from makeHand, fingers from addFingers. */
function makeFullHand(
  side: "left" | "right",
  wristX: number,
  wristY: number,
  curlDeg = 0,
): Float32Array {
  return addFingers(makeHand(side, wristX, wristY), side, curlDeg);
}

/**
 * Wraps a hand's world landmarks with a projection consistent with them, so
 * the depth-flip detector sees agreeing evidence and stays inactive.
 *
 * Image y runs down where three.js y runs up, hence the negation.
 */
function project(world: Float32Array): HandInput {
  const image = new Float32Array(HAND_LANDMARK_COUNT * 2);
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    image[i * 2] = 0.5 + (world[i * 3] ?? 0) * 0.5;
    image[i * 2 + 1] = 0.5 - ((world[i * 3 + 1] ?? 0) - 1.4) * 0.5;
  }
  return { world, image };
}

function handInput(side: "left" | "right", wristX: number, wristY: number): HandInput {
  return project(makeHand(side, wristX, wristY));
}

/** Rotates a hand about its wrist. */
function rotateHand(h: Float32Array, q: Readonly<Q4>, px: number, py: number): Float32Array {
  const out = new Float32Array(h.length);
  const t = v3();
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    rotateV3(t, q, [(h[i * 3] ?? 0) - px, (h[i * 3 + 1] ?? 0) - py, h[i * 3 + 2] ?? 0]);
    out[i * 3] = t[0] + px;
    out[i * 3 + 1] = t[1] + py;
    out[i * 3 + 2] = t[2];
  }
  return out;
}

// --- 5b. Palm frame: hand orientation from 21 landmarks --------------------
//
// Only differences matter, so these are written in body-relative coordinates
// even though Holistic centres hand world landmarks on the hand itself.

{
  const hands = { left: handInput("left", 0.65, 1.4), right: handInput("right", -0.65, 1.4) };
  const s = makeSolver();
  s.solve(rest, visible, pose, 0, hands);

  for (const bone of ["leftHand", "rightHand"] as HumanBoneName[]) {
    check(`palm frame: ${bone} is identity at rest`,
      isIdentity(boneQuat(pose.rotations, bone), 1e-3),
      JSON.stringify(boneQuat(pose.rotations, bone).map((n) => +n.toFixed(4))));
  }
  // The per-side sign is the same mirror trap as the body basis, so the
  // forearm must not pick up a spurious roll either.
  for (const bone of ["leftLowerArm", "rightLowerArm"] as HumanBoneName[]) {
    check(`palm frame: ${bone} takes no spurious twist at rest`,
      isIdentity(boneQuat(pose.rotations, bone), 1e-3),
      JSON.stringify(boneQuat(pose.rotations, bone).map((n) => +n.toFixed(4))));
  }
}

// Rolling the palm must roll the forearm, which is the whole point.
{
  const roll = quat();
  setAxisAngle(roll, [1, 0, 0], (40 * Math.PI) / 180);
  // Rotated about the arm axis, pivoting at the wrist.
  const h = rotateHand(makeHand("left", 0.65, 1.4), roll, 0.65, 1.4);

  const s = makeSolver();
  s.solve(rest, visible, pose, 0, { left: project(h), right: null });
  const twist = angleOf(boneQuat(pose.rotations, "leftLowerArm"));
  check("palm frame: a 40deg palm roll rolls the forearm",
    Math.abs(twist - 40) < 3, `${twist.toFixed(1)}deg`);
}

// Missing hands must fall back to the pose-model derivation, not break.
{
  const s = makeSolver();
  s.solve(rest, visible, pose, 0, { left: null, right: null });
  check("palm frame: absent hands fall back cleanly",
    isIdentity(boneQuat(pose.rotations, "leftHand"), 1e-3),
    JSON.stringify(boneQuat(pose.rotations, "leftHand").map((n) => +n.toFixed(4))));

  const off = makeSolver();
  off.options.useHandLandmarks = false;
  off.solve(rest, visible, pose, 0, { left: handInput("left", 0.65, 1.4), right: handInput("right", -0.65, 1.4) });
  check("palm frame: can be disabled for comparison",
    isIdentity(boneQuat(pose.rotations, "leftHand"), 1e-3));
}

// --- 5c. Posture modes (SPEC.md 5.8) ---------------------------------------

/** Landmarks for a standing subject with a bent left knee. */
function standingLandmarks(): Float32Array {
  const p = restPoseLandmarks();
  const set = (i: number, x: number, y: number, z: number): void => {
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
  };
  set(LM.LEFT_KNEE, 0.09, 0.52, 0.0);
  set(LM.RIGHT_KNEE, -0.09, 0.52, 0);
  // Left shin swung forward, so the bend is unambiguous and one-sided.
  set(LM.LEFT_ANKLE, 0.09, 0.2, 0.25);
  set(LM.RIGHT_ANKLE, -0.09, 0.1, 0);
  set(LM.LEFT_FOOT_INDEX, 0.09, 0.13, 0.39);
  set(LM.RIGHT_FOOT_INDEX, -0.09, 0.03, 0.16);
  set(LM.LEFT_HEEL, 0.09, 0.2, 0.25);
  set(LM.RIGHT_HEEL, -0.09, 0.1, 0);
  return p;
}

{
  const standing = standingLandmarks();

  // Sitting must ignore the legs entirely, however confident the landmarks.
  const sit = makeSolver();
  sit.options.posture = "sitting";
  sit.solve(standing, visible, pose, 0);
  for (const bone of ["leftUpperLeg", "leftLowerLeg", "leftFoot"] as HumanBoneName[]) {
    check(`posture sitting: ${bone} stays at rest`,
      isIdentity(boneQuat(pose.rotations, bone), 1e-3),
      JSON.stringify(boneQuat(pose.rotations, bone).map((n) => +n.toFixed(4))));
  }

  // Standing must drive them.
  const stand = makeSolver();
  stand.options.posture = "standing";
  stand.solve(standing, visible, pose, 0);
  const shin = angleOf(boneQuat(pose.rotations, "leftLowerLeg"));
  check("posture standing: a bent knee rotates the shin", shin > 10, `${shin.toFixed(1)}deg`);
  check("posture standing: the straight leg stays at rest",
    isIdentity(boneQuat(pose.rotations, "rightLowerLeg"), 1e-2),
    JSON.stringify(boneQuat(pose.rotations, "rightLowerLeg").map((n) => +n.toFixed(4))));

  // Posture must not leak upward: the same upper body either way.
  sit.solve(standing, visible, pose, 33.3);
  const sitHead = boneQuat(pose.rotations, "head");
  const sitArm = boneQuat(pose.rotations, "leftUpperArm");
  stand.solve(standing, visible, pose, 33.3);
  const standHead = boneQuat(pose.rotations, "head");
  const standArm = boneQuat(pose.rotations, "leftUpperArm");
  const same = (a: Q4, b: Q4): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-6);
  check("posture: upper body is identical in both modes",
    same(sitHead, standHead) && same(sitArm, standArm));

  // Legs count toward confidence only when something drives them.
  const partial = new Float32Array(LANDMARK_COUNT).fill(1);
  for (const i of [LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) partial[i] = 0;
  sit.solve(standing, partial, pose, 66.6);
  const sitConfidence = pose.confidence;
  stand.solve(standing, partial, pose, 66.6);
  check("posture: lost legs depress confidence only when standing",
    sitConfidence === 1 && pose.confidence < 1,
    `sitting=${sitConfidence.toFixed(2)} standing=${pose.confidence.toFixed(2)}`);
}

// --- 6. Degradation: per-bone gating, hold, then decay to relaxed ----------
//
// The old behaviour was a binary per-chain gate that snapped the whole arm to
// T-pose. These cover what replaced it (SPEC.md 5.7).

/** Fresh solver per scenario: lastGood and decay ages persist across solves. */
function freshRun(
  points: Float32Array,
  vis: Float32Array,
  frames: number,
  startMs = 0,
): PoseSolver {
  const s = makeSolver();
  for (let i = 0; i < frames; i++) {
    s.solve(points, vis, pose, startMs + i * 33.3);
  }
  return s;
}

function armDirection(bone: HumanBoneName): V3 {
  const out = v3();
  rotateV3(out, boneQuat(pose.rotations, bone), [1, 0, 0]);
  return out;
}

// Losing the hand must not disturb the upper arm.
{
  const vis = new Float32Array(LANDMARK_COUNT).fill(1);
  vis[LM.LEFT_WRIST] = 0.05;
  vis[LM.LEFT_INDEX] = 0.05;
  vis[LM.LEFT_PINKY] = 0.05;
  const s = freshRun(bent, vis, 120);
  check("per-bone: lost hand leaves the upper arm fully driven",
    (s.weights[BONE_INDEX["leftUpperArm"]] ?? 0) > 0.99,
    `weight=${(s.weights[BONE_INDEX["leftUpperArm"]] ?? 0).toFixed(3)}`);
  check("per-bone: the hand itself is released",
    (s.weights[BONE_INDEX["leftHand"]] ?? 1) < 0.01,
    `weight=${(s.weights[BONE_INDEX["leftHand"]] ?? 1).toFixed(3)}`);
  check("per-bone: the other arm is untouched",
    (s.weights[BONE_INDEX["rightHand"]] ?? 0) > 0.99);
}

// Immediately after losing an arm it must hold its last pose, not snap away.
{
  const full = new Float32Array(LANDMARK_COUNT).fill(1);
  const s = makeSolver();
  for (let i = 0; i < 30; i++) s.solve(bent, full, pose, i * 33.3);
  const heldTarget = armDirection("leftLowerArm");

  const lost = new Float32Array(LANDMARK_COUNT).fill(1);
  lost[LM.LEFT_ELBOW] = 0.05;
  lost[LM.LEFT_WRIST] = 0.05;
  s.solve(bent, lost, pose, 30 * 33.3);
  const justAfter = armDirection("leftLowerArm");

  const drift = Math.hypot(
    (justAfter[0] ?? 0) - (heldTarget[0] ?? 0),
    (justAfter[1] ?? 0) - (heldTarget[1] ?? 0),
    (justAfter[2] ?? 0) - (heldTarget[2] ?? 0),
  );
  check("hold: one frame after loss the arm has barely moved", drift < 0.02,
    `drift=${drift.toFixed(4)}`);
}

// After hold plus decay it must reach the relaxed pose -- arms DOWN, not out.
{
  const lost = new Float32Array(LANDMARK_COUNT).fill(1);
  for (const i of [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_INDEX, LM.LEFT_PINKY]) {
    lost[i] = 0.05;
  }
  freshRun(bent, lost, 150); // ~5s, well past hold + decay
  const dir = armDirection("leftUpperArm");
  check("decay: untracked upper arm ends up pointing down",
    (dir[1] ?? 0) < -0.9, `dir=[${dir.map((n) => n.toFixed(2)).join(",")}]`);
  check("decay: it is NOT the T-pose it used to snap to",
    Math.abs(dir[0] ?? 0) < 0.5, `x=${(dir[0] ?? 0).toFixed(2)}`);
}

// Crossing the threshold must be continuous, which is what stops one arm
// behaving visibly differently from the other over a small confidence gap.
{
  const below = new Float32Array(LANDMARK_COUNT).fill(1);
  below[LM.LEFT_ELBOW] = 0.48;
  below[LM.LEFT_WRIST] = 0.48;
  const a = freshRun(bent, below, 2);

  const above = new Float32Array(LANDMARK_COUNT).fill(1);
  above[LM.LEFT_ELBOW] = 0.52;
  above[LM.LEFT_WRIST] = 0.52;
  const b = freshRun(bent, above, 2);

  const wa = a.weights[BONE_INDEX["leftLowerArm"]] ?? 0;
  const wb = b.weights[BONE_INDEX["leftLowerArm"]] ?? 0;
  check("blend: weight is continuous across the threshold", Math.abs(wb - wa) < 0.2,
    `${wa.toFixed(3)} -> ${wb.toFixed(3)}`);
  check("blend: partial confidence gives partial weight", wa > 0 && wa < 1,
    `weight=${wa.toFixed(3)}`);
}

const partial = new Float32Array(LANDMARK_COUNT).fill(1);
partial[LM.LEFT_ELBOW] = 0.1;
partial[LM.LEFT_WRIST] = 0.1;
solver.solve(bent, partial, pose);
check("gated: confidence drops below 1", pose.confidence < 1);


// --- 7. Idle motion (SPEC.md 8) --------------------------------------------
//
// Idle is an additive layer, not a fallback: the spine chain is ungated and
// always tracked, so a fallback-only idle would never breathe. These check it
// runs regardless of tracking, stays confined to the bones it should touch,
// and can be switched off completely.
{
  const full = new Float32Array(LANDMARK_COUNT).fill(1);
  const s = new PoseSolver();

  const sampleAfter = (solver: PoseSolver, frames: number, bone: HumanBoneName): Q4 => {
    for (let i = 0; i < frames; i++) solver.solve(rest, full, pose, i * 33.3);
    return boneQuat(pose.rotations, bone);
  };

  // Fully tracked, perfectly still input: any motion is the idle layer.
  const a = sampleAfter(s, 1, "upperChest");
  const b = sampleAfter(s, 40, "upperChest");
  check("idle: the torso breathes even while fully tracked",
    a.some((v, i) => Math.abs(v - (b[i] ?? 0)) > 1e-4),
    `${JSON.stringify(a.map((n) => +n.toFixed(5)))} -> ${JSON.stringify(b.map((n) => +n.toFixed(5)))}`);

  // Arms are not given idle motion directly, but their LOCAL rotation still
  // changes: the solver fixes an arm's world direction from landmarks, so
  // when the chest breathes underneath it the arm counter-rotates to stay
  // pointing where it was tracked. That is correct -- the arm holds still in
  // the world while the torso moves under it -- and the invariant worth
  // asserting is that the compensation stays bounded by the breath itself
  // rather than becoming independent motion.
  const armSolver = new PoseSolver();
  let armMax = 0;
  for (let i = 0; i < 400; i++) {
    armSolver.solve(rest, full, pose, i * 33.3);
    armMax = Math.max(armMax, angleOf(boneQuat(pose.rotations, "leftUpperArm")));
  }
  check("idle: arm compensation stays bounded by breath depth", armMax < 3,
    `${armMax.toFixed(2)}deg`);

  // Magnitude: breathing must be subtle enough not to read as tracking.
  const peak = new PoseSolver();
  let maxAngle = 0;
  for (let i = 0; i < 400; i++) {
    peak.solve(rest, full, pose, i * 33.3);
    maxAngle = Math.max(maxAngle, angleOf(boneQuat(pose.rotations, "upperChest")));
  }
  check("idle: breathing stays under 3 degrees", maxAngle < 3, `${maxAngle.toFixed(2)}deg`);

  // amount 0 is a hard off switch.
  const still = new PoseSolver();
  still.idle.amount = 0;
  const c = sampleAfter(still, 1, "upperChest");
  const d = sampleAfter(still, 80, "upperChest");
  check("idle: amount 0 disables all motion",
    c.every((v, i) => Math.abs(v - (d[i] ?? 0)) < 1e-9) && isIdentity(d));
}

// --- 8. Hip sway (SPEC.md 5.5) ---------------------------------------------
//
// Derived from IMAGE space: world landmarks are hip-centred, so the hips sit
// at zero by construction and cannot report that the body moved.
{
  const full = new Float32Array(LANDMARK_COUNT).fill(1);

  /** Image-space landmarks with the hips at a given horizontal position. */
  const imageAt = (x: number): Float32Array => {
    const img = new Float32Array(LANDMARK_COUNT * 3).fill(0.5);
    img[LM.LEFT_HIP * 3] = x;
    img[LM.RIGHT_HIP * 3] = x;
    return img;
  };

  const settle = (solver: PoseSolver, img: Float32Array, frames: number, from = 0): void => {
    for (let i = 0; i < frames; i++) {
      solver.solve(rest, full, pose, (from + i) * 33.3, null, img);
    }
  };

  // Starting off-centre must NOT lean the avatar: the baseline seeds to
  // wherever the subject is, so sway means "moved", not "is not centred".
  const s1 = makeSolver();
  settle(s1, imageAt(0.3), 30);
  check("sway: an off-centre subject is not leaned", Math.abs(pose.rootOffset[0] ?? 1) < 0.005,
    `${(pose.rootOffset[0] ?? 0).toFixed(4)}m`);

  // Moving away from the established neutral does sway, in the right direction.
  settle(s1, imageAt(0.45), 30, 30);
  const right = pose.rootOffset[0] ?? 0;
  check("sway: moving right in frame sways to +X", right > 0.01, `${right.toFixed(4)}m`);

  const s2 = makeSolver();
  settle(s2, imageAt(0.5), 30);
  settle(s2, imageAt(0.35), 30, 30);
  const left = pose.rootOffset[0] ?? 0;
  check("sway: moving left in frame sways to -X", left < -0.01, `${left.toFixed(4)}m`);

  // Clamped, so a big move cannot fling the avatar across the stage.
  const s3 = makeSolver();
  settle(s3, imageAt(0.5), 30);
  settle(s3, imageAt(1.0), 40, 30);
  const clamped = Math.abs(pose.rootOffset[0] ?? 0);
  check("sway: large movement stays clamped",
    clamped <= (s3.options.sway.max ?? 0) + 1e-6, `${clamped.toFixed(4)}m`);

  // Depth and height are never swayed; depth is the unreliable axis.
  check("sway: vertical and depth stay zero",
    (pose.rootOffset[1] ?? 1) === 0 && (pose.rootOffset[2] ?? 1) === 0);

  // Holding a new position must re-centre, so a shifted chair does not lean
  // the avatar forever.
  settle(s3, imageAt(1.0), 2000, 70);
  check("sway: a held position re-centres over time",
    Math.abs(pose.rootOffset[0] ?? 1) < 0.02, `${(pose.rootOffset[0] ?? 0).toFixed(4)}m`);

  // No image data at all must leave the avatar anchored, not drifting.
  const s4 = makeSolver();
  s4.solve(rest, full, pose, 0, null, null);
  check("sway: absent image data leaves the root anchored",
    (pose.rootOffset[0] ?? 1) === 0);
}

// --- 9. Noise sensitivity (SPEC.md 5.6) ------------------------------------
//
// A singularity in the solver shows up as a limb shaking at one particular
// orientation while the input is perfectly still. It cannot be found by
// checking any single pose, so this sweeps orientations and measures how much
// output change a millimetre of landmark noise produces at each.
{
  const full = new Float32Array(LANDMARK_COUNT).fill(1);

  /** A palm-down hand, rotated about `axis` by `degrees` around the wrist. */
  const posedHand = (axis: V3, degrees: number): Float32Array => {
    const q = quat();
    setAxisAngle(q, axis, (degrees * Math.PI) / 180);
    return rotateHand(makeHand("left", 0.65, 1.4), q, 0.65, 1.4);
  };

  /** Deterministic sub-millimetre perturbation. */
  const jitter = (a: Float32Array, seed: number): Float32Array => {
    const out = a.slice();
    for (let i = 0; i < out.length; i++) {
      out[i] = (out[i] ?? 0) + Math.sin(i * 12.9898 + seed) * 0.0005;
    }
    return out;
  };

  const angleBetween = (a: Q4, b: Q4): number => {
    const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
    return (2 * Math.acos(d) * 180) / Math.PI;
  };

  /** Degrees of output change caused by one millimetre of input noise. */
  const sensitivity = (axis: V3, degrees: number, bone: HumanBoneName): number => {
    const h = posedHand(axis, degrees);
    const s = makeSolver();
    s.solve(rest, full, pose, 0, { left: project(jitter(h, 1)), right: null });
    const a = boneQuat(pose.rotations, bone);
    s.solve(rest, full, pose, 33.3, { left: project(jitter(h, 2)), right: null });
    return angleBetween(a, boneQuat(pose.rotations, bone));
  };

  /** Comfortably above the ~0.5 baseline, far below a real singularity. */
  const LIMIT = 3;

  let worstRoll = 0;
  let worstRollAt = 0;
  for (let deg = 0; deg <= 180; deg += 15) {
    const v = Math.max(
      sensitivity([1, 0, 0], deg, "leftHand"),
      sensitivity([1, 0, 0], deg, "leftLowerArm"),
    );
    if (v > worstRoll) { worstRoll = v; worstRollAt = deg; }
  }
  check("sensitivity: palm roll has no unstable orientation", worstRoll < LIMIT,
    `worst ${worstRoll.toFixed(2)}deg at roll ${worstRollAt}deg`);

  // The bend sweep is the one that mattered: the palm normal lines up with
  // the forearm at 90, and the hand folds back on the arm at 180.
  let worstBend = 0;
  let worstBendAt = 0;
  for (let deg = 0; deg <= 180; deg += 15) {
    const v = Math.max(
      sensitivity([0, 0, 1], deg, "leftHand"),
      sensitivity([0, 0, 1], deg, "leftLowerArm"),
    );
    if (v > worstBend) { worstBend = v; worstBendAt = deg; }
  }
  check("sensitivity: hand bend has no unstable orientation", worstBend < LIMIT,
    `worst ${worstBend.toFixed(2)}deg at bend ${worstBendAt}deg`);
}

// --- 10. Shake under realistic noise (SPEC.md 5.6) -------------------------
//
// Section 9 measures single-frame sensitivity, which finds singularities.
// Shaking is a time-series property, so this measures RMS frame-to-frame
// change over a run with independent per-frame noise, which is what the eye
// actually perceives.
//
// Noise here is depth-dominant, because that is what monocular tracking
// produces. With uniform noise a palm angled edge-on to the camera looks
// fine; with realistic noise its orientation is determined almost entirely
// by the least reliable axis.
//
// This exercises the solver together with the hand filter, since neither is
// sufficient alone -- the solver cannot smooth and the filter cannot know
// what the geometry is sensitive to. It therefore duplicates wiring that
// main.ts owns, and would not catch the filter being removed there.
{
  const full = new Float32Array(LANDMARK_COUNT).fill(1);

  const palmDownHand = (pitchDegrees: number): Float32Array => {
    const q = quat();
    setAxisAngle(q, [0, 0, 1], (pitchDegrees * Math.PI) / 180);
    return rotateHand(makeHand("left", 0.65, 1.4), q, 0.65, 1.4);
  };

  /** Depth noise is roughly five times the lateral noise in practice. */
  const noisy = (a: Float32Array, seed: number): Float32Array => {
    const out = a.slice();
    for (let i = 0; i < out.length; i++) {
      const amp = i % 3 === 2 ? 0.0025 : 0.0005;
      out[i] = (out[i] ?? 0) + Math.sin(i * 12.9898 + seed * 7.13) * amp;
    }
    return out;
  };

  const angleBetweenQ = (a: Q4, b: Q4): number => {
    const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
    return (2 * Math.acos(d) * 180) / Math.PI;
  };

  const shake = (pitch: number, bone: HumanBoneName): number => {
    const s = makeSolver();
    const f = new LandmarkFilter(HAND_LANDMARK_COUNT);
    f.xy = { ...DEFAULT_HAND_XY_PARAMS };
    f.z = { ...DEFAULT_HAND_Z_PARAMS };
    const filtered = new Float32Array(HAND_LANDMARK_COUNT * 3);
    const hand = palmDownHand(pitch);

    let prev: Q4 | null = null;
    let acc = 0;
    let n = 0;
    for (let i = 0; i < 120; i++) {
      f.apply(filtered, noisy(hand, i), i * 33.3);
      s.solve(noisy(rest, i + 500), full, pose, i * 33.3, { left: project(filtered), right: null });
      const q = boneQuat(pose.rotations, bone);
      // Skip the filter's warm-up.
      if (prev && i > 30) { acc += angleBetweenQ(prev, q) ** 2; n++; }
      prev = q;
    }
    return Math.sqrt(acc / Math.max(1, n));
  };

  let worst = 0;
  let worstAt = 0;
  for (const pitch of [0, 30, 60, 90]) {
    const v = Math.max(shake(pitch, "leftLowerArm"), shake(pitch, "leftHand"));
    if (v > worst) { worst = v; worstAt = pitch; }
  }
  // Unfiltered this reaches about 6 degrees with the palm pitched down, which
  // is plainly visible shaking.
  check("shake: palm angled down stays steady under depth noise", worst < 1.5,
    `worst ${worst.toFixed(2)}deg at pitch ${worstAt}deg`);
}

// --- 11. Hand roll-flip correction (SPEC.md 5.6.2) -------------------------
//
// The tracker reports a hand rolled 180 degrees about its own axis when it
// mistakes the palm for the back, which it does reliably for a hand hanging
// downward. The projection stays correct, so it is the evidence used.
//
// The dangerous direction is a FALSE POSITIVE: correcting a hand that was
// already right would invert a good one. That is checked first.
{
  const full = new Float32Array(LANDMARK_COUNT).fill(1);

  /** A hand tilted part way toward the camera: clear projection, real depth. */
  const tilted = (): Float32Array => {
    const q = quat();
    setAxisAngle(q, [1, 0, 0], (50 * Math.PI) / 180);
    return rotateHand(makeHand("left", 0.65, 1.4), q, 0.65, 1.4);
  };

  /** What the tracker does wrong: the hand rolled 180 degrees about itself. */
  const rolled = (h: Float32Array): Float32Array => {
    const q = quat();
    setAxisAngle(q, [1, 0, 0], Math.PI);
    return rotateHand(h, q, 0.65, 1.4);
  };

  /** Composed world orientation, which is what a viewer sees. */
  const handWorld = (): Q4 => {
    const w = quat();
    mulQ4(w, boneQuat(pose.rotations, "leftShoulder"), boneQuat(pose.rotations, "leftUpperArm"));
    mulQ4(w, w, boneQuat(pose.rotations, "leftLowerArm"));
    mulQ4(w, w, boneQuat(pose.rotations, "leftHand"));
    return [w[0], w[1], w[2], w[3]];
  };

  const settle = (solver: PoseSolver, hand: HandInput, frames = 8): Q4 => {
    for (let i = 0; i < frames; i++) {
      solver.solve(rest, full, pose, i * 33.3, { left: hand, right: null });
    }
    return handWorld();
  };

  const good = tilted();
  const truth = settle(makeSolver(), project(good));

  // A correct hand must be left alone. This is the failure that would matter.
  {
    const s = makeSolver();
    const got = settle(s, project(good));
    check("a correct hand is not flagged", !s.isDepthFlipped("left"));
    // Tolerance covers float noise from composing four quaternions, which is
    // orders of magnitude below anything visible.
    check("a correct hand is left untouched",
      angleOf(mulQ(invQ(truth), got)) < 0.1,
      `${angleOf(mulQ(invQ(truth), got)).toFixed(3)} deg`);
  }

  // A rolled hand must be detected and rolled back.
  {
    // Image from the REAL hand, reconstruction from the rolled one: exactly
    // what the tracker produces when it picks the wrong side.
    const broken: HandInput = { world: rolled(good), image: project(good).image };

    const s = makeSolver();
    const got = settle(s, broken);
    check("a rolled hand is detected", s.isDepthFlipped("left"));
    const diff = angleOf(mulQ(invQ(truth), got));
    check("a rolled hand is corrected back", diff < 1, `${diff.toFixed(2)} deg from truth`);

    const off = makeSolver();
    off.options.correctHandDepthFlip = false;
    const uncorrected = settle(off, broken);
    const stillWrong = angleOf(mulQ(invQ(truth), uncorrected));
    check("the option actually disables the correction", stillWrong > 90,
      `${stillWrong.toFixed(0)} deg wrong with it off`);
  }

  // Hysteresis: one disagreeing frame must not change the verdict.
  {
    const s = makeSolver();
    settle(s, project(good));
    s.solve(rest, full, pose, 1000, {
      left: { world: rolled(good), image: project(good).image },
      right: null,
    });
    check("a single bad frame does not flip the verdict", !s.isDepthFlipped("left"));
  }

  // Edge-on: the projected palm nearly vanishes, so the detector must abstain
  // rather than decide from noise.
  {
    const edge = makeHand("left", 0.65, 1.4); // palm-down, edge-on to the camera
    const s = makeSolver();
    const before = s.isDepthFlipped("left");
    for (let i = 0; i < 20; i++) {
      s.solve(rest, full, pose, i * 33.3, { left: project(edge), right: null });
    }
    check("an edge-on palm does not change the verdict", s.isDepthFlipped("left") === before);
  }
}

// --- fingers: off by default, and identity when off ------------------------
/** Everything visible; the finger checks are about geometry, not gating. */
const allVisible = new Float32Array(LANDMARK_COUNT).fill(1);

/*
 * makeSolver() rather than a bare PoseSolver, because idle breathing rides on
 * top of every bone and would be read here as the solver inventing rotation.
 * Using the bare constructor first put 33 degrees on a flat hand's fingers and
 * looked exactly like a sign error in the rest direction.
 */
{
  const solver = makeSolver();
  const pose = createAvatarPose();
  const hand = project(makeFullHand("left", 0.65, 1.4, 30));
  for (let i = 0; i < 8; i++) solver.solve(rest, allVisible, pose, i * 33.3, { left: hand, right: null });

  check("fingers are off by default", solver.options.fingers === false);
  const fingers: HumanBoneName[] = [
    "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
    "leftThumbMetacarpal", "leftLittleDistal",
  ];
  // A curled hand must still leave them alone while the option is off.
  check("an untracked finger stays at rest",
    fingers.every((b) => angleOf(boneQuat(pose.rotations, b)) < 1e-3),
    fingers.map((b) => angleOf(boneQuat(pose.rotations, b)).toFixed(3)).join(" "));
}

// --- a flat hand is the rest pose, so it must solve to identity ------------
{
  const solver = makeSolver();
  solver.options.fingers = true;
  const pose = createAvatarPose();
  const hand = project(makeFullHand("left", 0.65, 1.4, 0));
  for (let i = 0; i < 12; i++) solver.solve(rest, allVisible, pose, i * 33.3, { left: hand, right: null });

  /*
   * The strongest assertion available: fingers lying along the hand's own
   * axis ARE the humanoid rest pose, so anything else is the solver inventing
   * rotation. It would also catch the rest direction being read from
   * restDirOf(fingerBone), which falls back to +X -- right for the left hand
   * and exactly backwards for the right.
   */
  const flat: HumanBoneName[] = [
    "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
    "leftMiddleProximal", "leftRingProximal", "leftLittleProximal",
  ];
  const worst = Math.max(...flat.map((b) => angleOf(boneQuat(pose.rotations, b))));
  check("a flat hand solves its fingers to identity", worst < 0.5,
    `${worst.toFixed(2)} degrees`);
}

// --- and the right hand too, which is where a sign error would show -------
{
  const solver = makeSolver();
  solver.options.fingers = true;
  const pose = createAvatarPose();
  const hand = project(makeFullHand("right", -0.65, 1.4, 0));
  for (let i = 0; i < 12; i++) solver.solve(rest, allVisible, pose, i * 33.3, { left: null, right: hand });

  const flat: HumanBoneName[] = [
    "rightIndexProximal", "rightMiddleProximal", "rightLittleDistal",
  ];
  const worst = Math.max(...flat.map((b) => angleOf(boneQuat(pose.rotations, b))));
  // Fails outright if the rest direction is taken as +X for both hands.
  check("a flat right hand solves its fingers to identity", worst < 0.5,
    `${worst.toFixed(2)} degrees`);
}

// --- a curled hand actually curls ------------------------------------------
{
  const solver = makeSolver();
  solver.options.fingers = true;
  const pose = createAvatarPose();
  const hand = project(makeFullHand("left", 0.65, 1.4, 25));
  for (let i = 0; i < 12; i++) solver.solve(rest, allVisible, pose, i * 33.3, { left: hand, right: null });

  const proximal = angleOf(boneQuat(pose.rotations, "leftIndexProximal"));
  check("a curled finger bends at the knuckle", proximal > 15 && proximal < 35,
    `${proximal.toFixed(1)} degrees, expected about 25`);

  // The fixture bends each joint one increment further than the last, so the
  // LOCAL rotations should come out roughly equal down the chain.
  const middle = angleOf(boneQuat(pose.rotations, "leftIndexIntermediate"));
  check("the next joint bends by about as much", middle > 15 && middle < 35,
    `${middle.toFixed(1)} degrees`);

  // The thumb has a metacarpal where the others have an intermediate. Driving
  // it as though it were a finger would leave this bone at rest.
  const thumb = angleOf(boneQuat(pose.rotations, "leftThumbMetacarpal"));
  check("the thumb is driven through its metacarpal", thumb > 1,
    `${thumb.toFixed(1)} degrees`);
}


if (failures > 0) throw new Error(`${failures} solver check failure(s)`);
console.log("\nALL PASS");
