/*
 * Entry point. Wiring only -- pipeline stages live in their own modules and
 * communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render (SPEC.md 4).
 */

import { MicLevel } from "./audio/micLevel.ts";
import { Mouth } from "./audio/mouth.ts";
import {
  CALIBRATION_STEPS,
  STEP_PROMPTS,
  VowelCalibrator,
} from "./audio/vowelCalibration.ts";
import {
  blendVisemes,
  referencePoints,
  type VowelCalibration,
} from "./audio/vowelSpace.ts";
import { Camera } from "./capture/camera.ts";
import {
  DEFAULT_HAND_XY_PARAMS,
  DEFAULT_HAND_Z_PARAMS,
  LandmarkFilter,
} from "./filter/oneEuro.ts";
import { AvatarSlot, enableVrmDrop } from "./render/avatarSlot.ts";
import { Blink, BLINK_EXPRESSION } from "./render/blink.ts";
import { DebugRig } from "./render/debugRig.ts";
import { EXPRESSIONS, ExpressionControl, type ExpressionName } from "./render/expressionControl.ts";
import { PoseBuffer, MAX_LOOKAHEAD } from "./render/poseBuffer.ts";
import { PoseInterpolator } from "./render/poseInterpolator.ts";
import { StickFigure } from "./render/stickFigure.ts";
import { Stage } from "./render/stage.ts";
import {
  handToThree,
  mirrorHandImage,
  mirrorImagePoints,
  mirrorScalars,
  mpToThree,
} from "./solver/coords.ts";
import { FaceSolver } from "./solver/faceSolver.ts";
import {
  PoseSolver,
  type HandInput,
  type PostureMode,
} from "./solver/poseSolver.ts";
import { BONE_INDEX, type HumanBoneName,
  type FaceFrame,
} from "./types.ts";
import { LEG_LANDMARKS, LM } from "./tracker/landmarks.ts";
import {
  DELEGATE_PREFERENCES,
  TRACKER_BACKENDS,
  type DelegatePreference,
  type TrackerBackend,
} from "./tracker/tracker.ts";
import { CaptureDelay } from "./capture/captureDelay.ts";
import { LocalTrackingHost } from "./tracker/localHost.ts";
import type { TrackingHost } from "./tracker/trackingHost.ts";
import { hasStreamTransport, WorkerTrackingHost } from "./tracker/workerHost.ts";
import { createAvatarPose, HAND_LANDMARK_COUNT, LANDMARK_COUNT } from "./types.ts";
import { DebugPanel } from "./ui/debugPanel.ts";
import { Overlay2D } from "./ui/overlay2d.ts";
import { FpsMeter } from "./ui/fpsMeter.ts";
import { LatencyHud } from "./ui/latencyHud.ts";
import {
  clearAllSettings,
  clearSetting,
  once,
  readJson,
  readSetting,
  writeJson,
  writeSetting,
} from "./ui/settings.ts";
import { StatusBanner } from "./ui/statusBanner.ts";
import type { IconName } from "./ui/icons.ts";
import { SetupSheet } from "./ui/setupSheet.ts";
import { Toolbar } from "./ui/toolbar.ts";

/**
 * Avatars offered in the setup sheet.
 *
 * Only models committed to the repository, because this list has to be true
 * in a deployment and `public/models` is otherwise staged at build time and
 * ignored. Anything else arrives by upload or by being dropped on the page.
 */
const MODELS = [
  { label: "Avatar X", url: `${import.meta.env.BASE_URL}models/AvatarSample_X.vrm` },
  { label: "Avatar B", url: `${import.meta.env.BASE_URL}models/AvatarSample_B.vrm` },
] as const;

/**
 * Loaded at startup. The first entry, and the smaller of the two.
 *
 * It has to be a COMMITTED model. This used to be `avatar.vrm`, which is
 * gitignored and is not among the files `fetch-assets` stages, so it exists
 * only on the machine that exported it: a clean clone or any CI build had no
 * model at all and opened on a failed load. It worked locally for the same
 * reason the bug was invisible -- the file happened to be sitting there.
 */
const DEFAULT_MODEL = MODELS[0];

const POSTURES = ["sitting", "standing"] as const;

/**
 * Toolbar artwork and wording per expression.
 *
 * A Record rather than a list so the compiler requires every expression to
 * have a button: adding a sixth preset to EXPRESSIONS should fail to build
 * until it has an icon, not silently appear on the bar as a blank square or
 * not appear at all. The hotkey is not here either -- it is the position in
 * EXPRESSIONS, which is what ExpressionControl binds.
 */
const EXPRESSION_BUTTONS: Record<ExpressionName, { label: string; icon: IconName }> = {
  happy: { label: "Happy", icon: "happy" },
  angry: { label: "Angry", icon: "angry" },
  sad: { label: "Sad", icon: "sad" },
  relaxed: { label: "Relaxed", icon: "relaxed" },
  surprised: { label: "Surprised", icon: "surprised" },
};
/** Most use is at a desk, and it is the framing that needs no leg data. */
const DEFAULT_POSTURE: PostureMode = "sitting";

/**
 * How much harder the hips are smoothed in sitting posture.
 *
 * They sit at the frame boundary and feed the torso up-axis, so their noise
 * propagates into the whole upper body. Provisional (SPEC.md 15).
 */
const SITTING_HIP_CUTOFF_SCALE = 0.4;

/**
 * Gap between the camera preview and the latency readout beneath it.
 *
 * Here rather than in the stylesheet because it is only ever added to a
 * measured height, and a gap that lived in CSS would have to be cancelled
 * again whenever that height collapsed to zero.
 */
const PREVIEW_GAP_PX = 8;

/**
 * Decide where the tracker runs, once, at startup.
 *
 * Three tiers, in order of how much of SPEC.md 9.5's stall they move off the
 * render thread:
 *
 * 1. Worker with a transferred `MediaStreamTrackProcessor` stream. Camera
 *    frames never touch this thread.
 * 2. Worker fed `ImageBitmap`s from here. Leaves a GPU-side frame grab
 *    behind but still moves the inference and its readback.
 * 3. Everything on this thread, as it shipped before. Required rather than
 *    tolerated: a browser that cannot start a worker has to keep tracking
 *    rather than fail (SPEC.md 4.1).
 *
 * The worker's own failure modes are reported, not guessed at -- it answers
 * `ready` once it has its asset urls, or `fatal` if it cannot run -- because
 * "a worker exists" and "MediaPipe opened a GL context inside it" are
 * different questions and only the second one matters.
 */
async function chooseHost(): Promise<TrackingHost> {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    console.info("tracker: no worker or no OffscreenCanvas, running on the main thread");
    return new LocalTrackingHost();
  }

  try {
    const worker = new Worker(
      new URL("./tracker/worker/trackerWorker.ts", import.meta.url),
      { type: "module" },
    );
    const host = new WorkerTrackingHost(worker);
    const { ok, reason } = await host.start();
    if (ok) {
      console.info(
        hasStreamTransport()
          ? "tracker: in a worker, frames by transferred stream"
          : "tracker: in a worker, frames by ImageBitmap",
      );
      return host;
    }
    console.warn(`tracker: worker unusable (${reason ?? "unknown"}), falling back`, reason);
    host.dispose();
  } catch (err) {
    console.warn("tracker: worker could not be started, falling back", err);
  }

  return new LocalTrackingHost();
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  const ui = document.querySelector<HTMLElement>("#ui");
  if (!canvas || !ui) throw new Error("missing #stage canvas or #ui container");

  // Dev affordance only: makes the transparent canvas visible while working.
  document.body.dataset["bg"] = "checker";

  const stage = new Stage(canvas);
  const camera = new Camera();
  /*
   * Sampled from the preview's frame callback rather than from the tracker,
   * so the figure survives the tracker moving off this thread (SPEC.md 4.1).
   */
  const captureDelay = new CaptureDelay();
  /*
   * Everyone starts on pose, once, including people who already have
   * `holistic` stored from before it was a choice (SPEC.md 11).
   *
   * Reaching them is the whole point. A stored `holistic` is almost never a
   * decision -- it is the old default, written by every visit that ever
   * touched the control -- and leaving it alone would mean the people most
   * affected by a 288ms inference are the only ones the new default never
   * reaches. They are moved once; whatever they pick next is theirs.
   */
  if (once("backend-default-pose")) writeSetting("backend", "pose");

  /*
   * Face blendshapes force the CPU delegate, so that choice is made when the
   * tracker is built and changing it rebuilds (see HolisticTrackerOptions).
   *
   * `backend` is remembered for the same reason `delegate` is, and one more:
   * it is now the desktop that pays for a wrong guess, since switching back
   * to Holistic costs its 13MB on top of the 9MB already fetched (SPEC.md
   * 9.5). Paying that once is the trade; paying it every visit is not.
   */
  const trackerConfig = {
    backend: readSetting<TrackerBackend>("backend", TRACKER_BACKENDS, "pose"),
    faceBlendshapes: false,
    /*
     * Remembered, because the whole point is to compare devices: the phone
     * and the desktop want different answers and re-choosing on every load
     * would make a measurement session tedious enough to skip (SPEC.md 9.4).
     */
    delegate: readSetting<DelegatePreference>(
      "delegate",
      DELEGATE_PREFERENCES,
      "auto",
    ),
  };
  /*
   * Where the tracker runs is decided once, here, and reported rather than
   * assumed (SPEC.md 4.1). The worker is the point of the exercise; the
   * main-thread host is what runs when it cannot be started at all, which
   * 4.1 requires rather than merely tolerates.
   */
  const host: TrackingHost = await chooseHost();
  /*
   * Rebuilding is how a backend or face-blendshape change takes effect: both
   * are fixed when the graph is built, so neither can be flipped on a tracker
   * that is already running (see HolisticTrackerOptions).
   */
  const rebuildTracker = (): void => {
    void host.use({ ...trackerConfig });
  };

  /*
   * What face and finger tracking were before body-only turned them off.
   *
   * Remembered rather than discarded: pose supplies neither, so both have to
   * go off, but coming back should not silently cost settings the user never
   * chose to turn off.
   */
  let suspended: { faceBlendshapes: boolean; fingers: boolean } | null = null;

  const setBackend = (value: TrackerBackend): void => {
    if (value === trackerConfig.backend) return;
    trackerConfig.backend = value;
    writeSetting("backend", value);

    if (value === "pose") {
      suspended = {
        faceBlendshapes: trackerConfig.faceBlendshapes,
        fingers: solver.options.fingers,
      };
      // Before the rebuild: faceBlendshapes is read when the graph is built.
      trackerConfig.faceBlendshapes = false;
      solver.options.fingers = false;
    } else if (suspended) {
      trackerConfig.faceBlendshapes = suspended.faceBlendshapes;
      solver.options.fingers = suspended.fingers;
      suspended = null;
    }
    rebuildTracker();
  };
  const banner = new StatusBanner(ui);
  const overlay = new Overlay2D(ui);

  /*
   * The camera preview and the landmarks drawn over it, shown or hidden
   * together: they are one thing on screen, and landmarks floating over
   * nothing is not a view anyone wants.
   *
   * Hidden by attribute rather than by display, because the tracking loop
   * runs on requestVideoFrameCallback on this element and a browser need not
   * present frames for an element it is not laying out. See the stylesheet.
   */
  let previewVisible = true;
  const applyPreview = (visible: boolean): void => {
    previewVisible = visible;
    for (const el of [camera.element, overlay.element]) {
      if (visible) delete el.dataset["hidden"];
      else el.dataset["hidden"] = "";
    }
    // The latency readout sits under the preview and has to come back up to
    // the corner when there is no longer a preview to sit under. Hiding is by
    // opacity, so the box stays and CSS cannot work this out for itself.
    syncPreviewStack();
  };
  const latencyHud = new LatencyHud(ui);

  /*
   * Capture to render, in ms (SPEC.md 9.2).
   *
   * Three terms. The camera's own delay, which the tracker measures because
   * nothing downstream can see it; the age of the pose being rendered, which
   * covers inference, solving and the lookahead buffer in one, since the pose
   * carries the timestamp of the frame it came from; and nothing else, because
   * the remaining term is OBS's encode and this page cannot observe it.
   *
   * So it is a floor, not the whole chain. The readout says as much when the
   * browser will not report the camera's share.
   */
  const latency = (): { ms: number; partial: boolean } => {
    const stamp = interpolator.current.timestampMs;
    if (stamp <= 0) return { ms: 0, partial: false };

    return {
      ms: performance.now() - stamp + captureDelay.ms,
      partial: !captureDelay.available,
    };
  };

  const stickFigure = new StickFigure();
  stage.scene.add(stickFigure.object);

  const solver = new PoseSolver();
  solver.options.posture = readSetting<PostureMode>("posture", POSTURES, DEFAULT_POSTURE);
  const pose = createAvatarPose();
  // The rig is driven from the interpolator's pose, not the solver's, so it
  // moves at render rate rather than in 30Hz steps.
  // Holds a few solved poses so the renderer can filter with the future as
  // well as the past, which is the only way to reject a one-frame spike
  // rather than follow it (SPEC.md 6.1).
  const poseBuffer = new PoseBuffer();
  const interpolator = new PoseInterpolator();
  const blink = new Blink();
  const mic = new MicLevel();
  /*
   * The microphone switch lives here rather than in either surface showing
   * it. The toolbar is its only control, but the persisted setting outlives
   * any widget, and starting the microphone has to wait until the lip sync
   * wiring has registered the handler that turns a permission failure into a
   * banner.
   */
  let micEnabled = readSetting<"on" | "off">("lipsync", ["on", "off"], "off") === "on";
  const applyMic = (on: boolean): void => {
    micEnabled = on;
    writeSetting("lipsync", on ? "on" : "off");
    if (on) void mic.start();
    else mic.stop();
  };
  const mouth = new Mouth();
  const faceSolver = new FaceSolver();
  const expressions = new ExpressionControl();
  expressions.bindKeys();
  const calibrator = new VowelCalibrator();
  let calibration: VowelCalibration | null = readJson("vowels", validateCalibration);
  let vowelRefs = calibration ? referencePoints(calibration) : null;
  const vowelWeights = new Map<string, number>();
  let micState = "off";
  mic.onState((s) => {
    micState = s.kind === "error" ? `error: ${s.message}` : s.kind;
  });
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

  // Hand landmarks, on the frames Holistic finds a hand. Filtered with
  // their own profile: they are the noisiest input and feed the most
  // depth-sensitive derivation in the solver.
  const handFilters = {
    left: makeHandFilter(),
    right: makeHandFilter(),
  };
  const handFiltered = {
    left: new Float32Array(HAND_LANDMARK_COUNT * 3),
    right: new Float32Array(HAND_LANDMARK_COUNT * 3),
  };
  const handWorld = {
    left: new Float32Array(HAND_LANDMARK_COUNT * 3),
    right: new Float32Array(HAND_LANDMARK_COUNT * 3),
  };
  const handImage = {
    left: new Float32Array(HAND_LANDMARK_COUNT * 2),
    right: new Float32Array(HAND_LANDMARK_COUNT * 2),
  };
  const handInput: { left: HandInput; right: HandInput } = {
    left: { world: handWorld.left, image: handImage.left },
    right: { world: handWorld.right, image: handImage.right },
  };
  const handPoints: { left: HandInput | null; right: HandInput | null } = {
    left: null,
    right: null,
  };

  // Mirrored by default: the usual VTubing preference, and the only place
  // the choice is applied is mpToThree (SPEC.md 5.1).
  const view = { mirror: true, compareOffset: 0.55 };

  // Preview dimensions, observed rather than read per frame -- a
  // getBoundingClientRect inside the draw loop would thrash layout. The box
  // is sized against the viewport, so these change on a rotation or a window
  // resize and not only when a camera comes up.
  let previewW = 0;
  let previewH = 0;

  /*
   * How far the latency readout drops to clear the preview, as the stylesheet
   * expects it (SPEC.md 9.2). Zero when there is no preview to clear, so the
   * readout returns to the top corner rather than floating under a gap --
   * which is also exactly where it sat before the preview moved up there.
   *
   * One writer for both inputs, size and visibility, because two places
   * setting the same property independently is how one of them ends up
   * holding a figure the other has already invalidated.
   */
  const syncPreviewStack = (): void => {
    const stack = previewVisible && previewH > 0 ? previewH + PREVIEW_GAP_PX : 0;
    document.body.style.setProperty("--preview-stack", `${stack}px`);
  };

  /*
   * One observer for the life of the page, rather than a measurement taken
   * when a camera comes up. The box used to be a constant 240px, so reading
   * it once was enough; now that it is capped against the viewport, a
   * rotation or a window resize changes it, and a stale figure would leave
   * the landmark overlay drawn at the wrong scale over the picture it is
   * describing.
   *
   * The border box, matching what the overlay's own fixed position covers.
   * Zero-sized entries are ignored: the element reports one before a stream
   * is attached, and the draw path already treats a zero width as "not
   * measured yet".
   */
  new ResizeObserver(() => {
    const rect = camera.element.getBoundingClientRect();
    if (rect.width <= 0) return;
    previewW = rect.width;
    previewH = rect.height;
    overlay.resize(rect.width, rect.height);
    syncPreviewStack();
  }).observe(camera.element);

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
      inferenceMs: host.snapshot.inferenceMs,
      latencyMs: latency().ms,
      lookaheadMs: poseBuffer.latencyMs,
      backend: host.snapshot.backend,
      delegate: host.snapshot.delegate,
      confidence: interpolator.current.confidence,
      mic: micState,
    }),
  });

  // Held from the tracker callback so the render loop can read it: face
  // expressions are generated at render rate like blink, not carried through
  // the solver, which only deals in bone rotations.
  let latestFace: FaceFrame | null = null;

  host.onFrame((frame) => {
    latestFace = frame.face;
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
      handFilters.left.apply(handFiltered.left, sourceLeft.world, frame.timestampMs);
      handToThree(handWorld.left, handFiltered.left, view.mirror);
      mirrorHandImage(handImage.left, sourceLeft.image, view.mirror);
      handPoints.left = handInput.left;
    } else {
      // Reset on loss, or re-acquisition blends in a hand position from
      // before the gap.
      handFilters.left.reset();
      handPoints.left = null;
    }
    if (sourceRight?.present) {
      handFilters.right.apply(handFiltered.right, sourceRight.world, frame.timestampMs);
      handToThree(handWorld.right, handFiltered.right, view.mirror);
      mirrorHandImage(handImage.right, sourceRight.image, view.mirror);
      handPoints.right = handInput.right;
    } else {
      handFilters.right.reset();
      handPoints.right = null;
    }

    mirrorImagePoints(imagePoints, frame.image, view.mirror);
    solver.solve(points, visibility, pose, frame.timestampMs, handPoints, imagePoints);
    pose.timestampMs = frame.timestampMs;

    poseBuffer.push(pose);
    interpolator.setTarget(poseBuffer.output);
  });

  panel.addViewToggle("landmarks", true, (v) => overlay.setVisible(v));
  /*
   * Off by default, like the rig. It is ground truth for the solver -- what
   * the tracker reported, before any avatar mapping -- which made it worth
   * having on screen while the solver was being built and makes it clutter
   * beside a working avatar. It sits off to one side (see
   * applyCompareOffset), so leaving it on also means the scene opens with
   * two figures in it when the user asked for one.
   */
  panel.addViewToggle("stickFigure", false, (v) => stickFigure.setVisible(v));
  // Off by default once an avatar loads; the rig stays one click away as the
  // reference for whether a fault is in the mapping or the solver.
  panel.addViewToggle("debugRig", true, (v) => debugRig.setVisible(v));
  panel.addViewToggle("avatar", true, (v) => avatarSlot.setVisible(v));
  panel.addViewToggle("latency", true, (v) => latencyHud.setVisible(v));
  // mirror is in the setup sheet: a performer's choice, not a diagnostic.

  applyCompareOffset(view.compareOffset, stickFigure, debugRig);
  /*
   * `setup` is declared below this line. The closure is safe because a drop
   * cannot happen until the page is interactive, long after boot returns --
   * but it is a temporal dead zone, so anything that ever calls this handler
   * during startup would throw rather than misbehave quietly.
   */
  wireAvatar(avatarSlot, stage, banner, debugRig, (file) => setup.useFile(file));
  wireSolverControls(panel, solver, view, stickFigure, debugRig);
  wireFilterControls(panel, filter, handFilters);
  wireMotionControls(panel, interpolator, poseBuffer);
  wireLivelinessControls(panel, solver, blink);
  // Raw values, not the remapped ones: the range is set by watching what the
  // model actually reports while blinking, which is rarely close to 1.
  // Raw gaze as well as the angle: the angle is what the model is asked for,
  // but it is gained and clamped, so a pinned 90 and a healthy signal look
  // identical from it. The raw pair is what gazeGain is set against.
  panel.addReadoutGroup("Face",
    ["blinkL", "blinkR", "rawGazeX", "rawGazeY", "gazeYaw", "gazePitch"], () => [
      faceSolver.rawBlink.left,
      faceSolver.rawBlink.right,
      faceSolver.rawGaze.x,
      faceSolver.rawGaze.y,
      faceSolver.gaze.yaw,
      faceSolver.gaze.pitch,
    ], 2);

  wireExpressionControls(panel, expressions);
  wireFaceControls(panel, faceSolver);
  wireLipSync(panel, banner, mic, mouth, calibrator, () => {
    calibration = null;
    vowelRefs = null;
    console.info("vowels: calibration forgotten");
  });
  // After wireLipSync, so a permission failure has a banner handler to land in.
  if (micEnabled) applyMic(true);
  wireTrackingReadouts(panel, solver);
  wireTrackerControls(panel, trackerConfig, host, rebuildTracker);
  // Visible so a correction is something you can see happening rather than
  // infer from the avatar looking right.
  panel.addReadoutGroup(
    "Depth flip",
    ["left", "right"],
    () => [solver.isDepthFlipped("left") ? 1 : 0, solver.isDepthFlipped("right") ? 1 : 0],
    0,
  );
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
  const setPosture = (posture: PostureMode): void => {
    writeSetting("posture", posture);
    applyPosture(posture);
  };

  /*
   * Setup, as opposed to diagnosis (SPEC.md 9.1). Everything a first run
   * depends on and nothing that does not: these were in the debug panel,
   * where a camera picker meant an unusable app whose fix could not be found.
   */
  const setup = new SetupSheet(ui, {
    models: MODELS,
    listCameras: () => camera.listDevices(),
    currentCamera: () => (camera.state.kind === "ready" ? camera.state.deviceId : ""),
    onCamera: (deviceId) => void camera.start(deviceId),
    onModel: (url, label) => void avatarSlot.load(url, label),
    onUpload: (buffer, name) => void avatarSlot.load(buffer, name),
    onBackground: (mode) => {
      // "transparent" removes the attribute entirely so nothing paints behind
      // the canvas -- what OBS capture actually sees.
      if (mode === "transparent") delete document.body.dataset["bg"];
      else document.body.dataset["bg"] = mode;
    },
    onMirror: (on) => {
      view.mirror = on;
    },
    mirror: () => view.mirror,
    /*
     * Through the base, like every other runtime asset: the site is served
     * from a subpath, so an absolute "/docs/" would leave it (see vite.config).
     *
     * Named down to index.html rather than left as a directory. Every server
     * this runs on resolves "docs/" now -- Pages by redirect, both Vite servers
     * through the docsDirectoryIndex plugin -- but naming the file depends on
     * none of them, and this link is the one path to the documentation that has
     * to work wherever the app is opened from.
     */
    docsUrl: `${import.meta.env.BASE_URL}docs/index.html`,
  });

  /*
   * The performer surface (SPEC.md 9.1).
   *
   * Everything on it was in the debug panel and has been moved out rather
   * than duplicated into both. Two widgets over one piece of state is how
   * they end up disagreeing about it, and the panel keeps the hundred
   * controls that are set once.
   */
  const toolbar = new Toolbar(ui, [
    {
      kind: "toggle",
      label: "Setup",
      tip: "Camera, avatar, background and mirror.",
      icon: "setup",
      // No separate "off" artwork: the lit state already says it is open.
      get: () => setup.isOpen,
      set: () => {
        setup.toggle();
        // The sheet opens where the tooltip sits, and the pointer is still
        // over the button, so the tooltip would land on top of it.
        toolbar.dismissTip();
      },
    },
    "divider",
    {
      kind: "toggle",
      label: "Camera preview",
      tip: "Shows the camera and the landmarks over it. Tracking is unaffected either way.",
      icon: "eye",
      iconOff: "eyeOff",
      get: () => previewVisible,
      set: applyPreview,
    },
    "divider",
    {
      kind: "toggle",
      label: "Microphone",
      tip: "Drives the mouth from your voice. Nothing is recorded or sent anywhere.",
      icon: "mic",
      iconOff: "micOff",
      get: () => micEnabled,
      set: applyMic,
    },
    {
      /*
       * Which backend runs. Not a quality setting -- Holistic tracks better
       * on every axis including the body -- but a cost one: a phone spends
       * 288ms per inference where a desktop spends 20ms, and the hands and
       * face are three of Holistic's five sub-graphs (SPEC.md 9.5, 11).
       *
       * A cycle, not a toggle, for the reason CycleItem gives: there is no
       * "off" to darken into. Tracking everything and tracking a body are
       * both real states, and dimming one of them would claim otherwise.
       *
       * Placed immediately before the two controls it governs, so the bar
       * reads left to right as the mode and then what the mode allows.
       */
      kind: "cycle",
      label: "Tracking",
      tip: "Body only drops the hands and face, which is most of the cost on a slow device. Loads a different model, so expect a pause.",
      states: [
        { value: "holistic", label: "full", icon: "tracking" },
        { value: "pose", label: "body only", icon: "trackingBody" },
      ],
      get: () => trackerConfig.backend,
      set: (value: string) => setBackend(value as TrackerBackend),
    },
    {
      kind: "toggle",
      label: "Face tracking",
      // Said plainly, because it is not free: the hitch on toggling it would
      // otherwise look like a fault.
      tip: "Blink and gaze from the camera. Rebuilds the tracker and puts the whole pipeline on the CPU, so expect a pause and a lower frame rate.",
      icon: "face",
      iconOff: "faceOff",
      get: () => trackerConfig.faceBlendshapes,
      set: (on: boolean) => {
        trackerConfig.faceBlendshapes = on;
        rebuildTracker();
      },
      /*
       * Asked of the running tracker rather than of the stored backend, so
       * the control stays live for as long as a capable graph is still
       * serving frames -- `use` keeps the old backend until the new one has
       * loaded, and greying a button over a tracker that is still working
       * would be a lie for the length of a model download.
       */
      disabled: () =>
        host.snapshot.ready && !host.snapshot.tracksFace
          ? "Body-only tracking has no face model to read blink or gaze from."
          : null,
    },
    {
      kind: "toggle",
      label: "Finger tracking",
      // Experimental, and the tooltip says why rather than leaving the word
      // to be interpreted.
      tip: "Articulates the fingers from the hand landmarks. Experimental: it also makes tracking jitter easier to see.",
      icon: "fingers",
      iconOff: "fingersOff",
      get: () => solver.options.fingers,
      set: (on: boolean) => {
        solver.options.fingers = on;
      },
      disabled: () =>
        host.snapshot.ready && !host.snapshot.tracksHands
          ? "Body-only tracking supplies no hand landmarks to articulate."
          : null,
    },
    {
      /*
       * Posture is a manual choice, not a detected one (SPEC.md 5.8).
       * Detecting it would mean reading leg visibility, but the tracker
       * reports confident visibility for hallucinated out-of-frame legs --
       * the exact failure being worked around -- so deciding with that signal
       * is circular.
       */
      kind: "cycle",
      label: "Posture",
      tip: "Sitting ignores the legs and frames the upper body. Standing tracks the whole figure.",
      states: [
        { value: "sitting", label: "sitting", icon: "sitting" },
        { value: "standing", label: "standing", icon: "standing" },
      ],
      get: () => solver.options.posture,
      set: (value: string) => setPosture(value as PostureMode),
    },
    "divider",
    {
      kind: "group",
      // Neutral is a real answer, so clicking the lit expression returns to
      // it rather than needing a sixth button for it.
      allowNone: true,
      /*
       * Five buttons is the widest thing on the bar, and the bar does not get
       * to choose the width of the screen it is on. Below the room it needs
       * they fold into this one, which opens them above the bar -- and which
       * wears whichever expression is active, so folding costs the readout
       * nothing. Last on the bar, so it is the run nearest the edge that
       * disappears first.
       */
      collapsed: {
        label: "Expression",
        tip: "Opens the five expressions. Shown as a single button because the bar is too narrow for all of them.",
        icon: "expression",
      },
      // Order and hotkeys come from EXPRESSIONS, which is what the keys are
      // bound to, so the bar cannot disagree with the keyboard about which
      // number is which expression.
      options: EXPRESSIONS.map((name: ExpressionName, i: number) => ({
        value: name,
        label: EXPRESSION_BUTTONS[name].label,
        tip: "Click again for neutral.",
        key: String(i + 1),
        icon: EXPRESSION_BUTTONS[name].icon,
      })),
      get: () => expressions.active,
      set: (value: string | null) => expressions.set(value as ExpressionName | null),
    },
  ]);

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
        poseBuffer.reset();
        // A new stream can be a different camera, whose delay is its own.
        captureDelay.reset();
        ui.append(camera.element);
        camera.element.style.display = "";
        /*
         * The stylesheet caps the preview against the viewport and needs the
         * camera's aspect ratio to express the height cap as a width. A new
         * stream can be a different camera with a different shape, so this is
         * set per ready rather than once.
         */
        if (s.height > 0) {
          camera.element.style.setProperty("--preview-ar", String(s.width / s.height));
        }
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

  // Only the things reached most often stay open; everything else is one
  // click away rather than below the fold.
  // Clearing takes effect on the next load, since values already read are
  // held in memory. Said plainly rather than worked around, because reloading
  // is the point: the reason to clear is to see a genuine first run.
  panel.addSessionAction("clear saved settings", () => {
    const removed = clearAllSettings();
    console.info("settings: cleared", removed);
    banner.show(
      "info",
      removed.length === 0
        ? "Nothing was saved."
        : `Cleared ${removed.join(", ")}. Reload for a first-run view.`,
      { label: "Reload", run: () => location.reload() },
    );
  });

  /*
   * Folders collapsed, and then the whole panel collapsed over them, so it
   * opens tidy for whoever does need it and stays out of the way of everyone
   * else (SPEC.md 9.1). Stats is left open because it is the one folder that
   * answers "is this working", which is the question someone opening the
   * panel at all is most likely to have.
   */
  panel.collapseAllExcept(["Stats"]);
  panel.collapse();

  // Started once, not per camera-ready: the video element is stable across
  // restarts, so starting a chain per state change would leave the old one
  // running and double the reported rate.
  countCameraFrames(camera.element, cameraFps, captureDelay);

  // A fatal inference failure stops tracking; without this the only symptom
  // is a live camera driving a motionless avatar.
  let reportedError: string | null = null;
  stage.onFrame(({ dt }) => {
    const trackerError = host.snapshot.lastError;
    if (trackerError && trackerError !== reportedError) {
      reportedError = trackerError;
      banner.show("error", `Tracking stopped: ${trackerError}`);
    }

    renderFps.tick();
    interpolator.step(dt);

    // Written after step(), which copies expressions from the target: these
    // are generated here at render rate, not carried from the solver.
    // Face first, so a tracked blink is in place before the procedural one
    // would overwrite it.
    const face = latestFace;
    if (face?.present) {
      faceSolver.update(face.scores, view.mirror, dt, interpolator.current.expressions);
      avatarSlot.setGaze(faceSolver.gaze.yaw, faceSolver.gaze.pitch);
    }

    // The timer remains the fallback whenever the camera is not supplying
    // blinks: a frozen stare reads worse than a wrong blink rate.
    if (!faceSolver.drivingBlink || !face?.present) {
      interpolator.current.expressions.set(BLINK_EXPRESSION, blink.update(dt));
    }

    // Energy is read at the moment the body is rendering, not the newest
    // sample, so the mouth does not lead a body delayed by the lookahead
    // buffer (SPEC.md 6.1).
    mic.update(dt, performance.now());

    // Calibration consumes frames rather than the mouth, so the avatar holds
    // still while the speaker is holding a vowel for the microphone.
    const finished = calibrator.update(mic.vowelPoint, mic.speaking, dt);
    if (finished) {
      calibration = finished;
      vowelRefs = referencePoints(finished);
      writeJson("vowels", finished);
      banner.hide();
      console.info("vowels: calibrated", finished);
    }

    if (vowelRefs && mouth.params.mode === "vowel") {
      blendVisemes(mic.vowelPoint, vowelRefs, vowelWeights);
    }

    mouth.update(
      mic.sampleAt(interpolator.current.timestampMs),
      dt,
      interpolator.current.expressions,
      vowelRefs ? vowelWeights : null,
    );

    // Last of the expression writers, so a chosen expression wins over
    // anything the camera or microphone put on the face.
    expressions.update(dt, interpolator.current.expressions);

    // Pull-based, like the panel readouts: an expression may have been set by
    // a number key, so the bar reads its own state rather than every owner
    // having to announce a change.
    toolbar.render();

    const { ms, partial } = latency();
    // Stale-aware, so a stopped camera reads as nothing arriving rather than
    // freezing on the last rate it managed.
    latencyHud.update(ms, cameraFps.staleAfter(1000), partial);

    if (calibrator.running) banner.show("info", calibrationMessage(calibrator));

    debugRig.apply(interpolator.current);

    // apply() writes the normalised pose; update() drives spring bones and
    // copies it onto the raw rig, so the order matters.
    avatarSlot.apply(interpolator.current);
    avatarSlot.update(dt);

    panel.update();
  });
  stage.start();

  void startPipeline(camera, host, banner, trackerConfig.backend);
}

/**
 * The model is 14MB, so the first load is a real wait. The banner reports it
 * rather than leaving the page looking broken while nothing happens.
 */
async function startPipeline(
  camera: Camera,
  host: TrackingHost,
  banner: StatusBanner,
  backend: TrackerBackend,
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

  /*
   * The stored backend, not a hardcoded one. This said "holistic" while the
   * default moved to pose (8a7a4b8), so the first load built a tracker
   * nobody asked for and the control then rebuilt it -- two model downloads
   * on the device least able to afford either (SPEC.md 9.5, 11).
   */
  await host.use({ backend, faceBlendshapes: false, delegate: readSetting<DelegatePreference>("delegate", DELEGATE_PREFERENCES, "auto") });
  await camera.start();
}

/**
 * Separates the debug references from the avatar so they can be compared
 * side by side.
 *
 * The avatar does NOT move. It is the output, the camera is aimed at the
 * origin, and the canvas is what OBS captures -- so offsetting it puts the
 * subject off centre in the actual capture, which it did: the avatar started
 * 0.55m to the right and had to be dragged back every session. It was one of
 * three specimens being compared when this was written, and is not any more.
 *
 * The references move around it instead, which costs nothing because they are
 * dev affordances with their own visibility toggles.
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
  onDropped: (file: File) => void,
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

  // Routed through the sheet rather than straight to the avatar, so a dropped
  // file joins the list and can be chosen again -- the same path the upload
  // button takes, because to a user they are the same action.
  enableVrmDrop(document.body, onDropped);

  void avatarSlot.load(DEFAULT_MODEL.url, DEFAULT_MODEL.label);
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
  folder.add(solver.options, "maxTwistDegrees", 20, 180, 5).name("max twist (deg)");

  // Compensates for the tracker inverting a hand's depth (SPEC.md 5.6.2).
  // On by default but switchable, since it targets a specific failure of one
  // model and a tracker without it would not need the correction.
  folder.add(solver.options, "correctHandDepthFlip").name("fix hand depth flip");
  // Switchable so the hallucinated-leg behaviour can be seen for what it is,
  // which is the only way to tell the guard is doing anything.
  folder.add(solver.options, "rejectRaisedLegs").name("ignore raised legs");
  folder.add(solver.options, "flipMinArea", 0, 0.5, 0.01).name("flip: min area");
  folder.add(solver.options, "flipHysteresis", 1, 10, 1).name("flip: frames");
  folder.add(solver.options, "useHandLandmarks").name("use palm frame");
  // Fingers are on the toolbar, not here: turning them off is something you
  // do mid-stream when they misbehave, and nothing is in both places
  // (SPEC.md 9.1). They still need the palm frame above: the three knuckle
  // estimates the pose model leaves behind cannot say anything about a finger.

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
    // Moves the stick figure and the rig apart; the avatar stays centred.
    .name("compare offset")
    .onChange((v: number) => applyCompareOffset(v, stickFigure, debugRig));
}

/**
 * The filter can be switched off from here, which matters: the stick figure
 * has to be judged against both the raw and smoothed signal, or the noise
 * floor gets mistaken for a solver fault.
 */
function wireFilterControls(
  panel: DebugPanel,
  filter: LandmarkFilter,
  handFilters: { left: LandmarkFilter; right: LandmarkFilter },
): void {
  const folder = panel.folder("Filter");
  folder.add(filter, "enabled");
  folder.add(filter.xy, "minCutoff", 0.1, 5, 0.1).name("xy: minCutoff");
  folder.add(filter.xy, "beta", 0, 0.5, 0.01).name("xy: beta");
  folder.add(filter.z, "minCutoff", 0.1, 5, 0.1).name("z: minCutoff");
  folder.add(filter.z, "beta", 0, 0.5, 0.01).name("z: beta");

  // Both hands share one set of controls; tuning them apart would only
  // produce an asymmetry nobody wants.
  const hands = { minCutoff: DEFAULT_HAND_XY_PARAMS.minCutoff, zMinCutoff: DEFAULT_HAND_Z_PARAMS.minCutoff };
  const applyHands = (): void => {
    for (const f of [handFilters.left, handFilters.right]) {
      f.xy.minCutoff = hands.minCutoff;
      f.z.minCutoff = hands.zMinCutoff;
    }
  };
  folder.add(hands, "minCutoff", 0.1, 3, 0.05).name("hand xy: minCutoff").onChange(applyHands);
  folder.add(hands, "zMinCutoff", 0.05, 3, 0.05).name("hand z: minCutoff").onChange(applyHands);
}

/** Hands get their own profile; see DEFAULT_HAND_XY_PARAMS for why. */
function makeHandFilter(): LandmarkFilter {
  const f = new LandmarkFilter(HAND_LANDMARK_COUNT);
  f.xy = { ...DEFAULT_HAND_XY_PARAMS };
  f.z = { ...DEFAULT_HAND_Z_PARAMS };
  return f;
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

/**
 * Inference rate caps offered in the panel, as strings so a stored value can
 * be validated against the set (see readSetting). "0" is every camera frame.
 */
const INFERENCE_RATES = ["0", "5", "10", "15", "20", "24", "30"] as const;
type InferenceRate = (typeof INFERENCE_RATES)[number];

const INFERENCE_RATE_OPTIONS: Record<string, InferenceRate> = {
  "every frame": "0",
  "5 Hz": "5",
  "10 Hz": "10",
  "15 Hz": "15",
  "20 Hz": "20",
  "24 Hz": "24",
  "30 Hz": "30",
};

/**
 * The tracker's own cost controls (SPEC.md 9.4).
 *
 * Separate from the Tracking folder, which reports what the solver is doing
 * with the landmarks. These decide what producing them costs, and they are
 * the two numbers a slow device is diagnosed with.
 */
function wireTrackerControls(
  panel: DebugPanel,
  config: { delegate: DelegatePreference },
  host: TrackingHost,
  rebuild: () => void,
): void {
  const folder = panel.folder("Tracker");
  folder
    .add(config, "delegate", DELEGATE_PREFERENCES as DelegatePreference[])
    .name("delegate")
    .onChange((value: DelegatePreference) => {
      writeSetting("delegate", value);
      // The delegate is chosen when the graph opens, so this cannot be
      // applied to a running tracker (see HolisticTrackerOptions).
      rebuild();
    });

  /*
   * A fixed set rather than a slider. This gets reached for on a phone, where
   * the panel is the only instrumentation available and dragging a lil-gui
   * slider to a particular value is a fight -- and the useful question is
   * which of a few rates is bearable, not what the exact number is.
   */
  const rate = {
    hz: readSetting<InferenceRate>("inferenceHz", INFERENCE_RATES, "0"),
  };
  host.maxInferenceHz = Number(rate.hz);
  folder
    .add(rate, "hz", INFERENCE_RATE_OPTIONS)
    .name("max inference")
    .onChange((value: InferenceRate) => {
      writeSetting("inferenceHz", value);
      // Applied to the host, not the tracker: a rebuild would otherwise drop
      // it (see TrackerHost.maxInferenceHz).
      host.maxInferenceHz = Number(value);
    });
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

/**
 * Guards a stored calibration before it is trusted.
 *
 * Stored values outlive the code that wrote them, and a malformed one would
 * otherwise reach the blend as NaN and silently stop the mouth moving at all.
 */
function validateCalibration(raw: unknown): VowelCalibration | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const corner = (key: string): { f1: number; f2: number } | null => {
    const v = record[key];
    if (typeof v !== "object" || v === null) return null;
    const { f1, f2 } = v as Record<string, unknown>;
    if (typeof f1 !== "number" || typeof f2 !== "number") return null;
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) return null;
    return { f1, f2 };
  };
  const aa = corner("aa");
  const ee = corner("ee");
  const ou = corner("ou");
  return aa && ee && ou ? { aa, ee, ou } : null;
}

/** What the banner says while a vowel is being held. */
function calibrationMessage(calibrator: VowelCalibrator): string {
  const state = calibrator.state;
  if (state.kind !== "capturing") return "";
  const index = CALIBRATION_STEPS.indexOf(state.step) + 1;
  const bar = "#".repeat(Math.round(state.progress * 10)).padEnd(10, ".");
  return `Calibrating ${index}/${CALIBRATION_STEPS.length} — ${STEP_PROMPTS[state.step]}  [${bar}]`;
}

/**
 * Lip sync is opt-in and remembered.
 *
 * Browsers refuse to start an AudioContext outside a user gesture, so this
 * cannot be requested at load even if it were wanted -- and requesting a
 * microphone from someone who only wanted body tracking would be rude. The
 * choice persists, so it is a one-time decision rather than a per-session one.
 */
function wireLipSync(
  panel: DebugPanel,
  banner: StatusBanner,
  mic: MicLevel,
  mouth: Mouth,
  calibrator: VowelCalibrator,
  onForget: () => void,
): void {
  const folder = panel.folder("Lip sync");

  mic.onState((s) => {
    if (s.kind === "error") banner.show("error", s.message);
    else if (s.kind === "on") banner.hide();
  });

  // Switching the microphone on is on the toolbar; everything here is how it
  // behaves once it is on.
  // The browser's own noise cancelling, applied live rather than on restart.
  // Suppression targets steady noise; transients still need the duration gate.
  const processing = folder.addFolder("Noise cancelling");
  for (const key of ["noiseSuppression", "echoCancellation", "autoGainControl"] as const) {
    processing.add(mic.processing, key).onChange(() => void mic.applyProcessing());
  }

  folder.add(mouth.params, "mode", ["amplitude", "animated", "vowel"]);
  folder.add(mouth.params, "openness", 0, 1, 0.05);

  // `vowel` mode needs the speaker's own triangle; without one it behaves as
  // `animated`, since there is no space to place anything in (SPEC.md 8.1).
  const vowels = folder.addFolder("Vowel calibration");
  vowels
    .add({ calibrate: () => calibrator.start() }, "calibrate")
    .name("record aa / ee / ou");
  vowels.add({ cancel: () => { calibrator.cancel(); banner.hide(); } }, "cancel");
  vowels
    .add({ forget: () => { clearSetting("vowels"); onForget(); } }, "forget")
    .name("forget calibration");
  folder.add(mic.params, "gain", 0.2, 6, 0.1).name("mic gain");
  folder.add(mic.params, "threshold", 1, 8, 0.1).name("noise gate");
  folder.add(mic.params, "release", 0.02, 0.4, 0.01).name("close time (s)");

  // Rejects transients only; sustained noise is the microphone's job, which
  // it does better than any envelope follower. 0 disables the gate entirely.
  folder.add(mic.gate.params, "onset", 0, 0.3, 0.01).name("min duration (s)");
  folder.add(mic.gate.params, "hangover", 0.02, 0.6, 0.01).name("hangover (s)");
  folder.add(mic.gate.params, "openLevel", 0, 0.5, 0.01).name("open level");
  folder.add(mouth.params, "minHold", 0.04, 0.3, 0.01).name("viseme min (s)");
  folder.add(mouth.params, "maxHold", 0.05, 0.5, 0.01).name("viseme max (s)");

  // A meter rather than a number to trust: the gate is set by watching this
  // sit near zero while silent and climb while speaking.
  panel.addReadoutGroup("Mic", ["level", "floor", "energy", "speaking"], () => [
    mic.level,
    mic.noiseFloor,
    mic.current,
    mic.speaking ? 1 : 0,
  ], 3);
}

/**
 * Blink and gaze only. Emotion was a guess and is now chosen by hand
 * (SPEC.md 13.2), so it lives in its own folder.
 */
function wireFaceControls(panel: DebugPanel, face: FaceSolver): void {
  const folder = panel.folder("Face");

  /*
   * Whether the tracker PRODUCES blendshapes is on the toolbar, not here: it
   * rebuilds the tracker and costs the GPU delegate for the whole pipeline,
   * which makes it something to switch off mid-stream when the frame rate
   * matters. What is left is what is done with the result, all of it free.
   */
  folder.add(face.params, "enabled").name("apply to avatar");
  folder.add(face.params, "trackBlink").name("blink from camera");
  folder.add(face.params, "trackGaze").name("gaze from camera");
  folder.add(face.params, "blinkSnap").name("blink is open/shut");
  folder.add(face.params, "blinkLow", 0, 1, 0.01).name("eyes open below");
  folder.add(face.params, "blinkHigh", 0, 1, 0.01).name("eyes shut above");
  folder.add(face.params, "blinkSpeed", 0, 0.3, 0.01).name("lid travel (s)");
  // Degrees the eyeball actually turns. Small: eye geometry is shallow and
  // the iris slides off it well before any anatomical limit (FaceParams).
  folder.add(face.params, "gazeRange", 0, 20, 0.5).name("gaze range (deg)");
  folder.add(face.params, "gazeGain", 1, 6, 0.1).name("gaze gain");
  folder.add(face.params, "gazeSmoothing", 0, 0.4, 0.01).name("gaze smoothing (s)");
}

/**
 * How the emotion presets behave, not which one is showing (SPEC.md 13.2).
 *
 * Choosing one is a performance decision and lives on the toolbar, where it
 * can be reached mid-stream. What stays here is the pair of settings nobody
 * touches twice.
 */
function wireExpressionControls(panel: DebugPanel, expressions: ExpressionControl): void {
  const folder = panel.folder("Expression");
  folder.add(expressions.params, "hotkeys").name("number keys (1-5)");
  folder.add(expressions.params, "fade", 0, 1, 0.01).name("fade (s)");
}

function wireMotionControls(
  panel: DebugPanel,
  interpolator: PoseInterpolator,
  poseBuffer: PoseBuffer,
): void {
  const folder = panel.folder("Motion");
  folder.add(interpolator, "enabled").name("interpolate");
  folder.add(interpolator, "tau", 0, 0.25, 0.005).name("tau (s)");

  // Each frame of lookahead costs one frame interval of latency, and the
  // Stats readout shows what that currently is. 0 is the old behaviour.
  folder.add(poseBuffer, "lookahead", 0, MAX_LOOKAHEAD, 1).name("lookahead (frames)");
}

/**
 * Counts real camera frames rather than render frames. Render rate says
 * nothing about whether the camera is delivering at the rate it claims.
 */
function countCameraFrames(
  video: HTMLVideoElement,
  meter: FpsMeter,
  captureDelay: CaptureDelay,
): void {
  if (!("requestVideoFrameCallback" in video)) return;

  /*
   * The capture delay rides along on this loop rather than running one of
   * its own. It is the same callback and the same metadata, and once the
   * tracker is in a worker this is the only place either is still visible
   * (SPEC.md 4.1).
   */
  const step = (
    now: DOMHighResTimeStamp,
    metadata?: VideoFrameCallbackMetadata,
  ): void => {
    meter.tick();
    captureDelay.sample(now, metadata);
    video.requestVideoFrameCallback(step);
  };
  video.requestVideoFrameCallback(step);
}

void boot();
