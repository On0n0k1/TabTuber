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
 */

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
   * Implemented by negating x, which mirrors the pose rather than relabelling
   * landmarks -- the subject's left landmark then lands on the avatar's right,
   * which is exactly what a mirror does.
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
    const o = i * 3;
    out[o] = (world[o] ?? 0) * sx;
    out[o + 1] = -(world[o + 1] ?? 0) + lift;
    out[o + 2] = -(world[o + 2] ?? 0);
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
