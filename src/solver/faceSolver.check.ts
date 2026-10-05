/*
 * Checks for the blendshape mapping, run with `npm run check:face`.
 *
 * Two things are worth asserting hardest. Mirroring must swap the eyes, since
 * blinking the wrong one is invisible until someone watches a replay. And the
 * emotion layer must stay quiet unless asked, because it is a guess and a
 * confident wrong expression reads worse than none at all.
 *
 * Never imported by the app.
 */

import { BLENDSHAPE_COUNT, BLENDSHAPE_INDEX, type BlendshapeName } from "../tracker/faceBlendshapes.ts";
import { FaceSolver } from "./faceSolver.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

function scores(values: Partial<Record<BlendshapeName, number>>): Float32Array {
  const s = new Float32Array(BLENDSHAPE_COUNT);
  for (const [name, v] of Object.entries(values)) {
    const i = BLENDSHAPE_INDEX[name];
    if (i !== undefined) s[i] = v as number;
  }
  return s;
}

const out = new Map<string, number>();
const DT = 1 / 60;

// --- blink maps per eye, and mirroring swaps them -------------------------
{
  const s = new FaceSolver();
  // Travel disabled: this covers which eye is driven, not how fast the lid
  // moves, and with travel on a single frame is only part way shut.
  s.params.blinkSpeed = 0;
  const winkLeft = scores({ eyeBlinkLeft: 1 });

  s.update(winkLeft, false, DT, out);
  check("unmirrored: the subject's left eye closes the left expression",
    out.get("blinkLeft") === 1 && out.get("blinkRight") === 0);

  s.update(winkLeft, true, DT, out);
  check("mirrored: the same wink closes the other side",
    out.get("blinkRight") === 1 && out.get("blinkLeft") === 0);
}

// --- a partial reading must still close the eyes fully --------------------
//
// MediaPipe's eyeBlink scores rarely reach 1 even with eyes firmly shut, so
// passing them through unchanged leaves the eyelids at half mast. This is the
// reported symptom the remap exists for.
{
  const s = new FaceSolver();
  s.params.blinkSnap = false; // these cover the continuous remap
  s.params.blinkLow = 0.15;
  s.params.blinkHigh = 0.55;

  s.update(scores({ eyeBlinkLeft: 0.55, eyeBlinkRight: 0.55 }), false, DT, out);
  check("a 0.55 reading closes the eyes fully",
    out.get("blinkLeft") === 1 && out.get("blinkRight") === 1,
    `${out.get("blinkLeft")}`);

  // And a resting face must not sit there squinting, which a plain gain would
  // cause by lifting the idle value along with everything else.
  s.update(scores({ eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1 }), false, DT, out);
  check("a resting face keeps its eyes fully open",
    out.get("blinkLeft") === 0 && out.get("blinkRight") === 0,
    `${out.get("blinkLeft")}`);

  s.update(scores({ eyeBlinkLeft: 0.35 }), false, DT, out);
  check("a half closure maps to halfway",
    Math.abs((out.get("blinkLeft") ?? 0) - 0.5) < 0.01, `${out.get("blinkLeft")}`);

  // The raw value stays visible, since the range is set by reading it.
  check("the raw reading is reported unmodified",
    Math.abs(s.rawBlink.left - 0.35) < 1e-6, `${s.rawBlink.left}`);
}

// --- snap mode: noise inside the band must not move the eye ---------------
//
// The reported symptom. A single threshold chatters whenever the reading sits
// near it, which reads as eyelids trembling rather than blinking.
{
  const s = new FaceSolver();
  s.params.blinkSnap = true;
  s.params.blinkLow = 0.15;
  s.params.blinkHigh = 0.55;
  s.params.blinkSpeed = 0; // isolate the decision from the travel

  // Settle open, then jitter around the MIDDLE of the band.
  s.update(scores({ eyeBlinkLeft: 0 }), false, DT, out);
  let moved = false;
  for (let i = 0; i < 200; i++) {
    const noisy = 0.35 + Math.sin(i * 12.9898) * 0.18; // 0.17 .. 0.53
    s.update(scores({ eyeBlinkLeft: noisy }), false, DT, out);
    if ((out.get("blinkLeft") ?? 0) !== 0) moved = true;
  }
  check("noise inside the band never moves the eyelid", !moved);

  // Crossing the ceiling shuts it, and it stays shut through the same noise.
  s.update(scores({ eyeBlinkLeft: 0.7 }), false, DT, out);
  check("crossing the ceiling shuts the eye", out.get("blinkLeft") === 1);

  let reopened = false;
  for (let i = 0; i < 200; i++) {
    const noisy = 0.35 + Math.sin(i * 7.13) * 0.18;
    s.update(scores({ eyeBlinkLeft: noisy }), false, DT, out);
    if ((out.get("blinkLeft") ?? 0) !== 1) reopened = true;
  }
  check("it stays shut through the same noise", !reopened);

  // And only a reading below the floor opens it again.
  s.update(scores({ eyeBlinkLeft: 0.1 }), false, DT, out);
  check("dropping below the floor opens it", out.get("blinkLeft") === 0);
}

// --- the lid travels rather than teleporting ------------------------------
{
  const s = new FaceSolver();
  s.params.blinkSnap = true;
  s.params.blinkSpeed = 0.06;
  s.update(scores({ eyeBlinkLeft: 0 }), false, DT, out);
  s.update(scores({ eyeBlinkLeft: 0.9 }), false, DT, out);
  const afterOne = out.get("blinkLeft") ?? 0;
  check("one frame does not slam the lid shut", afterOne > 0 && afterOne < 1,
    `${afterOne.toFixed(2)}`);

  for (let i = 0; i < 10; i++) s.update(scores({ eyeBlinkLeft: 0.9 }), false, DT, out);
  check("the lid arrives fully shut", out.get("blinkLeft") === 1);
}

// --- the combined blink must not double up --------------------------------
{
  const s = new FaceSolver();
  s.params.blinkSpeed = 0;
  s.update(scores({ eyeBlinkLeft: 1, eyeBlinkRight: 1 }), false, DT, out);
  check("both eyes shut without also driving the combined blink",
    out.get("blinkLeft") === 1 && out.get("blinkRight") === 1 && out.get("blink") === 0);
}

// --- gaze direction and its mirror ----------------------------------------
{
  const s = new FaceSolver();
  s.update(scores({ eyeLookUpLeft: 1, eyeLookUpRight: 1 }), false, DT, out);
  check("looking up gives positive pitch", s.gaze.pitch > 0, `${s.gaze.pitch.toFixed(1)}`);

  s.update(scores({ eyeLookDownLeft: 1, eyeLookDownRight: 1 }), false, DT, out);
  check("looking down gives negative pitch", s.gaze.pitch < 0, `${s.gaze.pitch.toFixed(1)}`);

  const sideways = scores({ eyeLookInLeft: 1, eyeLookInRight: 1 });
  s.update(sideways, false, DT, out);
  const unmirrored = s.gaze.yaw;
  s.update(sideways, true, DT, out);
  check("mirroring reverses yaw", Math.sign(unmirrored) === -Math.sign(s.gaze.yaw),
    `${unmirrored.toFixed(1)} vs ${s.gaze.yaw.toFixed(1)}`);

  // Never beyond the configured range, or the eyes leave their sockets.
  s.params.gazeRange = 15;
  s.update(scores({ eyeLookUpLeft: 1, eyeLookUpRight: 1, eyeLookInLeft: 1, eyeLookInRight: 1 }), false, DT, out);
  check("gaze stays within its range",
    Math.abs(s.gaze.pitch) <= 15.001 && Math.abs(s.gaze.yaw) <= 15.001,
    `yaw ${s.gaze.yaw.toFixed(1)} pitch ${s.gaze.pitch.toFixed(1)}`);
}

// --- emotion stays silent unless asked ------------------------------------
{
  const s = new FaceSolver();
  const beaming = scores({ mouthSmileLeft: 1, mouthSmileRight: 1, eyeSquintLeft: 1, eyeSquintRight: 1 });
  for (let i = 0; i < 120; i++) s.update(beaming, false, DT, out);
  check("emotion is not inferred by default",
    ["happy", "angry", "sad", "relaxed", "surprised"].every((e) => (out.get(e) ?? 0) === 0));
}

// --- but works when enabled, and only one at a time -----------------------
{
  const s = new FaceSolver();
  s.params.inferEmotion = true;
  const beaming = scores({ mouthSmileLeft: 1, mouthSmileRight: 1, eyeSquintLeft: 1, eyeSquintRight: 1 });
  for (let i = 0; i < 120; i++) s.update(beaming, false, DT, out);

  check("a clear smile reads as happy", (out.get("happy") ?? 0) > 0.5,
    `${(out.get("happy") ?? 0).toFixed(2)}`);
  // A face showing two emotions at once reads as broken.
  const others = ["angry", "sad", "surprised"].map((e) => out.get(e) ?? 0);
  check("only one emotion is expressed at a time", others.every((v) => v === 0),
    others.map((v) => v.toFixed(2)).join(" "));
}

// --- weak signals must not twitch the face --------------------------------
{
  const s = new FaceSolver();
  s.params.inferEmotion = true;
  const faint = scores({ mouthSmileLeft: 0.2, mouthSmileRight: 0.2 });
  for (let i = 0; i < 120; i++) s.update(faint, false, DT, out);
  check("a faint signal stays below the floor", (out.get("happy") ?? 0) < 0.01,
    `${(out.get("happy") ?? 0).toFixed(3)}`);
}

// --- emotions must not snap ------------------------------------------------
{
  const s = new FaceSolver();
  s.params.inferEmotion = true;
  const beaming = scores({ mouthSmileLeft: 1, mouthSmileRight: 1, eyeSquintLeft: 1, eyeSquintRight: 1 });
  s.update(beaming, false, DT, out);
  check("an expression eases in rather than appearing at once",
    (out.get("happy") ?? 0) < 0.2, `${(out.get("happy") ?? 0).toFixed(3)} after one frame`);
}

// --- disabled means nothing is written ------------------------------------
{
  const s = new FaceSolver();
  s.params.enabled = false;
  out.clear();
  s.update(scores({ eyeBlinkLeft: 1 }), false, DT, out);
  check("disabled writes no expressions at all", out.size === 0);
}

if (failures > 0) throw new Error(`${failures} face check failure(s)`);
console.log("\nALL PASS");
