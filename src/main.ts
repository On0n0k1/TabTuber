/*
 * Entry point. Wiring only -- pipeline stages live in their own modules and
 * communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render (SPEC.md 4).
 */

import { Camera } from "./capture/camera.ts";
import { Stage } from "./render/stage.ts";

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (!canvas) throw new Error("missing #stage canvas");

  // Dev affordance only: makes the transparent canvas visible while working.
  document.body.dataset["bg"] = "checker";

  const stage = new Stage(canvas);
  stage.start();

  const camera = new Camera();
  camera.onStateChange((s) => {
    if (s.kind === "error") console.error(`camera: ${s.reason} -- ${s.message}`);
    else if (s.kind === "ready") console.info(`camera: ${s.width}x${s.height} ${s.label}`);
  });
  await camera.start();
}

void boot();
