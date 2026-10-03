/*
 * Checks for the lookahead buffer, run with `npm run check:buffer`.
 *
 * Two properties matter and they pull against each other: a lone bad frame
 * must never reach the output, and genuine fast motion must pass through
 * undistorted. An estimator that achieves the first by averaging would fail
 * the second, which is why this is a medoid.
 *
 * Never imported by the app.
 */

import { BONE_INDEX, createAvatarPose, type AvatarPose } from "../types.ts";
import { PoseBuffer } from "./poseBuffer.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const BONE = BONE_INDEX["leftHand"];

/** A pose with the left hand rolled by `degrees` about X. */
function poseAt(degrees: number, timestampMs: number): AvatarPose {
  const p = createAvatarPose();
  const half = (degrees * Math.PI) / 360;
  const o = BONE * 4;
  p.rotations[o] = Math.sin(half);
  p.rotations[o + 3] = Math.cos(half);
  p.timestampMs = timestampMs;
  return p;
}

function readDegrees(p: AvatarPose): number {
  const o = BONE * 4;
  return (2 * Math.atan2(p.rotations[o] ?? 0, p.rotations[o + 3] ?? 1) * 180) / Math.PI;
}

// --- a lone outlier must never reach the output ---------------------------
{
  const buf = new PoseBuffer();
  buf.lookahead = 1;
  const seen: number[] = [];
  // Steady at 10 degrees, with one frame flipping 180 away.
  const inputs = [10, 10, 10, 190, 10, 10, 10];
  for (let i = 0; i < inputs.length; i++) {
    buf.push(poseAt(inputs[i] as number, i * 33.3));
    seen.push(readDegrees(buf.output));
  }
  const settled = seen.slice(2);
  check("a single-frame 180 degree flip never reaches the output",
    settled.every((d) => Math.abs(d - 10) < 1), settled.map((d) => d.toFixed(1)).join(" "));
}

// --- genuine fast motion must pass through, with no phase error -----------
{
  const buf = new PoseBuffer();
  buf.lookahead = 1;
  const out: number[] = [];
  for (let i = 0; i < 12; i++) {
    buf.push(poseAt(i * 15, i * 33.3));
    out.push(readDegrees(buf.output));
  }
  // Window of three on a ramp has the middle sample as its medoid, so the
  // output is the true value one frame back: delayed, never distorted.
  const settled = out.slice(3);
  const expected = settled.map((_, k) => (k + 2) * 15);
  check("a fast ramp passes through undistorted",
    settled.every((d, k) => Math.abs(d - (expected[k] as number)) < 0.01),
    settled.map((d) => d.toFixed(0)).join(" "));
}

// --- two bad frames out of three is not an outlier any more ---------------
{
  const buf = new PoseBuffer();
  buf.lookahead = 1;
  for (let i = 0; i < 3; i++) buf.push(poseAt(10, i * 33.3));
  buf.push(poseAt(190, 3 * 33.3));
  buf.push(poseAt(190, 4 * 33.3));
  // Honest limit: a majority in the window wins, by design. Two frames of
  // lookahead would be needed to outvote two bad frames.
  check("a sustained change is accepted rather than suppressed",
    Math.abs(readDegrees(buf.output) - 190) < 1, readDegrees(buf.output).toFixed(1));
}

// --- lookahead 0 is an exact passthrough ----------------------------------
{
  const buf = new PoseBuffer();
  buf.lookahead = 0;
  const values = [0, 90, 190, 30];
  const out = values.map((v, i) => {
    buf.push(poseAt(v, i * 33.3));
    return readDegrees(buf.output);
  });
  check("lookahead 0 passes everything through unchanged",
    out.every((d, i) => Math.abs(d - (values[i] as number)) < 0.01),
    out.map((d) => d.toFixed(0)).join(" "));
}

// --- the latency readout must reflect the real frame rate -----------------
{
  const buf = new PoseBuffer();
  buf.lookahead = 2;
  for (let i = 0; i < 80; i++) buf.push(poseAt(0, i * 20)); // 50 fps
  check("latency tracks the measured frame interval",
    Math.abs(buf.latencyMs - 40) < 4, `${buf.latencyMs.toFixed(1)} ms`);
}

// --- output stays valid while the window fills ----------------------------
{
  const buf = new PoseBuffer();
  buf.lookahead = 3;
  const ready = buf.push(poseAt(45, 0));
  check("output is usable before the window fills", !ready && Math.abs(readDegrees(buf.output) - 45) < 0.01);
}

// --- holding still must actually be smoothed ------------------------------
//
// The check this file was missing. An earlier version selected a single real
// sample instead of averaging, which carried that sample's full noise and so
// smoothed nothing at all when the subject held still -- and got worse with a
// larger window, because consecutive outputs could come from samples far
// apart in the noise sequence. Every other check here passed throughout.
{
  const rand = (() => {
    let x = 4242 >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 4294967296 - 0.5;
    };
  })();

  /** RMS frame-to-frame change, which is what reads as jitter. */
  const jitterOf = (lookahead: number): { input: number; output: number } => {
    const buf = new PoseBuffer();
    buf.lookahead = lookahead;
    const ins: number[] = [];
    const outs: number[] = [];
    for (let i = 0; i < 300; i++) {
      const d = rand() * 3;
      ins.push(d);
      buf.push(poseAt(d, i * 33.3));
      outs.push(readDegrees(buf.output));
    }
    const rms = (a: number[]): number => {
      let acc = 0;
      for (let i = 11; i < a.length; i++) acc += ((a[i] as number) - (a[i - 1] as number)) ** 2;
      return Math.sqrt(acc / (a.length - 11));
    };
    return { input: rms(ins), output: rms(outs) };
  };

  const one = jitterOf(1);
  check("holding still is measurably smoothed", one.output < one.input / 2,
    `${one.input.toFixed(2)} -> ${one.output.toFixed(2)} deg`);

  const three = jitterOf(3);
  check("more lookahead smooths more, not less", three.output < one.output,
    `lookahead 1 ${one.output.toFixed(2)}, lookahead 3 ${three.output.toFixed(2)} deg`);
}

// --- repeated spikes must stay rejected, not just one ---------------------
{
  const buf = new PoseBuffer();
  buf.lookahead = 1;
  let worst = 0;
  let previous = 0;
  for (let i = 0; i < 200; i++) {
    const d = i % 20 === 10 ? 180 : 0;
    buf.push(poseAt(d, i * 33.3));
    const got = readDegrees(buf.output);
    if (i > 5) worst = Math.max(worst, Math.abs(got - previous));
    previous = got;
  }
  check("a recurring spike is rejected every time", worst < 1, `worst step ${worst.toFixed(2)} deg`);
}

if (failures > 0) throw new Error(`${failures} buffer check failure(s)`);
console.log("\nALL PASS");
