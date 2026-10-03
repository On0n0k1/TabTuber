/*
 * Checks for the palm conditioning measure, run with `npm run check:cond`.
 *
 * The property that matters most is scale invariance. The whole reason this
 * is a ratio rather than a spread in pixels is so a threshold picked once
 * means the same thing for any hand size at any camera distance (SPEC.md
 * 12.1). If that fails, the measure is overfitted to whoever it was tested
 * against, which is the failure it exists to avoid.
 *
 * Never imported by the app.
 */

import { HAND, PALM_RIM } from "../tracker/handLandmarks.ts";
import { HAND_LANDMARK_COUNT } from "../types.ts";
import { palmConditioning } from "./palmConditioning.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

/**
 * Palm projected to image space. `width` is how much of the palm's width
 * survives projection: 1 is face-on, 0 is fully edge-on.
 */
function palm(cx: number, cy: number, size: number, width: number): Float32Array {
  const img = new Float32Array(HAND_LANDMARK_COUNT * 2);
  const set = (i: number, x: number, y: number): void => {
    img[i * 2] = cx + x * size;
    img[i * 2 + 1] = cy + y * size;
  };
  // Length runs down the image, width across it.
  set(HAND.WRIST, 0, 0);
  set(HAND.INDEX_MCP, 0.30 * width, 0.94);
  set(HAND.MIDDLE_MCP, 0.10 * width, 1.00);
  set(HAND.RING_MCP, -0.10 * width, 0.94);
  set(HAND.PINKY_MCP, -0.30 * width, 0.85);
  return img;
}

const faceOn = palmConditioning(palm(0.5, 0.4, 0.1, 1), 1);
const edgeOn = palmConditioning(palm(0.5, 0.4, 0.1, 0.05), 1);

check("face-on palm reads well conditioned", faceOn > 0.25, faceOn.toFixed(3));
check("edge-on palm reads ill conditioned", edgeOn < 0.08, edgeOn.toFixed(3));
check("edge-on is markedly worse than face-on", faceOn / edgeOn > 4,
  `${faceOn.toFixed(3)} vs ${edgeOn.toFixed(3)}`);

// Scale invariance: the point of the whole design. Tolerance is relative,
// because the covariance entries go as the square of the size and a hand
// occupying 1% of the frame -- about six pixels, far below anything the
// tracker could resolve -- accumulates float error near the guard threshold.
for (const [label, size] of [["half", 0.05], ["double", 0.2], ["tiny", 0.01]] as [string, number][]) {
  const scaled = palmConditioning(palm(0.5, 0.4, size, 1), 1);
  check(`${label}-size hand gives the same ratio`,
    Math.abs(scaled - faceOn) / faceOn < 1e-5,
    `${scaled.toFixed(8)} vs ${faceOn.toFixed(8)}`);
}

// Position invariance: where in frame the hand sits must not matter.
const corner = palmConditioning(palm(0.1, 0.9, 0.1, 1), 1);
check("position in frame does not change the ratio", Math.abs(corner - faceOn) < 1e-6,
  `${corner.toFixed(5)} vs ${faceOn.toFixed(5)}`);

// Rotation invariance: holding the hand sideways is not worse conditioned.
{
  const rotated = new Float32Array(HAND_LANDMARK_COUNT * 2);
  const src = palm(0.5, 0.4, 0.1, 1);
  for (const i of PALM_RIM) {
    const x = (src[i * 2] ?? 0) - 0.5;
    const y = (src[i * 2 + 1] ?? 0) - 0.4;
    rotated[i * 2] = 0.5 + y;      // 90 degree turn
    rotated[i * 2 + 1] = 0.4 - x;
  }
  const r = palmConditioning(rotated, 1);
  check("rotating the hand in frame does not change the ratio",
    Math.abs(r - faceOn) < 1e-6, `${r.toFixed(5)} vs ${faceOn.toFixed(5)}`);
}

// Aspect correction: without it, a non-square frame biases by orientation.
{
  const wide = palmConditioning(palm(0.5, 0.4, 0.1, 1), 16 / 9);
  check("aspect is applied rather than ignored", Math.abs(wide - faceOn) > 1e-6,
    `${wide.toFixed(5)} vs ${faceOn.toFixed(5)}`);
}

// Degenerate input must read as well conditioned, so it applies no extra
// smoothing rather than guessing.
check("all-zero input fails safe", palmConditioning(new Float32Array(HAND_LANDMARK_COUNT * 2), 1) === 1);

if (failures > 0) throw new Error(`${failures} conditioning check failure(s)`);
console.log("\nALL PASS");
