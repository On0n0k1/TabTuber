/*
 * Region colours, shared by the 2D overlay and the 3D debug views.
 *
 * Left is cool, right is warm, and deliberately so. A mirrored axis or an
 * L/R swap is the most common failure in this pipeline (SPEC.md 5.1, 7.1.2),
 * and opposed hue families make it readable at a glance instead of something
 * you reason about. Keep the two families far apart if these ever change.
 */

import type { ConnectionGroup } from "../tracker/landmarks.ts";

export const REGION_COLORS: Record<ConnectionGroup, number> = {
  torso: 0xcfd6e4,
  head: 0xffd166,
  leftArm: 0x4cc9f0,
  leftLeg: 0x4361ee,
  rightArm: 0xf77f00,
  rightLeg: 0xd62828,
};

export function toCss(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}
