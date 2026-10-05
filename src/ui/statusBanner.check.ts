/*
 * Checks for the status banner, run with `npm run check:banner`.
 *
 * Written after a message turned out to be impossible to get rid of. A caller
 * was re-raising the same text over and over, so dismissing it put it
 * straight back and its timeout never fired, because every call restarted the
 * countdown. The caller was at fault, but the banner had no defence, and this
 * is the file that gives it one.
 *
 * The DOM is stubbed rather than brought in: the class touches about a dozen
 * properties, which is far less than a headless browser or jsdom costs. The
 * clock is stubbed too, so a three-second timeout is tested in no time at all
 * and the number of times it is ARMED can be counted -- which is the actual
 * defect, and is invisible if you only look at the end state.
 *
 * Never imported by the app.
 */

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

/* --- the smallest DOM StatusBanner will run against ---------------------- */

interface Handler { (): void }

class FakeElement {
  className = "";
  type = "";
  hidden = false;
  textContent = "";
  readonly dataset: Record<string, string> = {};
  readonly style = {
    props: new Map<string, string>(),
    setProperty(k: string, v: string) { this.props.set(k, v); },
    removeProperty(k: string) { this.props.delete(k); },
  };
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Handler[]>();
  /** Any non-zero value; the banner only publishes it. */
  readonly offsetHeight = 48;

  setAttribute(): void { /* only ever aria here */ }
  addEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  append(...nodes: (FakeElement | { text: string })[]): void {
    for (const n of nodes) if (n instanceof FakeElement) this.children.push(n);
  }
  replaceChildren(): void { this.children.length = 0; }
  /** Fires the first click handler, as a user would. */
  click(): void { for (const fn of this.listeners.get("click") ?? []) fn(); }
  find(cls: string): FakeElement | undefined {
    return this.children.find((c) => c.className === cls);
  }
}

const body = new FakeElement();
let armCount = 0;
let pending: Handler | null = null;

const g = globalThis as unknown as Record<string, unknown>;
g["document"] = {
  body,
  createElement: () => new FakeElement(),
  createTextNode: (text: string) => ({ text }),
};
g["window"] = {
  setTimeout: (fn: Handler) => { armCount++; pending = fn; return ++armCount; },
  clearTimeout: () => { pending = null; },
};

/** Runs whatever timeout is pending, as the clock would. */
function fireTimeout(): void {
  const fn = pending;
  pending = null;
  fn?.();
}

const { StatusBanner } = await import("./statusBanner.ts");
const parent = new FakeElement();
// The stub implements the handful of members StatusBanner touches, not the
// 300-odd on HTMLElement, so the cast is the point of the stub rather than a
// hole in it.
const banner = new StatusBanner(parent as unknown as HTMLElement);
const el = parent.children[0] as FakeElement;

// --- a message appears, and marks the body --------------------------------
{
  banner.show("busy", "Requesting camera access...");
  check("a message shows", el.hidden === false);
  check("the body is marked while a banner is up", body.dataset["banner"] === "");
  check("the banner publishes its height",
    body.style.props.get("--banner-height") === "48px",
    `${body.style.props.get("--banner-height")}`);
}

// --- repeating the same message does not restart the countdown ------------
{
  armCount = 0;
  for (let i = 0; i < 50; i++) banner.show("busy", "Requesting camera access...");
  // The defect exactly: 50 calls used to mean 50 fresh three-second timers,
  // so the message outlived any of them.
  check("a repeated message is not re-armed", armCount === 0, `armed ${armCount} times`);

  fireTimeout();
  check("a repeated message still times out", el.hidden === true);
}

// --- dismissing by hand sticks --------------------------------------------
{
  banner.show("busy", "Requesting camera access...");
  const close = el.find("banner-close");
  check("every message carries a dismiss button", close !== undefined);
  close?.click();
  check("dismissing hides it", el.hidden === true);
  check("the body mark is cleared", body.dataset["banner"] === undefined);

  // The caller that caused this did not stop raising the message.
  for (let i = 0; i < 20; i++) banner.show("busy", "Requesting camera access...");
  check("a dismissed message does not come back", el.hidden === true);
}

// --- but a different message is not suppressed ----------------------------
{
  banner.show("info", "Calibration finished.");
  check("a different message still shows", el.hidden === false);

  banner.hide();
  banner.show("busy", "Requesting camera access...");
  check("the dismissal is forgotten once something else has been shown",
    el.hidden === false);
}

// --- errors are blocking and do not time out ------------------------------
{
  banner.hide();
  armCount = 0;
  banner.show("error", "Camera permission was denied.", { label: "Retry", run: () => {} });
  check("an error does not arm a countdown", armCount === 0, `armed ${armCount} times`);
  check("an error stays up", el.hidden === false);
  check("an error keeps its action", el.children.length === 2,
    `${el.children.length} buttons`);

  // It must still be closable by hand, since nothing else will close it.
  el.find("banner-close")?.click();
  check("an error can be dismissed by hand", el.hidden === true);
}

if (failures > 0) throw new Error(`${failures} banner check failure(s)`);
console.log("\nALL PASS");
