/*
 * Entry point. Wiring only -- pipeline stages live in their own modules and
 * communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render (SPEC.md 4).
 */

import { Camera } from "./capture/camera.ts";
import { Stage } from "./render/stage.ts";
import { DebugPanel } from "./ui/debugPanel.ts";
import { FpsMeter } from "./ui/fpsMeter.ts";
import { StatusBanner } from "./ui/statusBanner.ts";

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  const ui = document.querySelector<HTMLElement>("#ui");
  if (!canvas || !ui) throw new Error("missing #stage canvas or #ui container");

  // Dev affordance only: makes the transparent canvas visible while working.
  document.body.dataset["bg"] = "checker";

  const stage = new Stage(canvas);
  const camera = new Camera();
  const banner = new StatusBanner(ui);

  const renderFps = new FpsMeter();
  const cameraFps = new FpsMeter();

  const panel = new DebugPanel({
    stage,
    camera,
    sample: () => ({
      renderFps: renderFps.fps,
      // Reports 0 once frames stop arriving rather than freezing on the last
      // reading, so a stalled camera is visible in the panel.
      cameraFps: cameraFps.staleAfter(1000),
      trackerFps: 0,
      latencyMs: 0,
    }),
  });

  camera.onStateChange((s) => {
    switch (s.kind) {
      case "requesting":
        banner.show("busy", "Requesting camera access...");
        break;
      case "ready":
        banner.hide();
        ui.append(camera.element);
        camera.element.style.display = "";
        countCameraFrames(camera.element, cameraFps);
        break;
      case "error":
        banner.show("error", s.message, {
          label: "Retry",
          run: () => void camera.start(),
        });
        break;
      case "idle":
        break;
    }
  });

  stage.onFrame(() => {
    renderFps.tick();
    panel.update();
  });
  stage.start();

  void camera.start();
}

/**
 * Counts real camera frames rather than render frames. Without this the panel
 * would only show how fast we draw, which says nothing about whether the
 * camera is actually delivering at the rate it claims.
 */
function countCameraFrames(video: HTMLVideoElement, meter: FpsMeter): void {
  if (!("requestVideoFrameCallback" in video)) return;

  const step = (): void => {
    meter.tick();
    video.requestVideoFrameCallback(step);
  };
  video.requestVideoFrameCallback(step);
}

boot();
