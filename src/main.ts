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
import { BONE_INDEX, type HumanBoneName } from "./types.ts";
import { HolisticTracker } from "./tracker/holisticTracker.ts";
import { PoseTracker } from "./tracker/poseTracker.ts";
import type { Tracker } from "./tracker/tracker.ts";
import { TrackerHost } from "./tracker/trackerHost.ts";
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
  const trackers: Record<string, () => Tracker> = {
    pose: () => new PoseTracker(),
    holistic: () => new HolisticTracker(),
  };
  const host = new TrackerHost();
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
      inferenceMs: host.current?.inferenceMs ?? 0,
      delegate: host.current?.ready ? host.current.delegate : "-",
      backend: host.current?.name ?? "-",
      confidence: interpolator.current.confidence,
    }),
  });

  host.onFrame((frame) => {
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

    solver.solve(points, visibility, pose, frame.timestampMs);
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
  wireTrackingReadouts(panel, solver);

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
        host.setVideo(s.video);
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

  wireBackendControl(panel, host, trackers);
  void startPipeline(camera, host, banner);
}

/**
 * Lets the tracking backend be swapped while running.
 *
 * Holistic adds real hand landmarks but bundles its own pose model, and
 * whether its body tracking matches pose_landmarker_full is unverified.
 * Switching live is how that gets settled by observation -- watch the Stats
 * folder while flipping -- rather than by argument (SPEC.md 5.6).
 */
function wireBackendControl(
  panel: DebugPanel,
  host: TrackerHost,
  trackers: Record<string, () => Tracker>,
): void {
  const folder = panel.folder("Backend");
  const proxy = { backend: "pose" };
  folder
    .add(proxy, "backend", Object.keys(trackers))
    .onChange((name: string) => {
      const factory = trackers[name];
      if (factory) void host.use(name, factory);
    });
}

/**
 * Models are 9 to 14MB, so the first load of each is a real wait. The banner
 * reports it rather than leaving the page looking broken while nothing
 * happens.
 */
async function startPipeline(
  camera: Camera,
  host: TrackerHost,
  banner: StatusBanner,
): Promise<void> {
  host.onStatus((s) => {
    switch (s.kind) {
      case "loading":
        banner.show("busy", `Loading ${s.name} model...`);
        break;
      case "active":
        banner.hide();
        break;
      case "error":
        banner.show("error", `${s.name} model failed to load: ${s.message}`);
        break;
      case "idle":
        break;
    }
  });

  await host.use("pose", () => new PoseTracker());
  await camera.start();
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

  // Degradation constants (SPEC.md 5.7). All provisional and only settleable
  // by watching a limb actually leave frame.
  folder.add(solver.options, "visibilityThreshold", 0, 1, 0.05);
  folder.add(solver.options, "blendBand", 0, 0.5, 0.05).name("blend band");
  folder.add(solver.options, "holdSeconds", 0, 2, 0.1).name("hold (s)");
  folder.add(solver.options, "decaySeconds", 0.1, 4, 0.1).name("decay (s)");

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

/**
 * Per-bone tracking weight, 1 fully driven and 0 fully released to the
 * fallback. Makes an asymmetry between limbs a number you can read rather
 * than a behaviour you have to interpret.
 */
function wireTrackingReadouts(panel: DebugPanel, solver: PoseSolver): void {
  const bones: HumanBoneName[] = [
    "head",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
  ];
  const indices = bones.map((b) => BONE_INDEX[b]);
  panel.addReadoutGroup("Tracking", bones, () =>
    indices.map((i) => solver.weights[i] ?? 0),
  );
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
