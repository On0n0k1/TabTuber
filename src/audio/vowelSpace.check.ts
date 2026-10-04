/*
 * Checks for calibrated vowel blending, run with `npm run check:vowel`.
 *
 * The properties worth asserting are geometric: a corner must resolve to its
 * own vowel, weights must always be usable as expression values, and the
 * whole thing must be scale-free so one speaker's calibration means the same
 * as another's (SPEC.md 8.1, 12.1).
 *
 * Never imported by the app.
 */

import { VISEMES } from "./mouth.ts";
import {
  bandCentroid,
  blendVisemes,
  referencePoints,
  type VowelCalibration,
} from "./vowelSpace.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

/** A typical adult-male triangle, in Hz. */
const MALE: VowelCalibration = {
  aa: { f1: 730, f2: 1090 },
  ee: { f1: 270, f2: 2290 },
  ou: { f1: 300, f2: 870 },
};

/** A higher-pitched speaker: every formant roughly 20% up. */
const HIGHER: VowelCalibration = {
  aa: { f1: 876, f2: 1308 },
  ee: { f1: 324, f2: 2748 },
  ou: { f1: 360, f2: 1044 },
};

const out = new Map<string, number>();
const total = (): number => VISEMES.reduce((a, v) => a + (out.get(v) ?? 0), 0);
const top = (): string =>
  VISEMES.reduce((best, v) => ((out.get(v) ?? 0) > (out.get(best) ?? 0) ? v : best), "aa");

// --- each recorded corner must resolve to its own vowel -------------------
{
  const refs = referencePoints(MALE);
  for (const vowel of ["aa", "ee", "ou"] as const) {
    blendVisemes(MALE[vowel], refs, out);
    check(`${vowel} resolves to itself`, top() === vowel, `got ${top()}`);
  }
}

// --- the derived vowels must resolve to themselves too --------------------
{
  const refs = referencePoints(MALE);
  for (const vowel of ["ih", "oh"] as const) {
    blendVisemes(refs[vowel], refs, out);
    check(`${vowel} resolves to itself although never recorded`,
      top() === vowel, `got ${top()}`);
  }
}

// --- weights must always be usable as expression values -------------------
{
  const refs = referencePoints(MALE);
  let worstSum = 0;
  let sawNegative = false;
  for (let f1 = 100; f1 <= 1200; f1 += 50) {
    for (let f2 = 500; f2 <= 3400; f2 += 100) {
      blendVisemes({ f1, f2 }, refs, out);
      worstSum = Math.max(worstSum, Math.abs(total() - 1));
      for (const v of VISEMES) if ((out.get(v) ?? 0) < 0) sawNegative = true;
    }
  }
  check("weights always sum to 1", worstSum < 1e-9, `worst drift ${worstSum.toExponential(1)}`);
  check("weights are never negative", !sawNegative);
}

// --- the result must be scale-free across speakers ------------------------
//
// The whole point of calibrating: a higher-pitched speaker at their own `aa`
// must get the same answer as a lower-pitched one at theirs.
{
  const maleRefs = referencePoints(MALE);
  const higherRefs = referencePoints(HIGHER);
  let worst = 0;
  for (const vowel of VISEMES) {
    blendVisemes(maleRefs[vowel], maleRefs, out);
    const a = new Map(out);
    blendVisemes(higherRefs[vowel], higherRefs, out);
    for (const v of VISEMES) {
      worst = Math.max(worst, Math.abs((a.get(v) ?? 0) - (out.get(v) ?? 0)));
    }
  }
  check("two speakers get the same blend at the same vowel", worst < 0.05,
    `worst difference ${worst.toFixed(3)}`);
}

// --- a point outside the triangle must not break ---------------------------
{
  const refs = referencePoints(MALE);
  blendVisemes({ f1: 2000, f2: 100 }, refs, out);
  check("a point far outside the triangle still produces usable weights",
    Math.abs(total() - 1) < 1e-9 && VISEMES.every((v) => (out.get(v) ?? -1) >= 0));
}

// --- the centroid must track where the energy is ---------------------------
{
  const SR = 48000;
  const FFT = 2048;
  const bins = FFT / 2;
  const binHz = SR / FFT;

  /** A spectrum with a single loud peak at `hz`, silence elsewhere. */
  const peakAt = (hz: number): Float32Array => {
    const s = new Float32Array(bins).fill(-140);
    s[Math.round(hz / binHz)] = -10;
    return s;
  };

  for (const hz of [300, 600, 900]) {
    const got = bandCentroid(peakAt(hz), SR, FFT, 200, 1100);
    check(`centroid finds a peak at ${hz}Hz`, Math.abs(got - hz) < binHz,
      `got ${got.toFixed(0)}Hz`);
  }

  // Silence must not produce NaN; the band midpoint is the honest answer.
  const silent = bandCentroid(new Float32Array(bins).fill(-140), SR, FFT, 200, 1100);
  check("silence yields the band midpoint rather than NaN",
    Number.isFinite(silent) && Math.abs(silent - 650) < 1, `${silent.toFixed(0)}`);
}

if (failures > 0) throw new Error(`${failures} vowel check failure(s)`);
console.log("\nALL PASS");
