/*
 * Entry point. Wiring only -- pipeline stages live in their own modules and
 * communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render (SPEC.md 4).
 */

import { Camera } from "./capture/camera.ts";
import { Stage } from "./render/stage.ts";
import { PoseTracker } from "./tracker/poseTracker.ts";
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
  const tracker = new PoseTracker();
  const banner = new StatusBanner(ui);

  const renderFps = new FpsMeter();
  const cameraFps = new FpsMeter();
  const trackerFps = new FpsMeter();

  const panel = new DebugPanel({
    stage,
    camera,
    sample: () => ({
      renderFps: renderFps.fps,
      // These decay to zero when their source stalls rather than freezing on
      // a last value, so a stalled camera or tracker is visible in the panel.
      cameraFps: cameraFps.staleAfter(1000),
      trackerFps: trackerFps.staleAfter(1000),
      inferenceMs: tracker.inferenceMs,
      delegate: tracker.ready ? tracker.delegate : "-",
    }),
  });

  tracker.onFrame(() => {
    trackerFps.tick();
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
        if (tracker.ready) tracker.attach(s.video);
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

  // Started once, not per camera-ready: the video element is stable across
  // restarts, so starting a chain per state change would leave the old one
  // running and double the reported rate.
  countCameraFrames(camera.element, cameraFps);

  stage.onFrame(() => {
    renderFps.tick();
    panel.update();
  });
  stage.start();

  void startPipeline(camera, tracker, banner);
}

/**
 * The model is ~9MB, so the first load is a real wait. The banner reports it
 * rather than leaving the page looking broken while nothing happens.
 */
async function startPipeline(
  camera: Camera,
  tracker: PoseTracker,
  banner: StatusBanner,
): Promise<void> {
  banner.show("busy", "Loading pose model...");
  try {
    await tracker.init();
  } catch (err) {
    banner.show("error", `Pose model failed to load: ${String(err)}`);
    return;
  }

  await camera.start();

  // The camera may have become ready before init() resolved, in which case
  // the state handler could not attach yet.
  const state = camera.state;
  if (state.kind === "ready") tracker.attach(state.video);
}

/**
 * Counts real camera frames rather than render frames. Render rate says
 * nothing about whether the camera is delivering at the rate it claims.
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
