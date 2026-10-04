/*
 * ARKit blendshape names, as MediaPipe reports them (SPEC.md 13).
 *
 * Indexed by name rather than by position. MediaPipe documents the order but
 * relying on it would make a silent, total misattribution the failure mode of
 * any upstream change -- brow weights driving the jaw, and nothing to see but
 * a face behaving oddly.
 */

export const ARKIT_BLENDSHAPES = [
  "_neutral",
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight",
  "eyeLookDownLeft", "eyeLookDownRight",
  "eyeLookInLeft", "eyeLookInRight",
  "eyeLookOutLeft", "eyeLookOutRight",
  "eyeLookUpLeft", "eyeLookUpRight",
  "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight",
  "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight",
  "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
  "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "noseSneerLeft", "noseSneerRight",
] as const;

export type BlendshapeName = (typeof ARKIT_BLENDSHAPES)[number];

export const BLENDSHAPE_COUNT = ARKIT_BLENDSHAPES.length;

export const BLENDSHAPE_INDEX: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(ARKIT_BLENDSHAPES.map((n, i) => [n, i])),
);

/** Reads one blendshape by name; 0 when the model did not report it. */
export function shape(scores: Float32Array, name: BlendshapeName): number {
  return scores[BLENDSHAPE_INDEX[name] ?? -1] ?? 0;
}
