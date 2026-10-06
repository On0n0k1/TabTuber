/*
 * Checks for the mouth driver, run with `npm run check:mouth`.
 *
 * The microphone side needs a browser, so it is not covered here. The mouth
 * itself is pure and is where the behaviour a viewer notices lives.
 *
 * The property that matters most is that silence closes the mouth. A mouth
 * still moving after someone stops talking is the single most obvious failure
 * in lip sync, more so than any wrong shape.
 *
 * Never imported by the app.
 */

import { Mouth, VISEMES } from "./mouth.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const out = new Map<string, number>();
const total = (): number => VISEMES.reduce((a, v) => a + (out.get(v) ?? 0), 0);

// --- silence must close the mouth, in both modes --------------------------
for (const mode of ["amplitude", "animated"] as const) {
  const m = new Mouth();
  m.params.mode = mode;
  // Talk for a while, then stop.
  for (let i = 0; i < 60; i++) m.update(0.8, 1 / 60, out);
  const speaking = total();
  for (let i = 0; i < 30; i++) m.update(0, 1 / 60, out);
  check(`${mode}: silence closes the mouth completely`, total() === 0,
    `was ${speaking.toFixed(2)} while speaking`);
}

// --- amplitude mode drives only aa, in proportion -------------------------
{
  const m = new Mouth();
  m.params.mode = "amplitude";
  m.params.openness = 1;
  m.update(0.5, 1 / 60, out);
  check("amplitude: only aa is driven",
    (out.get("aa") ?? 0) > 0 && VISEMES.filter((v) => v !== "aa").every((v) => (out.get(v) ?? 0) === 0));
  check("amplitude: openness follows energy", Math.abs((out.get("aa") ?? 0) - 0.5) < 1e-6,
    `${(out.get("aa") ?? 0).toFixed(3)}`);
}

// --- animated mode varies shape without exceeding the envelope ------------
{
  const m = new Mouth();
  m.params.mode = "animated";
  m.params.openness = 1;

  const used = new Set<string>();
  let maxTotal = 0;
  for (let i = 0; i < 2000; i++) {
    m.update(0.7, 1 / 60, out);
    maxTotal = Math.max(maxTotal, total());
    for (const v of VISEMES) if ((out.get(v) ?? 0) > 0.05) used.add(v);
  }
  check("animated: more than one viseme is used", used.size >= 3,
    `used ${[...used].join(",")}`);
  // Crossfading two shapes must not add up to a wider mouth than the energy
  // asked for, or loud speech over-opens.
  check("animated: never opens wider than the energy", maxTotal <= 0.7 + 1e-6,
    `peak total ${maxTotal.toFixed(3)}`);
}

// --- openness caps the output --------------------------------------------
{
  const m = new Mouth();
  m.params.mode = "amplitude";
  m.params.openness = 0.4;
  m.update(1, 1 / 60, out);
  check("openness caps how far the mouth opens", Math.abs((out.get("aa") ?? 0) - 0.4) < 1e-6,
    `${(out.get("aa") ?? 0).toFixed(3)}`);
}

// --- a new utterance starts clean -----------------------------------------
{
  const m = new Mouth();
  m.params.mode = "animated";
  for (let i = 0; i < 40; i++) m.update(0.9, 1 / 60, out);
  for (let i = 0; i < 40; i++) m.update(0, 1 / 60, out);
  m.update(0.9, 1 / 60, out);
  // One frame into a new utterance the mouth should be barely open, not
  // resuming mid-shape from whatever was held when speech stopped.
  check("a new utterance does not resume mid-shape", total() <= 0.9 + 1e-6,
    `${total().toFixed(3)}`);
}

/*
 * --- the camera takes the mouth only while nothing is being said ----------
 *
 * The voice owns the mouth whenever there is one. The camera covers the case
 * the microphone cannot see at all: a mouth moving in silence.
 */
{
  const m = new Mouth();
  const out = new Map<string, number>();
  const DT = 1 / 60;

  // Silent, mouth held open on camera.
  for (let i = 0; i < 120; i++) m.update(0, DT, out, null, 0.8);
  const silent = out.get("aa") ?? 0;
  check("a silent open mouth is driven by the camera", silent > 0.5,
    `${silent.toFixed(2)}`);

  // Speaking: the voice takes it immediately, on the very next frame.
  m.update(1, DT, out, null, 0);
  const firstVoiced = out.get("aa") ?? 0;
  check("the voice takes the mouth on the first frame of speech", firstVoiced > 0.5,
    `${firstVoiced.toFixed(2)}`);

  /*
   * And a camera that disagrees mid-sentence cannot reopen it. A shut mouth
   * on camera while the voice is loud is the tracker being wrong, not the
   * performer closing their mouth.
   */
  for (let i = 0; i < 30; i++) m.update(1, DT, out, null, 0);
  const whileSpeaking = out.get("aa") ?? 0;
  check("the camera cannot close a mouth that is speaking", whileSpeaking > 0.5,
    `${whileSpeaking.toFixed(2)}`);

  /*
   * Handing back is slow. A gate that drops for a moment inside a sentence
   * must not flick the mouth to the camera and back.
   */
  m.update(0, DT, out, null, 0.8);
  const justAfter = out.get("aa") ?? 0;
  check("the mouth does not jump back to the camera", justAfter < 0.1,
    `${justAfter.toFixed(2)} one frame after the voice stopped`);

  for (let i = 0; i < 60; i++) m.update(0, DT, out, null, 0.8);
  const settled = out.get("aa") ?? 0;
  check("but it does hand back eventually", settled > 0.5, `${settled.toFixed(2)}`);
}

// --- no camera mouth means nothing changes --------------------------------
{
  const withCamera = new Mouth();
  const without = new Mouth();
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  const DT = 1 / 60;

  // null is "there is no camera mouth"; 0 is "the camera says shut". Only
  // the second may hold the mouth closed, and neither may change speech.
  for (let i = 0; i < 60; i++) {
    withCamera.update(0.8, DT, a, null, null);
    without.update(0.8, DT, b, null);
  }
  check("passing no camera jaw leaves the voice untouched",
    Math.abs((a.get("aa") ?? 0) - (b.get("aa") ?? 0)) < 1e-9,
    `${(a.get("aa") ?? 0).toFixed(3)} vs ${(b.get("aa") ?? 0).toFixed(3)}`);
}

if (failures > 0) throw new Error(`${failures} mouth check failure(s)`);
console.log("\nALL PASS");
