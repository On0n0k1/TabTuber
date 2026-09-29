/*
 * Entry point. Wiring only -- pipeline stages live in their own modules and
 * communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render (SPEC.md 4).
 */

import { Stage } from "./render/stage.ts";

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (!canvas) throw new Error("missing #stage canvas");

  // Dev affordance only: makes the transparent canvas visible while working.
  document.body.dataset["bg"] = "checker";

  const stage = new Stage(canvas);
  stage.start();
}

boot();
