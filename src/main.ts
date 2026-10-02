/*
 * Entry point. Wiring only -- pipeline stages live in their own modules and
 * communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render (SPEC.md 4).
 */

import { Camera } from "./capture/camera.ts";
import { LandmarkFilter } from "./filter/oneEuro.ts";
import { AvatarSlot, enableVrmDrop } from "./render/avatarSlot.ts";
import { Blink, BLINK_EXPRESSION } from "./render/blink.ts";
import { DebugRig } from "./render/debugRig.ts";
import { PoseInterpolator } from "./render/poseInterpolator.ts";
import { StickFigure } from "./render/stickFigure.ts";
import { Stage } from "./render/stage.ts";
import {
  handToThree,
  mirrorImagePoints,
  mirrorScalars,
  mpToThree,
} from "./solver/coords.ts";
import { PoseSolver, type PostureMode } from "./solver/poseSolver.ts";
import { BONE_INDEX, type HumanBoneName } from "./types.ts";
import { HolisticTracker } from "./tracker/holisticTracker.ts";
import { LEG_LANDMARKS, LM } from "./tracker/landmarks.ts";
import { PoseTracker } from "./tracker/poseTracker.ts";
import type { Tracker } from "./tracker/tracker.ts";
import { TrackerHost } from "./tracker/trackerHost.ts";
import { createAvatarPose, HAND_LANDMARK_COUNT, LANDMARK_COUNT } from "./types.ts";
import { DebugPanel } from "./ui/debugPanel.ts";
import { Overlay2D } from "./ui/overlay2d.ts";
import { FpsMeter } from "./ui/fpsMeter.ts";
import { readSetting, writeSetting } from "./ui/settings.ts";
import { StatusBanner } from "./ui/statusBanner.ts";

type BackendName = "holistic" | "pose";
type TrackerRegistry = Record<BackendName, () => Tracker>;

/** Holistic tracks better overall and is the only source of hand data. */
const DEFAULT_BACKEND: BackendName = "holistic";

const POSTURES = ["sitting", "standing"] as const;
/** Most use is at a desk, and it is the framing that needs no leg data. */
const DEFAULT_POSTURE: PostureMode = "sitting";

/**
 * How much harder the hips are smoothed in sitting posture.
 *
 * They sit at the frame boundary and feed the torso up-axis, so their noise
 * propagates into the whole upper body. Provisional (SPEC.md 15).
 */
const SITTING_HIP_CUTOFF_SCALE = 0.4;

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  const ui = document.querySelector<HTMLElement>("#ui");
  if (!canvas || !ui) throw new Error("missing #stage canvas or #ui container");

  // Dev affordance only: makes the transparent canvas visible while working.
  document.body.dataset["bg"] = "checker";

  const stage = new Stage(canvas);
  const camera = new Camera();
  // Holistic first: it tracks better overall, and it is the only backend that
  // supplies real hand landmarks (SPEC.md 11). Pose is kept selectable as a
  // fallback and as an independent reference when the two disagree.
  const trackers = {
    holistic: () => new HolisticTracker(),
    pose: () => new PoseTracker(),
  } satisfies Record<string, () => Tracker>;

  const backendNames = Object.keys(trackers) as BackendName[];
  const initialBackend = readSetting<BackendName>(
    "backend",
    backendNames,
    DEFAULT_BACKEND,
  );

  const host = new TrackerHost();
  const banner = new StatusBanner(ui);
  const overlay = new Overlay2D(ui);

  const stickFigure = new StickFigure();
  stage.scene.add(stickFigure.object);

  const solver = new PoseSolver();
  solver.options.posture = readSetting<PostureMode>("posture", POSTURES, DEFAULT_POSTURE);
  const pose = createAvatarPose();
  // The rig is driven from the interpolator's pose, not the solver's, so it
  // moves at render rate rather than in 30Hz steps.
  const interpolator = new PoseInterpolator();
  const blink = new Blink();
  const debugRig = new DebugRig();
  stage.scene.add(debugRig.object);

  // The avatar occupies the debug rig's slot. Overlapping them is deliberate:
  // with the compare offset at zero they coincide exactly, which is how a
  // mapping fault shows up as the two disagreeing (SPEC.md 12).
  const avatarSlot = new AvatarSlot();
  stage.scene.add(avatarSlot.group);

  // Smoothed raw landmarks, then the same data converted to three.js space.
  // Both allocated once and overwritten each frame.
  const filter = new LandmarkFilter(LANDMARK_COUNT);
  const filteredWorld = new Float32Array(LANDMARK_COUNT * 3);
  const points = new Float32Array(LANDMARK_COUNT * 3);
  const visibility = new Float32Array(LANDMARK_COUNT);
  // Image space, mirrored to match. Hip sway needs this because world
  // landmarks are hip-centred and cannot report that the body moved.
  const imagePoints = new Float32Array(LANDMARK_COUNT * 3);

  // Hand landmarks, when the active backend supplies them.
  const leftHandPoints = new Float32Array(HAND_LANDMARK_COUNT * 3);
  const rightHandPoints = new Float32Array(HAND_LANDMARK_COUNT * 3);
  const handPoints: { left: Float32Array | null; right: Float32Array | null } = {
    left: null,
    right: null,
  };

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
    if (solver.options.posture === "sitting") {
      // Zeroed rather than left alone so the debug overlay dims them too:
      // these are the landmarks whose confident wrongness motivates the mode.
      for (const i of LEG_LANDMARKS) visibility[i] = 0;
    }
    stickFigure.update(points, visibility);

    // Mirroring swaps which hand is displayed on which side, exactly as it
    // swaps the body's left/right landmarks. Reflecting without the swap
    // would hand the solver a left hand labelled right.
    const sourceLeft = view.mirror ? frame.rightHand : frame.leftHand;
    const sourceRight = view.mirror ? frame.leftHand : frame.rightHand;

    if (sourceLeft?.present) {
      handToThree(leftHandPoints, sourceLeft.world, view.mirror);
      handPoints.left = leftHandPoints;
    } else {
      handPoints.left = null;
    }
    if (sourceRight?.present) {
      handToThree(rightHandPoints, sourceRight.world, view.mirror);
      handPoints.right = rightHandPoints;
    } else {
      handPoints.right = null;
    }

    mirrorImagePoints(imagePoints, frame.image, view.mirror);
    solver.solve(points, visibility, pose, frame.timestampMs, handPoints, imagePoints);
    pose.timestampMs = frame.timestampMs;
    interpolator.setTarget(pose);
  });

  panel.addViewToggle("landmarks", true, (v) => overlay.setVisible(v));
  panel.addViewToggle("stickFigure", true, (v) => stickFigure.setVisible(v));
  // Off by default once an avatar loads; the rig stays one click away as the
  // reference for whether a fault is in the mapping or the solver.
  panel.addViewToggle("debugRig", true, (v) => debugRig.setVisible(v));
  panel.addViewToggle("avatar", true, (v) => avatarSlot.setVisible(v));
  panel.addViewToggle("mirror", view.mirror, (v) => {
    view.mirror = v;
  });

  applyCompareOffset(view.compareOffset, stickFigure, debugRig, avatarSlot);
  wireAvatar(avatarSlot, stage, banner, debugRig);
  wireSolverControls(panel, solver, view, stickFigure, debugRig, avatarSlot);
  wireFilterControls(panel, filter);
  wireMotionControls(panel, interpolator);
  wireLivelinessControls(panel, solver, blink);
  wireTrackingReadouts(panel, solver);
  // Height and hip height together say whether a model is correctly scaled
  // and correctly grounded; a hip height of 0 means it will sit in the floor.
  panel.addReadoutGroup(
    "Avatar",
    ["height", "hipHeight"],
    () => [avatarSlot.avatar?.height ?? 0, avatarSlot.avatar?.hipHeight ?? 0],
  );
  const applyPosture = (posture: PostureMode): void => {
    solver.options.posture = posture;
    stage.frameFor(posture);

    // Hallucinated legs stay out of the ground-truth view when nothing is
    // driving them, so they cannot be mistaken for a solver fault.
    const showLegs = posture === "standing";
    stickFigure.setGroupVisible("leftLeg", showLegs);
    stickFigure.setGroupVisible("rightLeg", showLegs);

    const hipScale = posture === "sitting" ? SITTING_HIP_CUTOFF_SCALE : 1;
    filter.cutoffScale[LM.LEFT_HIP] = hipScale;
    filter.cutoffScale[LM.RIGHT_HIP] = hipScale;
  };
  applyPosture(solver.options.posture);
  wirePostureControl(panel, applyPosture, solver.options.posture);

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

    // Written after step(), which copies expressions from the target: the
    // blink is generated here at render rate, not carried from the solver.
    interpolator.current.expressions.set(BLINK_EXPRESSION, blink.update(dt));

    debugRig.apply(interpolator.current);

    // apply() writes the normalised pose; update() drives spring bones and
    // copies it onto the raw rig, so the order matters.
    avatarSlot.apply(interpolator.current);
    avatarSlot.update(dt);

    panel.update();
  });
  stage.start();

  wireBackendControl(panel, host, trackers, initialBackend);
  void startPipeline(camera, host, banner, trackers, initialBackend);
}

/**
 * Lets the tracking backend be swapped while running.
 *
 * Holistic is the default. Pose stays selectable as a fallback and as a
 * second opinion when a pose looks wrong. The choice persists, since it is a
 * preference rather than a per-session experiment (SPEC.md 11).
 */
function wireBackendControl(
  panel: DebugPanel,
  host: TrackerHost,
  trackers: TrackerRegistry,
  initial: BackendName,
): void {
  const folder = panel.folder("Backend");
  const proxy = { backend: initial };
  folder
    .add(proxy, "backend", Object.keys(trackers))
    .onChange((name: string) => {
      const factory = trackers[name as BackendName];
      if (!factory) return;
      writeSetting("backend", name);
      void host.use(name, factory);
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
  trackers: TrackerRegistry,
  backend: BackendName,
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

  await host.use(backend, trackers[backend]);
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
  avatarSlot: AvatarSlot,
): void {
  stickFigure.object.position.x = -offset;
  debugRig.setOffsetX(offset);
  avatarSlot.setOffsetX(offset);
}

/**
 * Loads the staged avatar and accepts any .vrm dropped on the page.
 *
 * Framing follows the model's measured height rather than the model being
 * rescaled to fit: rescaling breaks spring-bone physics, which are tuned in
 * absolute units, and tracking is scale-free regardless (SPEC.md 7.2).
 */
function wireAvatar(
  avatarSlot: AvatarSlot,
  stage: Stage,
  banner: StatusBanner,
  debugRig: DebugRig,
): void {
  avatarSlot.onStatus((s) => {
    switch (s.kind) {
      case "loading":
        banner.show("busy", `Loading ${s.label}...`);
        break;
      case "ready": {
        stage.setSubjectHeight(s.height);
        // The rig has served its purpose once a real avatar is up; it stays
        // available from the panel as the reference when something looks off.
        debugRig.setVisible(false);
        if (s.warnings.length > 0) {
          banner.show("info", s.warnings.map((w) => w.message).join("  |  "));
        } else {
          banner.hide();
        }
        break;
      }
      case "error":
        banner.show("error", `${s.label}: ${s.message}`);
        break;
      case "empty":
        break;
    }
  });

  enableVrmDrop(document.body, (buffer, name) => {
    void avatarSlot.load(buffer, name);
  });

  void avatarSlot.load("/models/avatar.vrm", "avatar.vrm");
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
  avatarSlot: AvatarSlot,
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
  folder.add(solver.options, "useHandLandmarks").name("use palm frame");

  // Degradation constants (SPEC.md 5.7). All provisional and only settleable
  // by watching a limb actually leave frame.
  folder.add(solver.options, "visibilityThreshold", 0, 1, 0.05);
  folder.add(solver.options, "blendBand", 0, 0.5, 0.05).name("blend band");
  folder.add(solver.options, "holdSeconds", 0, 2, 0.1).name("hold (s)");
  folder.add(solver.options, "decaySeconds", 0.1, 4, 0.1).name("decay (s)");

  // Hip sway (SPEC.md 5.5). Lateral only; depth is never swayed.
  folder.add(solver.options.sway, "enabled").name("hip sway");
  folder.add(solver.options.sway, "gain", 0, 1.5, 0.05).name("sway gain");
  folder.add(solver.options.sway, "max", 0, 0.3, 0.01).name("sway max (m)");
  folder.add(solver.options.sway, "baselineSeconds", 1, 40, 1).name("sway recentre (s)");

  folder
    .add(view, "compareOffset", 0, 1.2, 0.05)
    .name("compare offset")
    .onChange((v: number) => applyCompareOffset(v, stickFigure, debugRig, avatarSlot));
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
/**
 * Posture is a manual choice, not a detected one (SPEC.md 5.8). Detecting it
 * would mean reading leg visibility, but the tracker reports confident
 * visibility for hallucinated out-of-frame legs -- the exact failure being
 * worked around -- so deciding with that signal is circular.
 */
function wirePostureControl(
  panel: DebugPanel,
  apply: (posture: PostureMode) => void,
  initial: PostureMode,
): void {
  const folder = panel.folder("Posture");
  const proxy = { posture: initial };
  folder.add(proxy, "posture", [...POSTURES]).onChange((value: string) => {
    const posture = value as PostureMode;
    writeSetting("posture", posture);
    apply(posture);
  });
}

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

/**
 * Idle motion and blinking (SPEC.md 8). Both exist so the avatar never goes
 * completely still: a frozen avatar reads to an audience as broken software,
 * where a breathing one reads as someone who stepped away.
 */
function wireLivelinessControls(
  panel: DebugPanel,
  solver: PoseSolver,
  blink: Blink,
): void {
  const folder = panel.folder("Liveliness");
  folder.add(solver.idle, "amount", 0, 2, 0.05).name("idle amount");
  folder.add(solver.idle, "breathRate", 0, 1, 0.01).name("breath rate (Hz)");
  folder.add(solver.idle, "breathDepth", 0, 6, 0.1).name("breath depth (deg)");
  folder.add(solver.idle, "driftDepth", 0, 8, 0.1).name("drift depth (deg)");
  folder.add(blink.params, "enabled").name("blink");
  folder.add(blink.params, "minInterval", 0.5, 8, 0.1).name("blink min (s)");
  folder.add(blink.params, "maxInterval", 0.5, 12, 0.1).name("blink max (s)");
  folder.add(blink.params, "duration", 0.05, 0.4, 0.01).name("blink time (s)");
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
