/*
 * The pose a limb falls back to when tracking is lost (SPEC.md 5.7).
 *
 * Deliberately NOT the rest pose. Rest in a VRM humanoid is a T-pose, arms
 * straight out sideways, which is maximally far from any natural position and
 * the worst possible place for an untracked arm to land. Arms down at the
 * sides with a slight forward bend at the elbow reads as "standing still"
 * rather than "the software broke".
 *
 * These are LOCAL rotations relative to the normalised rest pose, so they
 * compose the same way solved rotations do.
 */

import { BONE_COUNT, BONE_INDEX, type HumanBoneName } from "../types.ts";
import { identity, quat, setAxisAngle, type Q4 } from "./math.ts";

const DEG = Math.PI / 180;

/** How far the upper arms swing down from horizontal. */
const ARM_DROP_DEG = 75;
/** Slight forward bend so the arms do not hang like a puppet's. */
const ELBOW_BEND_DEG = 20;

/**
 * Mirrored pairs negate the angle: reflecting across the YZ plane maps a
 * rotation about an axis to the same axis with the opposite sign.
 */
const RELAXED_ROTATIONS: ReadonlyArray<[HumanBoneName, [number, number, number], number]> = [
  // Down and slightly out, in the XY plane.
  ["leftUpperArm", [0, 0, 1], -ARM_DROP_DEG],
  ["rightUpperArm", [0, 0, 1], ARM_DROP_DEG],
  // About Y, which is what carries the forearm forward once the arm is down.
  ["leftLowerArm", [0, 1, 0], -ELBOW_BEND_DEG],
  ["rightLowerArm", [0, 1, 0], ELBOW_BEND_DEG],
];

/** Local relaxed rotation per bone, indexed by BONE_INDEX. Identity elsewhere. */
export const RELAXED_POSE: readonly Q4[] = (() => {
  const table: Q4[] = Array.from({ length: BONE_COUNT }, () => identity(quat()));
  for (const [bone, axis, degrees] of RELAXED_ROTATIONS) {
    setAxisAngle(table[BONE_INDEX[bone]] as Q4, axis, degrees * DEG);
  }
  return table;
})();
