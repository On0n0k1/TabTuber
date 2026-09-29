/*
 * The reference rig from SPEC.md 7.1.1, in three.js space.
 *
 * SPEC.md gives Blender coordinates (Z-up, model facing -Y). The conversion
 * to three.js (Y-up, model facing +Z) is x -> x, z -> y, -y -> z. Spot check:
 * the Blender foot tail (0.09, -0.16, 0.03) becomes (0.09, 0.03, 0.16) here,
 * pointing forward along +Z, which is correct.
 *
 * This exists so milestone 3b can drive a skeleton with the real solver
 * output before any Blender asset exists, and so the solver has rest
 * directions to work from. When a VRM arrives it replaces this rig but not
 * the solver, which is the whole point of the split (SPEC.md section 12).
 *
 * Rest orientation of every bone is identity, matching three-vrm's normalised
 * humanoid. So a bone's world rest direction is simply tail - head, and a
 * solved world rotation can be applied without a per-bone basis correction.
 */

import type { HumanBoneName } from "../types.ts";
import { normalize, sub, v3, type V3 } from "./math.ts";

export interface RestBone {
  readonly name: HumanBoneName;
  /** null for the root. Parents always precede children in REFERENCE_RIG. */
  readonly parent: HumanBoneName | null;
  readonly head: V3;
  readonly tail: V3;
}

/** Parents before children -- the solver relies on this ordering. */
export const REFERENCE_RIG: readonly RestBone[] = [
  { name: "hips", parent: null, head: [0, 0.95, 0], tail: [0, 1.02, 0] },
  { name: "spine", parent: "hips", head: [0, 1.02, 0], tail: [0, 1.15, 0] },
  { name: "chest", parent: "spine", head: [0, 1.15, 0], tail: [0, 1.28, 0] },
  { name: "upperChest", parent: "chest", head: [0, 1.28, 0], tail: [0, 1.38, 0] },
  { name: "neck", parent: "upperChest", head: [0, 1.38, 0], tail: [0, 1.48, 0] },
  { name: "head", parent: "neck", head: [0, 1.48, 0], tail: [0, 1.62, 0] },

  { name: "leftEye", parent: "head", head: [0.035, 1.55, 0.05], tail: [0.035, 1.55, 0.11] },
  { name: "rightEye", parent: "head", head: [-0.035, 1.55, 0.05], tail: [-0.035, 1.55, 0.11] },

  { name: "leftShoulder", parent: "upperChest", head: [0.02, 1.4, 0], tail: [0.12, 1.4, 0] },
  { name: "leftUpperArm", parent: "leftShoulder", head: [0.12, 1.4, 0], tail: [0.4, 1.4, 0] },
  { name: "leftLowerArm", parent: "leftUpperArm", head: [0.4, 1.4, 0], tail: [0.65, 1.4, 0] },
  { name: "leftHand", parent: "leftLowerArm", head: [0.65, 1.4, 0], tail: [0.78, 1.4, 0] },

  { name: "rightShoulder", parent: "upperChest", head: [-0.02, 1.4, 0], tail: [-0.12, 1.4, 0] },
  { name: "rightUpperArm", parent: "rightShoulder", head: [-0.12, 1.4, 0], tail: [-0.4, 1.4, 0] },
  { name: "rightLowerArm", parent: "rightUpperArm", head: [-0.4, 1.4, 0], tail: [-0.65, 1.4, 0] },
  { name: "rightHand", parent: "rightLowerArm", head: [-0.65, 1.4, 0], tail: [-0.78, 1.4, 0] },

  { name: "leftUpperLeg", parent: "hips", head: [0.09, 0.92, 0], tail: [0.09, 0.52, 0] },
  { name: "leftLowerLeg", parent: "leftUpperLeg", head: [0.09, 0.52, 0], tail: [0.09, 0.1, 0] },
  { name: "leftFoot", parent: "leftLowerLeg", head: [0.09, 0.1, 0], tail: [0.09, 0.03, 0.16] },

  { name: "rightUpperLeg", parent: "hips", head: [-0.09, 0.92, 0], tail: [-0.09, 0.52, 0] },
  { name: "rightLowerLeg", parent: "rightUpperLeg", head: [-0.09, 0.52, 0], tail: [-0.09, 0.1, 0] },
  { name: "rightFoot", parent: "rightLowerLeg", head: [-0.09, 0.1, 0], tail: [-0.09, 0.03, 0.16] },
];

export const REST_BONE: ReadonlyMap<HumanBoneName, RestBone> = new Map(
  REFERENCE_RIG.map((b) => [b.name, b]),
);

/** Unit rest direction of each bone, head to tail, in world space. */
export const REST_DIR: ReadonlyMap<HumanBoneName, V3> = new Map(
  REFERENCE_RIG.map((b) => [b.name, normalize(v3(), sub(v3(), b.tail, b.head))]),
);

export function restDirOf(name: HumanBoneName): Readonly<V3> {
  return REST_DIR.get(name) ?? [1, 0, 0];
}
