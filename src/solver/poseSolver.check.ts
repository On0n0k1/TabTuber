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
import { BONE_INDEX, LANDMARK_COUNT, createAvatarPose, type HumanBoneName } from "../types.ts";
import { PoseSolver } from "./poseSolver.ts";
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

// --- 4. Low visibility must release a chain to rest -------------------------
const partial = new Float32Array(LANDMARK_COUNT).fill(1);
partial[LM.LEFT_ELBOW] = 0.1;
partial[LM.LEFT_WRIST] = 0.1;
solver.solve(bent, partial, pose);
check("gated: occluded left arm returns to rest", isIdentity(boneQuat(pose.rotations, "leftLowerArm")));
check("gated: confidence drops below 1", pose.confidence < 1);

if (failures > 0) throw new Error(`${failures} solver check failure(s)`);
console.log("\nALL PASS");
