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
import { cross, normalize, sub, v3, type V3 } from "./math.ts";

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

/*
 * Rest directions for the finger bones, which the reference rig does not draw.
 *
 * The four fingers lie along the hand's own axis, so for them this is just
 * +X, and borrowing the hand's direction was correct. THE THUMB DOES NOT.
 * Measured on the reference models, with node rotations composed, a thumb
 * rests about 40 degrees off that axis and swung toward +Z:
 *
 *   metacarpal -> proximal   0.759, -0.044, 0.649    40.6 deg off +X
 *   proximal   -> distal     0.787, -0.034, 0.616    38.1 deg off +X
 *   index proximal (control) 1.000,  0.000, -0.019    1.1 deg
 *
 * Treating the thumb as though it rested along +X therefore applied a
 * constant 40 degrees of rotation to it -- and the metacarpal is a bone
 * INSIDE the palm, so that error dragged palm geometry with it and read as
 * the avatar's palm being stretched out of shape.
 *
 * Two models agree to within 0.003, and the right hand is the exact mirror,
 * so this is a VRM authoring convention rather than one file's quirk. It is
 * still an assumption about the model: a VRM that rests its thumb elsewhere
 * would be wrong by the difference, and reading the figures off the loaded
 * avatar is the way to stop assuming.
 */
const THUMB_REST = {
  metacarpal: [0.759, -0.044, 0.649],
  proximal: [0.787, -0.034, 0.616],
} as const;

const FINGER_REST_DIR: [HumanBoneName, V3][] = (() => {
  const out: [HumanBoneName, V3][] = [];
  for (const side of ["left", "right"] as const) {
    // Mirroring is a reflection across the YZ plane, which negates x alone.
    const sx = side === "left" ? 1 : -1;
    const t = THUMB_REST;
    out.push(
      [`${side}ThumbMetacarpal` as HumanBoneName, [sx * t.metacarpal[0], t.metacarpal[1], t.metacarpal[2]]],
      [`${side}ThumbProximal` as HumanBoneName, [sx * t.proximal[0], t.proximal[1], t.proximal[2]]],
      // The distal bone points at a fingertip, which is not a humanoid bone
      // and so cannot be measured; it continues the proximal closely enough.
      [`${side}ThumbDistal` as HumanBoneName, [sx * t.proximal[0], t.proximal[1], t.proximal[2]]],
    );
    for (const finger of ["Index", "Middle", "Ring", "Little"] as const) {
      for (const segment of ["Proximal", "Intermediate", "Distal"] as const) {
        out.push([`${side}${finger}${segment}` as HumanBoneName, [sx, 0, 0]]);
      }
    }
  }
  return out;
})();

/** Unit rest direction of each bone, head to tail, in world space. */
export const REST_DIR: ReadonlyMap<HumanBoneName, V3> = new Map([
  ...REFERENCE_RIG.map((b): [HumanBoneName, V3] => [
    b.name,
    normalize(v3(), sub(v3(), b.tail, b.head)),
  ]),
  ...FINGER_REST_DIR.map(([name, dir]): [HumanBoneName, V3] => [
    name,
    normalize(v3(), dir),
  ]),
]);

/**
 * The axis a finger joint bends ABOUT, which is also the normal of the plane
 * it bends IN -- the two are the same vector for any hinge.
 *
 * A knuckle has two degrees of freedom: it flexes, and it spreads sideways.
 * The joints past it have one. No joint in a finger splays it at the middle
 * or the tip, so letting the solver put rotation on that axis reproduces
 * nothing anyone can do and spends the whole axis on tracking noise, across
 * twenty of the thirty bones.
 *
 * Flattening a measured direction onto this plane -- dropping its component
 * along this vector -- leaves a direction that can only bend. For a finger
 * resting along the hand axis and curling toward the palm it works out as Z,
 * so the finger stays in the XY plane; the thumb rests elsewhere and gets its
 * own.
 *
 * Naming this the other way round is an easy mistake and was made once here:
 * flexion about Z and spread about Y are adjacent enough that a check written
 * against the wrong one passes whether the constraint is applied or not.
 */
const CURL_TOWARD: V3 = [0, -1, 0];

export const FLEX_AXIS: ReadonlyMap<HumanBoneName, V3> = new Map(
  FINGER_REST_DIR
    /*
     * THE THUMB IS EXEMPT, and gets no constraint at all.
     *
     * CURL_TOWARD is the direction a digit closes in, and a finger closes
     * toward the palm. A thumb does not: it closes ACROSS the palm, in a
     * plane roughly perpendicular to the one its neighbours use. Deriving its
     * bending plane the same way puts it about ninety degrees out, and
     * flattening a thumb onto the wrong plane is worse than not flattening
     * it -- it was visibly correct before this constraint existed and visibly
     * messy with it.
     *
     * Its own plane could be given instead of taken away. That needs a curl
     * direction for the thumb, and a guess is what caused this; measuring one
     * needs thumb-flexion data that nothing here produces. The thumb is also
     * the most mobile digit, with a saddle joint at its base that genuinely
     * does rotate on two axes, so the anatomical argument for constraining it
     * is the weakest of the five -- and the prize is noise on four bones out
     * of thirty.
     */
    .filter(([name]) => !name.includes("Thumb"))
    .map(([name, dir]): [HumanBoneName, V3] => [
      name,
      normalize(v3(), cross(v3(), normalize(v3(), dir), CURL_TOWARD)),
    ]),
);

/** The plane normal to flatten a finger joint onto, or null if it is free. */
export function flexAxisOf(name: HumanBoneName): Readonly<V3> | null {
  return FLEX_AXIS.get(name) ?? null;
}

export function restDirOf(name: HumanBoneName): Readonly<V3> {
  return REST_DIR.get(name) ?? [1, 0, 0];
}
