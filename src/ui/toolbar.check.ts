/*
 * Checks for the toolbar's click semantics, run with `npm run check:toolbar`.
 *
 * Only the state logic, not the DOM. What is worth asserting is that the
 * three kinds of button behave differently in the one way that matters: a
 * group with `allowNone` can be clicked back to nothing, a group without it
 * cannot be clicked into an invalid state, and a cycle always lands on a real
 * state even when handed a stale one from storage.
 *
 * Never imported by the app.
 */

import { nextCycle, nextGroup } from "./toolbar.ts";

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

if (failures > 0) throw new Error(`${failures} toolbar check failure(s)`);
console.log("\nALL PASS");
