/*
 * How well the palm is presented to the camera (SPEC.md 12, 12.1).
 *
 * The palm's two axes foreshorten independently and mean different things.
 * Its length, wrist to knuckles, sets the hand's pointing direction and stays
 * visible from almost any angle. Its width, index knuckle to pinky knuckle,
 * sets the roll and collapses when the palm turns edge-on -- measured falling
 * from 50.6mm to 8.0mm across one wrist-flexed pose while the length held at
 * 85mm. That is why an edge-on hand points correctly while spinning about its
 * own axis.
 *
 * So the measure is the ratio of the SMALLEST on-screen spread to the
 * largest, not the overall spread. A bounding box is dominated by the length
 * and barely moves.
 *
 * The result is deliberately a ratio. An absolute spread in pixels or
 * millimetres would mean different things for different hand sizes, camera
 * distances and resolutions, and a threshold picked against one person's
 * setup would not transfer to anyone else. Dividing two measurements of the
 * same thing cancels all of that: roughly 0.09 edge-on and 0.59 face-on, for
 * any hand at any distance (SPEC.md 12.1).
 */

import { PALM_RIM } from "../tracker/handLandmarks.ts";

/**
 * Ratio of the palm's minor to major on-screen spread, 0 to 1.
 *
 * `image` is normalised image space, x and y interleaved. `aspect` is the
 * frame's width over its height: x and y are each normalised by a different
 * dimension, so without it a hand held horizontally would measure differently
 * from the same hand held vertically.
 *
 * Returns 1 for degenerate input, which reads as "well conditioned" and
 * therefore applies no extra smoothing -- failing toward the existing
 * behaviour rather than toward a guess.
 */
export function palmConditioning(image: Float32Array, aspect: number): number {
  let cx = 0;
  let cy = 0;
  for (const i of PALM_RIM) {
    cx += (image[i * 2] ?? 0) * aspect;
    cy += image[i * 2 + 1] ?? 0;
  }
  const n = PALM_RIM.length;
  cx /= n;
  cy /= n;

  // 2x2 covariance of the rim points.
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const i of PALM_RIM) {
    const dx = (image[i * 2] ?? 0) * aspect - cx;
    const dy = (image[i * 2 + 1] ?? 0) - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }

  // Closed-form eigenvalues; the spreads are their square roots, and the
  // ratio of spreads is the square root of the ratio of eigenvalues.
  const trace = xx + yy;
  if (trace <= 1e-12) return 1;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - (xx * yy - xy * xy)));
  const major = trace / 2 + disc;
  const minor = trace / 2 - disc;
  if (major <= 1e-12) return 1;

  return Math.sqrt(Math.max(0, minor) / major);
}
