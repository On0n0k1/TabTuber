/*
 * Calibrated vowel blending (SPEC.md 8.1).
 *
 * `aa ih ou ee oh` are the five Japanese vowels, and they are mouth
 * POSITIONS rather than arbitrary shapes. Vowels are distinguished by two
 * spectral resonances that map onto those positions directly: the first
 * tracks how open the mouth is, the second tracks tongue front or back. The
 * shapes look as they do because the position causes the resonances.
 *
 * WHY NOT CLASSIFY. Deciding "which vowel is this" fails three ways. Female
 * and child formants run 15 to 25 percent higher than male, so fixed targets
 * misclassify much of any audience. Consonants have no clear formants and are
 * roughly half of speech. And a wrong viseme reads as broken where a generic
 * open mouth never does.
 *
 * WHY CALIBRATION FIXES IT. Nothing absolute is ever compared. The speaker
 * holds `aa`, `ee` and `ou` -- the corners of the vowel triangle, inside which
 * every other vowel sits -- and those three measurements define the space.
 * `ih` and `oh` come free as interpolations between corners and are never
 * recorded. It is the speaker's own triangle, which is the dimensionless rule
 * of SPEC.md 12.1 reached from the other direction.
 *
 * Blending is by inverse distance to all five points rather than barycentric
 * weights over the three corners. Both place a point in the same space, but
 * inverse distance yields all five weights directly, needs no clamping when
 * the point falls outside the triangle, and degrades gracefully: a noisy
 * reading drifts the mouth rather than snapping it to a wrong shape.
 */

import { VISEMES, type Viseme } from "./mouth.ts";

/** A point in vowel space: the two band centroids, in Hz. */
export interface VowelPoint {
  f1: number;
  f2: number;
}

/** The three corners a speaker actually records. */
export interface VowelCalibration {
  aa: VowelPoint;
  ee: VowelPoint;
  ou: VowelPoint;
}

/**
 * Bands the centroids are taken over.
 *
 * Wide enough to contain the formant across any speaker, narrow enough that
 * the centroid tracks it rather than the whole spectrum. A centroid is used
 * instead of peak-picking because it is continuous and far less sensitive to
 * noise than finding a maximum.
 */
export const F1_BAND = { lo: 200, hi: 1100 } as const;
export const F2_BAND = { lo: 1100, hi: 3200 } as const;

/**
 * Energy-weighted mean frequency over a band.
 *
 * `spectrum` is decibel magnitudes as getFloatFrequencyData returns them, so
 * values are negative and must be converted back to linear before weighting --
 * averaging decibels directly would weight quiet bins far too heavily.
 */
export function bandCentroid(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  lo: number,
  hi: number,
): number {
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.floor(lo / binHz));
  const last = Math.min(spectrum.length - 1, Math.ceil(hi / binHz));

  let weighted = 0;
  let total = 0;
  for (let i = first; i <= last; i++) {
    // -100 dB is the practical floor; anything below is silence, and
    // including it would drag the centroid toward the band's midpoint.
    const db = spectrum[i] ?? -140;
    if (db < -100) continue;
    const linear = Math.pow(10, db / 20);
    weighted += linear * i * binHz;
    total += linear;
  }
  return total > 0 ? weighted / total : (lo + hi) / 2;
}

/**
 * The five reference points, derived from the three recorded corners.
 *
 * `ih` sits between `aa` and `ee`, `oh` between `aa` and `ou`, which is where
 * they fall in the vowel triangle. Biased toward the closed corners because
 * both are closer to `ee`/`ou` than to `aa` in formant space.
 */
export function referencePoints(cal: VowelCalibration): Record<Viseme, VowelPoint> {
  const mix = (a: VowelPoint, b: VowelPoint, t: number): VowelPoint => ({
    f1: a.f1 + (b.f1 - a.f1) * t,
    f2: a.f2 + (b.f2 - a.f2) * t,
  });
  return {
    aa: cal.aa,
    ee: cal.ee,
    ou: cal.ou,
    ih: mix(cal.aa, cal.ee, 0.6),
    oh: mix(cal.aa, cal.ou, 0.55),
  };
}

/**
 * Viseme weights for a point in vowel space, summing to 1.
 *
 * Distances are normalised by the triangle's own size, so `sharpness` means
 * the same thing for any speaker regardless of how wide their vowel space is.
 */
export function blendVisemes(
  point: VowelPoint,
  refs: Record<Viseme, VowelPoint>,
  out: Map<string, number>,
  sharpness = 2.5,
): void {
  // Scale from the spread of the recorded corners, so the falloff is relative
  // to this speaker rather than to an absolute number of hertz.
  const scale = Math.max(
    1,
    Math.hypot(refs.aa.f1 - refs.ee.f1, refs.aa.f2 - refs.ee.f2),
  );

  let total = 0;
  const weights: number[] = [];
  for (const v of VISEMES) {
    const r = refs[v];
    const d = Math.hypot(point.f1 - r.f1, point.f2 - r.f2) / scale;
    // Inverse distance, softened so the nearest point does not take
    // everything the moment it is marginally closer.
    const w = 1 / (Math.pow(d, sharpness) + 1e-3);
    weights.push(w);
    total += w;
  }

  VISEMES.forEach((v, i) => {
    out.set(v, (weights[i] as number) / total);
  });
}
