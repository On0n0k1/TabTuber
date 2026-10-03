/*
 * MediaPipe -> three.js coordinate conversion.
 *
 * THE single place handedness and mirroring are resolved (SPEC.md 5.1).
 * Nothing else in the pipeline may flip an axis. Capture does not mirror the
 * stream, the overlay mirrors in CSS only, and the solver consumes whatever
 * this produces. A second flip somewhere else silently swaps the subject's
 * left and right, which is the hardest bug in this project to see.
 *
 * MediaPipe world landmarks: metres, origin at the hip midpoint, axes aligned
 * with the image -- x rightward across the image, y downward, z increasing
 * away from the camera.
 *
 * three.js: x right, y up, z toward the viewer.
 *
 * So y and z both negate. x is where the mirror choice lives.
 *
 * Handedness check, unmirrored: the subject faces the camera, so their left
 * side appears at larger image x, hence at +X here. With forward = +Z and
 * up = +Y, left = up x forward = +X. That agrees, and it agrees with the
 * reference rig, where the character's left is also +X (SPEC.md 7.1.1).
 *
 * Mirroring negates x AND swaps left/right landmark identities. Negating x
 * alone is a reflection, which is not a rotation: bases built from reflected
 * points are left-handed, and the solver's re-orthogonalisation turns them
 * into a different rotation entirely -- in practice a yawed torso and an
 * upside-down head. Reflection composed with the left/right relabel is a
 * proper rotation, which is what a symmetric body does in a real mirror.
 */

import { MIRROR_INDEX } from "../tracker/landmarks.ts";
import { LANDMARK_COUNT } from "../types.ts";

/**
 * Height of the hip midpoint above the floor, matching the reference rig.
 * MediaPipe's origin is the hips, so this lifts the figure onto the ground
 * plane instead of leaving it centred on the origin.
 */
export const HIP_HEIGHT_M = 0.95;

export interface ConvertOptions {
  /**
   * Mirrored is the usual VTubing preference: raising your right hand moves
   * the limb on the same side of the screen your hand feels like it is on.
   */
  readonly mirror: boolean;
  /** Lift onto the ground plane. Off when the caller wants hip-origin data. */
  readonly grounded?: boolean;
}

/**
 * Converts all landmarks into three.js space. `out` must hold
 * LANDMARK_COUNT * 3 floats and is written in place.
 */
export function mpToThree(
  out: Float32Array,
  world: Float32Array,
  { mirror, grounded = true }: ConvertOptions,
): void {
  const sx = mirror ? -1 : 1;
  const lift = grounded ? HIP_HEIGHT_M : 0;

  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const src = i * 3;
    // Reflected points land in their mirror partner's slot, so a slot always
    // holds the landmark it is named for on the displayed body.
    const dst = (mirror ? (MIRROR_INDEX[i] ?? i) : i) * 3;
    out[dst] = (world[src] ?? 0) * sx;
    out[dst + 1] = -(world[src + 1] ?? 0) + lift;
    out[dst + 2] = -(world[src + 2] ?? 0);
  }
}

/**
 * Converts hand landmarks into three.js space.
 *
 * Orientation only, so the origin is irrelevant and no grounding offset is
 * applied -- Holistic centres hand world landmarks on the hand itself, not on
 * the body. There is no index remap: a hand's own topology has no left/right
 * pairs, and reflecting a left hand's points yields a correctly-shaped right
 * hand with the same indices. Which BUFFER is treated as which side is the
 * caller's decision, and must be swapped alongside the body (see main.ts).
 */
export function handToThree(
  out: Float32Array,
  world: Float32Array,
  mirror: boolean,
): void {
  const sx = mirror ? -1 : 1;
  for (let i = 0; i < out.length / 3; i++) {
    const o = i * 3;
    out[o] = (world[o] ?? 0) * sx;
    out[o + 1] = -(world[o + 1] ?? 0);
    out[o + 2] = -(world[o + 2] ?? 0);
  }
}

/**
 * Mirrors normalised image-space landmarks.
 *
 * Image space is [0, 1], so reflecting is `1 - x`, not a negation. The same
 * left/right index swap applies as for world landmarks, for the same reason:
 * a reflection alone is not a rotation (see the note at the top of this file).
 */
export function mirrorImagePoints(
  out: Float32Array,
  image: Float32Array,
  mirror: boolean,
): void {
  if (!mirror) {
    out.set(image);
    return;
  }
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const src = i * 3;
    const dst = (MIRROR_INDEX[i] ?? i) * 3;
    out[dst] = 1 - (image[src] ?? 0);
    out[dst + 1] = image[src + 1] ?? 0;
    out[dst + 2] = image[src + 2] ?? 0;
  }
}

/**
 * Mirrors a hand's image-space landmarks. Image space is [0, 1], so
 * reflecting is `1 - x` rather than a negation.
 *
 * No index remap: a hand's own topology has no left/right pairs. Which
 * BUFFER is treated as which side is the caller's decision and must be
 * swapped alongside the body, exactly as for the world landmarks.
 */
export function mirrorHandImage(
  out: Float32Array,
  image: Float32Array,
  mirror: boolean,
): void {
  if (!mirror) {
    out.set(image);
    return;
  }
  for (let i = 0; i < out.length / 2; i++) {
    out[i * 2] = 1 - (image[i * 2] ?? 0);
    out[i * 2 + 1] = image[i * 2 + 1] ?? 0;
  }
}

/**
 * Applies the same left/right swap to a per-landmark scalar array.
 *
 * Visibility must travel with its landmark. Without this, the solver would
 * gate the left arm on the right arm's confidence whenever mirroring is on.
 */
export function mirrorScalars(
  out: Float32Array,
  values: Float32Array,
  mirror: boolean,
): void {
  if (!mirror) {
    out.set(values);
    return;
  }
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    out[MIRROR_INDEX[i] ?? i] = values[i] ?? 0;
  }
}

/** Writes landmark `i` into `out` as a 3-vector. */
export function readPoint(
  out: [number, number, number],
  points: Float32Array,
  i: number,
): [number, number, number] {
  const o = i * 3;
  out[0] = points[o] ?? 0;
  out[1] = points[o + 1] ?? 0;
  out[2] = points[o + 2] ?? 0;
  return out;
}

/** Midpoint of two landmarks, written into `out`. */
export function midpoint(
  out: [number, number, number],
  points: Float32Array,
  a: number,
  b: number,
): [number, number, number] {
  const oa = a * 3;
  const ob = b * 3;
  out[0] = ((points[oa] ?? 0) + (points[ob] ?? 0)) * 0.5;
  out[1] = ((points[oa + 1] ?? 0) + (points[ob + 1] ?? 0)) * 0.5;
  out[2] = ((points[oa + 2] ?? 0) + (points[ob + 2] ?? 0)) * 0.5;
  return out;
}
