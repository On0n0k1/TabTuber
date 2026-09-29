/*
 * One-euro filter checks, run with `npm run check:filter`.
 *
 * Verifies the properties the pipeline actually relies on: a bypassed filter
 * passes data through untouched, a steady signal is not dragged off target,
 * noise is attenuated, and depth is smoothed harder than the lateral axes
 * (SPEC.md section 6).
 *
 * Never imported by the app.
 */

import { LandmarkFilter } from "./oneEuro.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const DT = 1000 / 30;

function run(
  filter: LandmarkFilter,
  samples: readonly [number, number, number][],
): [number, number, number][] {
  const input = new Float32Array(3);
  const out = new Float32Array(3);
  const history: [number, number, number][] = [];
  let t = 0;
  for (const s of samples) {
    input[0] = s[0]; input[1] = s[1]; input[2] = s[2];
    filter.apply(out, input, t);
    history.push([out[0] ?? 0, out[1] ?? 0, out[2] ?? 0]);
    t += DT;
  }
  return history;
}

// --- disabled is an exact passthrough --------------------------------------
{
  const f = new LandmarkFilter(1);
  f.enabled = false;
  const noisy: [number, number, number][] = Array.from({ length: 20 }, (_, i) => [
    Math.sin(i), Math.cos(i), i * 0.1,
  ]);
  const out = run(f, noisy);
  const exact = out.every((v, i) => v.every((c, j) => Math.abs(c - (noisy[i] as number[])[j]!) < 1e-6));
  check("disabled filter is an exact passthrough", exact);
}

// --- a steady signal is not dragged off target -----------------------------
{
  const f = new LandmarkFilter(1);
  const steady: [number, number, number][] = Array.from({ length: 60 }, () => [0.5, -0.2, 0.3]);
  const out = run(f, steady);
  const last = out[out.length - 1]!;
  check("steady signal converges to its value",
    Math.abs(last[0] - 0.5) < 1e-4 && Math.abs(last[1] + 0.2) < 1e-4 && Math.abs(last[2] - 0.3) < 1e-4,
    JSON.stringify(last.map((n) => +n.toFixed(5))));
}

// --- noise is attenuated, and z harder than xy -----------------------------
{
  const f = new LandmarkFilter(1);
  // Deterministic pseudo-noise around zero, identical on all three axes.
  const noise = (i: number): number => Math.sin(i * 12.9898) * 0.5;
  const samples: [number, number, number][] = Array.from({ length: 300 }, (_, i) => {
    const n = noise(i);
    return [n, n, n];
  });
  const out = run(f, samples);

  const tail = out.slice(100);
  const rms = (pick: (v: [number, number, number]) => number): number =>
    Math.sqrt(tail.reduce((a, v) => a + pick(v) ** 2, 0) / tail.length);

  const inputRms = Math.sqrt(
    samples.slice(100).reduce((a, v) => a + v[0] ** 2, 0) / (samples.length - 100),
  );
  const xRms = rms((v) => v[0]);
  const zRms = rms((v) => v[2]);

  check("noise is attenuated on x", xRms < inputRms * 0.6, `in=${inputRms.toFixed(4)} out=${xRms.toFixed(4)}`);
  check("depth is smoothed harder than lateral", zRms < xRms, `x=${xRms.toFixed(4)} z=${zRms.toFixed(4)}`);
}

// --- a non-advancing timestamp must not produce NaN ------------------------
{
  const f = new LandmarkFilter(1);
  const input = new Float32Array([0.1, 0.2, 0.3]);
  const out = new Float32Array(3);
  f.apply(out, input, 0);
  f.apply(out, input, 0);
  f.apply(out, input, 0);
  check("repeated timestamps stay finite", [...out].every(Number.isFinite), JSON.stringify([...out]));
}

// --- reset clears state ----------------------------------------------------
{
  const f = new LandmarkFilter(1);
  run(f, Array.from({ length: 40 }, () => [1, 1, 1] as [number, number, number]));
  f.reset();
  const out = run(f, [[0, 0, 0]]);
  check("reset makes the next sample authoritative",
    out[0]!.every((c) => Math.abs(c) < 1e-6), JSON.stringify(out[0]));
}

if (failures > 0) throw new Error(`${failures} filter check failure(s)`);
console.log("\nALL PASS");
