/*
 * Checks for manual expression control, run with `npm run check:expression`.
 *
 * What matters here is that the avatar's face does exactly what was asked and
 * nothing else: one expression at a time, reaching full strength and coming
 * back to exactly zero, and keys that do not fire while someone is typing a
 * value into the debug panel.
 *
 * Never imported by the app.
 */

import { EXPRESSIONS, ExpressionControl, type ExpressionName } from "./expressionControl.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const out = new Map<string, number>();
const DT = 1 / 60;

/** Runs `seconds` of frames and returns the weight map. */
function settle(c: ExpressionControl, seconds: number): Map<string, number> {
  for (let i = 0; i < Math.round(seconds / DT); i++) c.update(DT, out);
  return out;
}

// --- neutral by default ---------------------------------------------------
{
  const c = new ExpressionControl();
  settle(c, 1);
  check("nothing is expressed until asked",
    EXPRESSIONS.every((e) => out.get(e) === 0),
    EXPRESSIONS.map((e) => `${e}=${out.get(e)}`).join(" "));
  check("no expression is active", c.active === null);
}

// --- a selection reaches full strength, alone -----------------------------
{
  const c = new ExpressionControl();
  c.set("happy");
  settle(c, 1);
  check("the chosen expression reaches full strength", (out.get("happy") ?? 0) > 0.99,
    `${(out.get("happy") ?? 0).toFixed(3)}`);
  // A face showing two emotions at once reads as broken.
  const others = EXPRESSIONS.filter((e) => e !== "happy");
  check("only the chosen one is expressed", others.every((e) => out.get(e) === 0),
    others.map((e) => `${e}=${out.get(e)}`).join(" "));
}

// --- it eases rather than cutting -----------------------------------------
{
  const c = new ExpressionControl();
  c.set("angry");
  c.update(DT, out);
  check("an expression eases in rather than appearing at once",
    (out.get("angry") ?? 0) > 0 && (out.get("angry") ?? 0) < 0.3,
    `${(out.get("angry") ?? 0).toFixed(3)} after one frame`);
}

// --- zero fade is a cut, for anyone who wants one -------------------------
{
  const c = new ExpressionControl();
  c.params.fade = 0;
  c.set("sad");
  c.update(DT, out);
  check("zero fade lands in one frame", out.get("sad") === 1, `${out.get("sad")}`);
}

// --- switching hands over cleanly -----------------------------------------
{
  const c = new ExpressionControl();
  c.set("happy");
  settle(c, 1);
  c.set("surprised");
  // Long enough for the outgoing weight to cross the snap threshold; an
  // exponential fade is still a few thousandths above zero after one second.
  settle(c, 2);
  check("the previous expression leaves the face entirely", out.get("happy") === 0,
    `${out.get("happy")}`);
  check("the new one arrives", (out.get("surprised") ?? 0) > 0.99,
    `${(out.get("surprised") ?? 0).toFixed(3)}`);
}

// --- the same selection twice is a toggle ---------------------------------
{
  const c = new ExpressionControl();
  c.set("relaxed");
  c.set("relaxed");
  check("selecting the active expression clears it", c.active === null);
  settle(c, 1);
  // Exactly zero, not merely small: a residue would leave the avatar wearing
  // a trace of an expression that was dismissed.
  check("clearing returns to exactly neutral", out.get("relaxed") === 0,
    `${out.get("relaxed")}`);
}

/**
 * The smallest thing `bindKeys` will attach to.
 *
 * A real `EventTarget` cannot be used here, because a real `Event` has a
 * read-only `target` and the handler has to see one to know a field has
 * focus. Dispatching plain objects is enough for the five properties it
 * reads, and cheaper than depending on jsdom for them.
 */
class FakeTarget implements EventTarget {
  private listeners: EventListener[] = [];

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener === "function") this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject | null): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const l of [...this.listeners]) l(event);
    return true;
  }
}

// --- keys select, and 0 clears --------------------------------------------
{
  const c = new ExpressionControl();
  const target = new FakeTarget();
  const detach = c.bindKeys(target);

  const press = (key: string, extra: Record<string, unknown> = {}): void => {
    const e = { type: "keydown", key, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra };
    // Not an Event, by necessity; see FakeTarget.
    target.dispatchEvent(e as unknown as Event);
  };

  EXPRESSIONS.forEach((name: ExpressionName, i: number) => {
    press(String(i + 1));
    check(`key ${i + 1} selects ${name}`, c.active === name, `${c.active}`);
  });

  press("0");
  check("0 returns to neutral", c.active === null);

  press("3");
  press("Escape");
  check("escape returns to neutral", c.active === null);

  // Typing 2 into a numeric field in the panel must not change the face.
  press("2", { target: { tagName: "INPUT" } });
  check("keys are ignored while typing in a field", c.active === null, `${c.active}`);

  // A browser or OS shortcut that happens to involve a digit is not a cue.
  press("2", { ctrlKey: true });
  check("modified keys are ignored", c.active === null, `${c.active}`);

  c.params.hotkeys = false;
  press("2");
  check("keys do nothing when hotkeys are off", c.active === null, `${c.active}`);

  c.params.hotkeys = true;
  detach();
  press("2");
  check("detaching stops the keys", c.active === null, `${c.active}`);
}

if (failures > 0) throw new Error(`${failures} expression check failure(s)`);
console.log("\nALL PASS");
