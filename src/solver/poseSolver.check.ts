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
import { PoseSolver } from "./poseSolver.ts";
import { HAND } from "../tracker/handLandmarks.ts";
import { HAND_LANDMARK_COUNT } from "../types.ts";
import { rotateV3, setAxisAngle, quat, v3, type Q4, type V3 } from "./math.ts";

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
const solver = new PoseSolver();
const pose = createAvatarPose();

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

// --- 5b. Palm frame: hand orientation from 21 landmarks --------------------
//
// Only differences matter, so these are written in body-relative coordinates
// even though Holistic centres hand world landmarks on the hand itself.

/** A palm-down hand in T-pose: fingers along the arm, thumb forward (+Z). */
function restHand(side: "left" | "right"): Float32Array {
  const h = new Float32Array(HAND_LANDMARK_COUNT * 3);
  const s = side === "left" ? 1 : -1;
  const set = (i: number, x: number, y: number, z: number): void => {
    h[i * 3] = x; h[i * 3 + 1] = y; h[i * 3 + 2] = z;
  };
  set(HAND.WRIST, 0.65 * s, 1.4, 0);
  set(HAND.MIDDLE_MCP, 0.73 * s, 1.4, 0);
  // Index sits on the thumb side (+Z), pinky opposite, for BOTH hands.
  set(HAND.INDEX_MCP, 0.73 * s, 1.4, 0.02);
  set(HAND.PINKY_MCP, 0.73 * s, 1.4, -0.02);
  return h;
}

{
  const hands = { left: restHand("left"), right: restHand("right") };
  const s = new PoseSolver();
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
  const h = restHand("left");
  const out = v3();
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    // Rotate about the arm axis, pivoting at the wrist.
    rotateV3(out, roll, [(h[i * 3] ?? 0) - 0.65, (h[i * 3 + 1] ?? 0) - 1.4, h[i * 3 + 2] ?? 0]);
    h[i * 3] = out[0] + 0.65;
    h[i * 3 + 1] = out[1] + 1.4;
    h[i * 3 + 2] = out[2];
  }

  const s = new PoseSolver();
  s.solve(rest, visible, pose, 0, { left: h, right: null });
  const twist = angleOf(boneQuat(pose.rotations, "leftLowerArm"));
  check("palm frame: a 40deg palm roll rolls the forearm",
    Math.abs(twist - 40) < 3, `${twist.toFixed(1)}deg`);
}

// Missing hands must fall back to the pose-model derivation, not break.
{
  const s = new PoseSolver();
  s.solve(rest, visible, pose, 0, { left: null, right: null });
  check("palm frame: absent hands fall back cleanly",
    isIdentity(boneQuat(pose.rotations, "leftHand"), 1e-3),
    JSON.stringify(boneQuat(pose.rotations, "leftHand").map((n) => +n.toFixed(4))));

  const off = new PoseSolver();
  off.options.useHandLandmarks = false;
  off.solve(rest, visible, pose, 0, { left: restHand("left"), right: restHand("right") });
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
  const sit = new PoseSolver();
  sit.options.posture = "sitting";
  sit.solve(standing, visible, pose, 0);
  for (const bone of ["leftUpperLeg", "leftLowerLeg", "leftFoot"] as HumanBoneName[]) {
    check(`posture sitting: ${bone} stays at rest`,
      isIdentity(boneQuat(pose.rotations, bone), 1e-3),
      JSON.stringify(boneQuat(pose.rotations, bone).map((n) => +n.toFixed(4))));
  }

  // Standing must drive them.
  const stand = new PoseSolver();
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
  const s = new PoseSolver();
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
  const s = new PoseSolver();
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

if (failures > 0) throw new Error(`${failures} solver check failure(s)`);
console.log("\nALL PASS");
