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

/*
 * A hand at rest curls; it does not splay. The humanoid rest pose has the
 * fingers straight out, which on a released hand reads as a mannequin or a
 * stiff salute, so an untracked hand has to fall somewhere else -- the same
 * argument as the arms above, one joint down.
 *
 * Progressive down the chain, because a relaxed finger bends most in the
 * middle. These are gentle: this is the pose a hand DECAYS to when tracking
 * is lost, so it has to look unremarkable from any angle rather than
 * expressive.
 */
const FINGER_PROXIMAL_DEG = 12;
const FINGER_INTERMEDIATE_DEG = 22;
const FINGER_DISTAL_DEG = 12;

const CURLED_FINGERS = ["Index", "Middle", "Ring", "Little"] as const;

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
  ...fingerCurl(),
];

/**
 * A gentle curl on every finger joint except the thumb's.
 *
 * Flexion is a rotation about Z. In the normalised rest pose the arms lie
 * along X with the palms down, so curling the fingertips toward the palm
 * carries their axis toward -Y, which is negative about Z on the left and
 * positive on the right -- the same mirrored-pair negation as the arms.
 *
 * The THUMB is left at rest deliberately. Its axis is not the others': it
 * opposes across the palm rather than curling in the same plane, so the same
 * rotation that relaxes a finger splays a thumb outward. A thumb at rest
 * reads as neutral; a thumb bent the wrong way reads as broken, and this is a
 * fallback nobody is looking at closely.
 */
function fingerCurl(): [HumanBoneName, [number, number, number], number][] {
  const out: [HumanBoneName, [number, number, number], number][] = [];
  for (const side of ["left", "right"] as const) {
    const sign = side === "left" ? -1 : 1;
    for (const finger of CURLED_FINGERS) {
      out.push(
        [`${side}${finger}Proximal`, [0, 0, 1], sign * FINGER_PROXIMAL_DEG],
        [`${side}${finger}Intermediate`, [0, 0, 1], sign * FINGER_INTERMEDIATE_DEG],
        [`${side}${finger}Distal`, [0, 0, 1], sign * FINGER_DISTAL_DEG],
      );
    }
  }
  return out;
}

/** Local relaxed rotation per bone, indexed by BONE_INDEX. Identity elsewhere. */
export const RELAXED_POSE: readonly Q4[] = (() => {
  const table: Q4[] = Array.from({ length: BONE_COUNT }, () => identity(quat()));
  for (const [bone, axis, degrees] of RELAXED_ROTATIONS) {
    setAxisAngle(table[BONE_INDEX[bone]] as Q4, axis, degrees * DEG);
  }
  return table;
})();
