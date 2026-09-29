/*
 * Entry point. Wiring only -- pipeline stages live in their own modules and
 * communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render (SPEC.md 4).
 */

import { Camera } from "./capture/camera.ts";
import { LandmarkFilter } from "./filter/oneEuro.ts";
import { DebugRig } from "./render/debugRig.ts";
import { PoseInterpolator } from "./render/poseInterpolator.ts";
import { StickFigure } from "./render/stickFigure.ts";
import { Stage } from "./render/stage.ts";
import { mirrorScalars, mpToThree } from "./solver/coords.ts";
import { PoseSolver } from "./solver/poseSolver.ts";
import { PoseTracker } from "./tracker/poseTracker.ts";
import { createAvatarPose, LANDMARK_COUNT } from "./types.ts";
import { DebugPanel } from "./ui/debugPanel.ts";
import { Overlay2D } from "./ui/overlay2d.ts";
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
  const overlay = new Overlay2D(ui);

  const stickFigure = new StickFigure();
  stage.scene.add(stickFigure.object);

  const solver = new PoseSolver();
  const pose = createAvatarPose();
  // The rig is driven from the interpolator's pose, not the solver's, so it
  // moves at render rate rather than in 30Hz steps.
  const interpolator = new PoseInterpolator();
  const debugRig = new DebugRig();
  stage.scene.add(debugRig.object);

  // Smoothed raw landmarks, then the same data converted to three.js space.
  // Both allocated once and overwritten each frame.
  const filter = new LandmarkFilter(LANDMARK_COUNT);
  const filteredWorld = new Float32Array(LANDMARK_COUNT * 3);
  const points = new Float32Array(LANDMARK_COUNT * 3);
  const visibility = new Float32Array(LANDMARK_COUNT);

  // Mirrored by default: the usual VTubing preference, and the only place
  // the choice is applied is mpToThree (SPEC.md 5.1).
  const view = { mirror: true, compareOffset: 0.55 };

  // Preview dimensions, measured after layout rather than read per frame --
  // a getBoundingClientRect inside the draw loop would thrash layout.
  let previewW = 0;
  let previewH = 0;

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
      confidence: interpolator.current.confidence,
    }),
  });

  tracker.onFrame((frame) => {
    trackerFps.tick();
    if (previewW > 0) overlay.draw(frame, previewW, previewH);

    // Filtered before conversion, so the mirror toggle cannot look like a
    // jump and depth keeps its own parameters (SPEC.md section 6).
    filter.apply(filteredWorld, frame.world, frame.timestampMs);
    mpToThree(points, filteredWorld, { mirror: view.mirror });
    // Visibility has to follow its landmark through the swap, or the solver
    // gates each arm on the other arm's confidence when mirrored.
    mirrorScalars(visibility, frame.visibility, view.mirror);
    stickFigure.update(points, visibility);

    solver.solve(points, visibility, pose);
    pose.timestampMs = frame.timestampMs;
    interpolator.setTarget(pose);
  });

  panel.addViewToggle("landmarks", true, (v) => overlay.setVisible(v));
  panel.addViewToggle("stickFigure", true, (v) => stickFigure.setVisible(v));
  panel.addViewToggle("debugRig", true, (v) => debugRig.setVisible(v));
  panel.addViewToggle("mirror", view.mirror, (v) => {
    view.mirror = v;
  });

  applyCompareOffset(view.compareOffset, stickFigure, debugRig);
  wireSolverControls(panel, solver, view, stickFigure, debugRig);
  wireFilterControls(panel, filter);
  wireMotionControls(panel, interpolator);

  camera.onStateChange((s) => {
    switch (s.kind) {
      case "requesting":
        banner.show("busy", "Requesting camera access...");
        break;
      case "ready":
        banner.hide();
        // Stale filter state from before the gap would otherwise be blended
        // into the first frames of the new stream.
        filter.reset();
        ui.append(camera.element);
        camera.element.style.display = "";
        measurePreview(camera.element, (w, h) => {
          previewW = w;
          previewH = h;
          overlay.resize(w, h);
        });
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

  stage.onFrame(({ dt }) => {
    renderFps.tick();
    interpolator.step(dt);
    debugRig.apply(interpolator.current);
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
 * The two 3D views sit side by side by default so divergence between them is
 * obvious. Setting the offset to zero overlays them, which is better for
 * judging small errors once the gross ones are gone.
 */
function applyCompareOffset(
  offset: number,
  stickFigure: StickFigure,
  debugRig: DebugRig,
): void {
  stickFigure.object.position.x = -offset;
  debugRig.setOffsetX(offset);
}

/**
 * Exposes the provisional constants from SPEC.md 13 so they can be tuned
 * while watching yourself move, which is the only way they get settled.
 */
function wireSolverControls(
  panel: DebugPanel,
  solver: PoseSolver,
  view: { mirror: boolean; compareOffset: number },
  stickFigure: StickFigure,
  debugRig: DebugRig,
): void {
  const folder = panel.folder("Solver");

  // Shares are renormalised on every change, so the three always sum to one
  // and no combination can silently scale the total torso rotation.
  const split = { spine: 0.3, chest: 0.3, upperChest: 0.4 };
  const applySplit = (): void => {
    const total = split.spine + split.chest + split.upperChest || 1;
    solver.options.torsoSplit = [
      split.spine / total,
      split.chest / total,
      split.upperChest / total,
    ];
  };
  for (const key of ["spine", "chest", "upperChest"] as const) {
    folder.add(split, key, 0, 1, 0.05).name(`torso: ${key}`).onChange(applySplit);
  }

  folder.add(solver.options, "neckShare", 0, 1, 0.05);
  folder.add(solver.options, "twist");
  folder.add(solver.options, "visibilityThreshold", 0, 1, 0.05);

  folder
    .add(view, "compareOffset", 0, 1.2, 0.05)
    .name("compare offset")
    .onChange((v: number) => applyCompareOffset(v, stickFigure, debugRig));
}

/**
 * The filter can be switched off from here, which matters: the stick figure
 * has to be judged against both the raw and smoothed signal, or the noise
 * floor gets mistaken for a solver fault.
 */
function wireFilterControls(panel: DebugPanel, filter: LandmarkFilter): void {
  const folder = panel.folder("Filter");
  folder.add(filter, "enabled");
  folder.add(filter.xy, "minCutoff", 0.1, 5, 0.1).name("xy: minCutoff");
  folder.add(filter.xy, "beta", 0, 0.5, 0.01).name("xy: beta");
  folder.add(filter.z, "minCutoff", 0.1, 5, 0.1).name("z: minCutoff");
  folder.add(filter.z, "beta", 0, 0.5, 0.01).name("z: beta");
}

function wireMotionControls(panel: DebugPanel, interpolator: PoseInterpolator): void {
  const folder = panel.folder("Motion");
  folder.add(interpolator, "enabled").name("interpolate");
  folder.add(interpolator, "tau", 0, 0.25, 0.005).name("tau (s)");
}

/** Waits a frame so the preview has been laid out before it is measured. */
function measurePreview(
  video: HTMLVideoElement,
  apply: (w: number, h: number) => void,
): void {
  requestAnimationFrame(() => {
    const rect = video.getBoundingClientRect();
    if (rect.width > 0) apply(rect.width, rect.height);
    else measurePreview(video, apply);
  });
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
