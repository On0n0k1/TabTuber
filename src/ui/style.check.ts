/*
 * Checks the stylesheet against the elements that are hidden by attribute,
 * run with `npm run check:style`.
 *
 * One rule, learned expensively. Setting `display` on an element in an author
 * stylesheet overrides the browser's `[hidden] { display: none }`, because
 * author rules beat user-agent rules. So an element styled `display: flex`
 * and hidden with `el.hidden = true` keeps its attribute set and stays
 * visible, and every way of asking "is it hidden?" in JavaScript answers yes.
 *
 * The status banner shipped like that from the start: every message ever
 * raised stayed on screen for the life of the page. It survived a dismiss
 * button, an auto-dismiss, two rounds of browser probes and a DOM-stubbed
 * check suite, all of which asserted `el.hidden === true` -- which was always
 * true, and never meant what it was taken to mean.
 *
 * Never imported by the app.
 */

/*
 * The only check that reads a file, and the project carries no Node type
 * definitions -- every other one works on imported modules alone. Suppressed
 * rather than adding @types/node, which would pull Node's globals into a
 * browser codebase to type a single call. `as string` for the same reason:
 * without the types the return is untyped, and an implicit any is worse than
 * a stated one.
 */
// @ts-expect-error -- no @types/node; see above.
import { readFileSync } from "node:fs";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

const css = readFileSync(new URL("../style.css", import.meta.url), "utf8") as string;

/**
 * Classes whose elements are shown and hidden through the `hidden` property.
 *
 * Listed by hand because the link between a TypeScript class name and a CSS
 * selector cannot be followed statically. Anything new that sets `.hidden`
 * belongs here; the cost of forgetting is an element that cannot be hidden.
 */
const HIDEABLE = [
  "banner",        // StatusBanner.el
  "toolbar",       // Toolbar.el
  "toolbar-tip",   // Toolbar.tip
  "toolbar-tip-key",
  "latency",       // LatencyHud.el
  "latency-note",
];

/** Declarations of `display` for a bare class selector, ignoring [hidden]. */
function setsDisplay(cls: string): boolean {
  const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`, "g");
  for (const match of css.matchAll(rule)) {
    if (/display\s*:\s*(?!none)/.test(match[0])) return true;
  }
  return false;
}

function hasGuard(cls: string): boolean {
  const rule = new RegExp(`\\.${cls}\\[hidden\\]\\s*\\{[^}]*\\}`);
  const match = css.match(rule);
  return match !== null && /display\s*:\s*none/.test(match[0]);
}

for (const cls of HIDEABLE) {
  // Only an element given a display of its own can override the attribute;
  // one left at its default is hidden correctly without any help.
  if (!setsDisplay(cls)) {
    check(`.${cls} does not override display, so [hidden] works unaided`, true);
    continue;
  }
  check(`.${cls} sets display and guards [hidden]`, hasGuard(cls),
    "-- el.hidden will set the attribute and change nothing on screen");
}

/*
 * The landmark overlay has to sit exactly over the camera preview, and the
 * two are positioned by separate rules -- the overlay's size comes from
 * JavaScript, but where its box starts comes from here. Nothing else ties the
 * two rules together, so they can be moved apart one at a time, and the
 * result is a skeleton offset from the body it is drawn on: wrong in a way
 * that looks like a tracking fault rather than a stylesheet edit.
 */
const ANCHORED = ["top", "left"];

/** The declaration block for a selector written on its own line. */
function ruleBody(selector: string): string {
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = css.match(new RegExp(`(?:^|\n)\\s*${pattern}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

function declaration(body: string, prop: string): string {
  const match = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return match?.[1]?.trim() ?? "";
}

const previewRule = ruleBody("#ui video");
const overlayRule = ruleBody(".overlay2d");
check("the preview and overlay rules are both found",
  previewRule !== "" && overlayRule !== "",
  "-- a selector was renamed and the checks below now compare nothing");

for (const prop of ANCHORED) {
  const preview = declaration(previewRule, prop);
  const overlay = declaration(overlayRule, prop);
  check(`the overlay matches the preview on ${prop}`,
    preview !== "" && preview === overlay,
    `-- preview "${preview}", overlay "${overlay}"; the skeleton will be offset`);
}

if (failures > 0) throw new Error(`${failures} style check failure(s)`);
console.log("\nALL PASS");
