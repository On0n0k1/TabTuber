/*
 * Checks for the toolbar's click semantics, run with `npm run check:toolbar`.
 *
 * Only the state logic, not the DOM. What is worth asserting is that the
 * three kinds of button behave differently in the one way that matters: a
 * group with `allowNone` can be clicked back to nothing, a group without it
 * cannot be clicked into an invalid state, and a cycle always lands on a real
 * state even when handed a stale one from storage.
 *
 * Plus `needsRepaint`, which is here for a different reason: it is the one
 * piece of this file whose failure mode is silence. The others throw or show
 * the wrong thing; a missed field there just paints nothing, forever.
 *
 * Never imported by the app.
 */

import { needsRepaint, nextCycle, nextGroup, shouldFold, type ButtonPaint } from "./toolbar.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const POSTURES = ["sitting", "standing"];

// --- a cycle advances and wraps -------------------------------------------
{
  check("a cycle advances", nextCycle(POSTURES, "sitting") === "standing",
    nextCycle(POSTURES, "sitting"));
  check("a cycle wraps", nextCycle(POSTURES, "standing") === "sitting",
    nextCycle(POSTURES, "standing"));
  // Two states means every click is a swap, which is the posture button.
  let v = "sitting";
  for (let i = 0; i < 4; i++) v = nextCycle(POSTURES, v);
  check("an even number of clicks returns to the start", v === "sitting", v);
}

// --- a cycle survives a value it does not know ----------------------------
{
  // A posture read back from storage after the set of postures changed. The
  // button must still work rather than wedging on an unknown value.
  check("an unknown state falls back to the first",
    nextCycle(POSTURES, "lying-down") === "sitting",
    nextCycle(POSTURES, "lying-down"));
  check("an empty cycle returns what it was given",
    nextCycle([], "sitting") === "sitting");
}

// --- three states cycle in order ------------------------------------------
{
  const three = ["a", "b", "c"];
  check("three states advance in order",
    nextCycle(three, "a") === "b" && nextCycle(three, "b") === "c" && nextCycle(three, "c") === "a");
}

// --- a group selects, and allowNone clears --------------------------------
{
  check("clicking an inactive option selects it",
    nextGroup(null, "happy", true) === "happy");
  check("clicking a different option switches to it",
    nextGroup("happy", "sad", true) === "sad");
  // This is the behaviour that makes neutral reachable without a sixth
  // button for it.
  check("clicking the active option clears it when none is allowed",
    nextGroup("happy", "happy", true) === null);
}

// --- a group that must have a selection keeps it --------------------------
{
  check("clicking the active option holds when none is not allowed",
    nextGroup("sitting", "sitting", false) === "sitting",
    `${nextGroup("sitting", "sitting", false)}`);
  check("switching still works when none is not allowed",
    nextGroup("sitting", "standing", false) === "standing");
}

// --- repaint decides on every field it was given --------------------------
{
  const base: ButtonPaint = { icon: "face", on: true, disabled: false };
  check("a button never painted repaints", needsRepaint(null, base));
  check("an unchanged button does not repaint", !needsRepaint(base, { ...base }));
  check("a changed icon repaints",
    needsRepaint(base, { ...base, icon: "faceOff" }));
  check("a changed lit state repaints", needsRepaint(base, { ...base, on: false }));
  /*
   * The one that matters. Icon and lit state are unchanged, which is exactly
   * the case when a control is greyed out without being toggled -- and the
   * case a two-field comparison would skip for the life of the page.
   */
  check("becoming disabled repaints", needsRepaint(base, { ...base, disabled: true }));
  check("becoming enabled repaints",
    needsRepaint({ ...base, disabled: true }, base));
}

/*
 * --- folding is decided from the UNFOLDED width ---------------------------
 *
 * Here for the same reason as `needsRepaint`: its failure mode is silence.
 * The figures are the real ones -- the bar is 531px with the five expression
 * buttons in it and 371px with them folded away -- and the room chosen is
 * between the two, which is the only range where the bug shows.
 */
{
  const UNFOLDED = 531;
  const FOLDED = 371;
  const ROOM = 420;

  check("a bar wider than the room folds", shouldFold(UNFOLDED, ROOM));
  check("asking again gives the same answer", shouldFold(UNFOLDED, ROOM));

  // The decisive one. Folding makes room, so a decision taken from the folded
  // width says there is now space to unfold -- which there is, until it
  // unfolds and there is not. The remembered width is what stops that.
  check("the folded width would say there is room, so it must not be re-read",
    !shouldFold(FOLDED, ROOM),
    "-- re-measuring after folding alternates forever at this window width");

  check("a bar with room to spare stays in the bar", !shouldFold(UNFOLDED, 900));
  // Nothing measured yet is not the same as fitting in nothing: folding on
  // the strength of an unmeasured 0 would fold every bar on every screen.
  check("an unmeasured bar does not fold", !shouldFold(0, 300));
  check("a bar exactly as wide as the room does not fold",
    !shouldFold(UNFOLDED, UNFOLDED));
}

if (failures > 0) throw new Error(`${failures} toolbar check failure(s)`);
console.log("\nALL PASS");
