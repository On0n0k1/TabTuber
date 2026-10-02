/*
 * Idle motion: breathing and drift (SPEC.md section 8).
 *
 * An ADDITIVE layer composed onto the final pose, not a fallback target. The
 * spine chain is ungated -- hips and shoulders are the last things to leave
 * frame -- so it is always fully tracked and would never reach a fallback.
 * Breathing has to ride on top of tracking, which is also what bodies do:
 * people breathe while they gesture.
 *
 * A frozen avatar reads to an audience as "the software broke"; a breathing
 * one reads as "they stepped away", and that distinction is worth its cost.
 *
 * Drift uses pairs of sine waves at incommensurate frequencies rather than
 * one. A single sine is recognisably periodic within a few seconds, which
 * reads as mechanical -- the whole point is to not look mechanical.
 */

import { BONE_COUNT, BONE_INDEX, type HumanBoneName } from "../types.ts";
import { multiply, quat, setAxisAngle, type Q4 } from "./math.ts";

const DEG = Math.PI / 180;

export interface IdleParams {
  /** Overall scale, 0 disables all motion and leaves the relaxed pose. */
  amount: number;
  /** Breaths per second. Resting adult is roughly 0.2 to 0.3. */
  breathRate: number;
  /** Peak chest rotation from breathing, degrees. */
  breathDepth: number;
  /** Peak head drift, degrees. */
  driftDepth: number;
}

export const DEFAULT_IDLE_PARAMS: IdleParams = {
  amount: 1,
  breathRate: 0.24,
  breathDepth: 1.6,
  driftDepth: 2.2,
};

/** Bones that breathe, and their share of the motion. */
const BREATH_CHAIN: ReadonlyArray<[HumanBoneName, number]> = [
  ["spine", 0.25],
  ["chest", 0.35],
  ["upperChest", 0.4],
];

const scratch = quat();
const base = quat();

/**
 * Fills `out` (BONE_COUNT * 4) with per-bone idle DELTAS at time `elapsed`.
 *
 * Bones with no idle motion get identity, so composing the whole buffer is
 * safe and branch-free at the call site.
 */
export function writeIdleDelta(
  out: Float32Array,
  elapsed: number,
  params: IdleParams,
): void {
  for (let i = 0; i < BONE_COUNT; i++) {
    const o = i * 4;
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = 1;
  }

  const amount = params.amount;
  if (amount <= 0) return;

  // Asymmetric: the chest rises faster than it falls, like real breathing.
  const phase = elapsed * params.breathRate * Math.PI * 2;
  const breath = Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.15;

  for (const [bone, share] of BREATH_CHAIN) {
    const angle = breath * params.breathDepth * share * amount * DEG;
    // About X, which pitches the torso: the chest lifting, not twisting.
    setAxisAngle(scratch, [1, 0, 0], angle);
    composeInto(out, BONE_INDEX[bone], scratch);
  }

  // Two incommensurate periods per axis so the cycle does not visibly repeat.
  const yaw = (Math.sin(elapsed * 0.17) * 0.6 + Math.sin(elapsed * 0.41) * 0.4) *
    params.driftDepth * amount * DEG;
  const pitch = (Math.sin(elapsed * 0.13 + 1.7) * 0.5 + Math.sin(elapsed * 0.29) * 0.3) *
    params.driftDepth * amount * DEG;

  setAxisAngle(scratch, [0, 1, 0], yaw);
  composeInto(out, BONE_INDEX["neck"], scratch);
  setAxisAngle(scratch, [1, 0, 0], pitch);
  composeInto(out, BONE_INDEX["head"], scratch);
}

/** out[index] = out[index] * delta, in place. */
function composeInto(out: Float32Array, index: number, delta: Readonly<Q4>): void {
  const o = index * 4;
  base[0] = out[o] ?? 0;
  base[1] = out[o + 1] ?? 0;
  base[2] = out[o + 2] ?? 0;
  base[3] = out[o + 3] ?? 1;

  multiply(base, base, delta);
  out[o] = base[0];
  out[o + 1] = base[1];
  out[o + 2] = base[2];
  out[o + 3] = base[3];
}
