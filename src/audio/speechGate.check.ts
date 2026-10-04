/*
 * Checks for the speech gate, run with `npm run check:gate`.
 *
 * The gate exists to stop typing moving the mouth, so a simulated keystroke
 * must not open it and simulated speech must. Both are modelled by duration
 * alone, which is the only property the gate looks at.
 *
 * Never imported by the app.
 */

import { SpeechGate } from "./speechGate.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const FRAME = 1 / 60;

/** Runs a burst of `loudMs` at `level`, then `quietMs` of silence. */
function burst(gate: SpeechGate, level: number, loudMs: number, quietMs: number): number {
  let maxOut = 0;
  for (let t = 0; t < loudMs; t += FRAME * 1000) {
    maxOut = Math.max(maxOut, gate.update(level, FRAME));
  }
  for (let t = 0; t < quietMs; t += FRAME * 1000) {
    gate.update(0, FRAME);
  }
  return maxOut;
}

// --- a keystroke must not open the gate -----------------------------------
{
  const g = new SpeechGate();
  // Keystrokes run 10 to 30ms. Several in a row, as when typing.
  let opened = false;
  for (let i = 0; i < 20; i++) {
    if (burst(g, 0.8, 25, 60) > 0) opened = true;
  }
  check("typing never opens the gate", !opened);
}

// --- a syllable must open it ----------------------------------------------
{
  const g = new SpeechGate();
  const out = burst(g, 0.8, 180, 0);
  check("a syllable opens the gate", out > 0, `peak ${out.toFixed(2)}`);
}

// --- word gaps must not snap the mouth shut -------------------------------
{
  const g = new SpeechGate();
  burst(g, 0.8, 200, 0);
  // A brief pause between words, shorter than the hangover.
  for (let t = 0; t < 100; t += FRAME * 1000) g.update(0, FRAME);
  check("a short gap between words keeps the gate open", g.speaking);
}

// --- but stopping properly must close it ----------------------------------
{
  const g = new SpeechGate();
  burst(g, 0.8, 200, 0);
  for (let t = 0; t < 400; t += FRAME * 1000) g.update(0, FRAME);
  check("stopping closes the gate", !g.speaking);
}

// --- the gate passes energy through unchanged while open ------------------
{
  const g = new SpeechGate();
  burst(g, 0.8, 200, 0);
  const out = g.update(0.42, FRAME);
  check("energy passes through unaltered while open", Math.abs(out - 0.42) < 1e-9,
    `${out.toFixed(3)}`);
}

// --- a longer onset rejects longer transients -----------------------------
{
  const g = new SpeechGate();
  g.params.onset = 0.15;
  const out = burst(g, 0.8, 100, 0);
  check("raising onset rejects longer bursts", out === 0);
}

// --- onset 0 disables the gate --------------------------------------------
//
// The escape hatch for someone whose microphone already handles noise, where
// any gating is latency bought for nothing.
{
  const g = new SpeechGate();
  g.params.onset = 0;
  const out = g.update(0.5, FRAME);
  check("onset 0 opens immediately", out === 0.5 && g.speaking, `${out}`);
}

// --- reset clears state ---------------------------------------------------
{
  const g = new SpeechGate();
  burst(g, 0.8, 200, 0);
  g.reset();
  check("reset closes the gate", !g.speaking);
}

if (failures > 0) throw new Error(`${failures} speech gate check failure(s)`);
console.log("\nALL PASS");
