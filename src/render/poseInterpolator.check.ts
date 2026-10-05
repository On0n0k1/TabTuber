/*
 * Checks for render-rate interpolation, run with `npm run check:interp`.
 *
 * Written after `timestampMs` turned out not to be interpolated at all. It
 * was copied in setTarget and in snap(), and snap() only runs when
 * interpolation is OFF, so under the default settings it stayed at zero for
 * the life of the page -- which left the latency readout with nothing to
 * measure and had the mouth driven by mic energy half a second stale.
 *
 * Nothing failed loudly. The pose looked right, because the rotations were
 * being interpolated correctly; it was the field nobody watched that stopped
 * moving. So these assert that every field of the pose advances, not just the
 * ones that are visible.
 *
 * Never imported by the app.
 */

import { PoseInterpolator } from "./poseInterpolator.ts";
import { createAvatarPose } from "../types.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const DT = 1 / 60;

/** A pose carrying a recognisable value in every field that should advance. */
function poseAt(timestampMs: number, confidence: number) {
  const p = createAvatarPose();
  p.timestampMs = timestampMs;
  p.confidence = confidence;
  p.rootOffset[0] = 0.1;
  p.expressions.set("happy", 0.5);
  return p;
}

// --- the timestamp advances at all ----------------------------------------
{
  const i = new PoseInterpolator();
  i.setTarget(poseAt(1000, 1));
  for (let n = 0; n < 60; n++) i.step(DT);
  check("the timestamp reaches the target", Math.abs(i.current.timestampMs - 1000) < 1,
    `${i.current.timestampMs.toFixed(1)}`);
}

// --- the first pose is taken whole ----------------------------------------
{
  // Easing up from zero would report the page's whole uptime as latency.
  const i = new PoseInterpolator();
  i.setTarget(poseAt(5_000_000, 1));
  i.step(DT);
  check("the first timestamp is taken rather than eased into",
    i.current.timestampMs === 5_000_000, `${i.current.timestampMs}`);
}

// --- afterwards it eases, like the pose it describes -----------------------
{
  const i = new PoseInterpolator();
  i.setTarget(poseAt(1000, 1));
  i.step(DT);
  i.setTarget(poseAt(2000, 1));
  i.step(DT);
  check("later timestamps ease rather than jumping",
    i.current.timestampMs > 1000 && i.current.timestampMs < 2000,
    `${i.current.timestampMs.toFixed(1)}`);
}

/*
 * The lag is the point, not a defect: the rendered pose trails the target by
 * the easing, so its timestamp has to trail by the same amount. Reporting the
 * target's timestamp would claim the pose on screen is newer than it is.
 */
{
  const i = new PoseInterpolator();
  i.setTarget(poseAt(1000, 1));
  i.step(DT);
  i.setTarget(poseAt(1100, 1));
  i.step(DT);
  check("the rendered timestamp trails the target", i.current.timestampMs < 1100,
    `${i.current.timestampMs.toFixed(1)} vs 1100`);
}

// --- disabled means the pose is taken whole, timestamp included -----------
{
  const i = new PoseInterpolator();
  i.enabled = false;
  i.setTarget(poseAt(1234, 0.75));
  check("disabled snaps the timestamp", i.current.timestampMs === 1234,
    `${i.current.timestampMs}`);
  check("disabled snaps confidence", i.current.confidence === 0.75);
}

// --- every other field still advances -------------------------------------
{
  const i = new PoseInterpolator();
  i.setTarget(poseAt(1000, 1));
  for (let n = 0; n < 60; n++) i.step(DT);
  check("confidence reaches the target", Math.abs(i.current.confidence - 1) < 0.01,
    `${i.current.confidence.toFixed(3)}`);
  check("root offset reaches the target",
    Math.abs((i.current.rootOffset[0] ?? 0) - 0.1) < 0.001,
    `${(i.current.rootOffset[0] ?? 0).toFixed(4)}`);
  check("expressions are carried", i.current.expressions.get("happy") === 0.5,
    `${i.current.expressions.get("happy")}`);
}

if (failures > 0) throw new Error(`${failures} interpolator check failure(s)`);
console.log("\nALL PASS");
