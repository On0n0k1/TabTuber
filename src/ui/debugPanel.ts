/*
 * Developer panel.
 *
 * SPEC.md section 13 lists a long tail of parameters that can only be settled
 * empirically -- filter constants, visibility thresholds, torso split ratios.
 * Those need to be adjustable while watching yourself move, so a real control
 * panel is load-bearing here rather than a nicety.
 *
 * Readouts are pull-based: the panel asks for values each frame instead of
 * the pipeline pushing into it, so no stage needs a reference to the UI.
 */

import GUI from "lil-gui";
import type { Camera, CameraDevice } from "../capture/camera.ts";
import type { Stage } from "../render/stage.ts";

export type BackgroundMode = "checker" | "key" | "transparent";

interface Readouts {
  renderFps: string;
  cameraFps: string;
  resolution: string;
  trackerFps: string;
  /** Inference time alone; `latency` is the end-to-end figure. */
  inference: string;
  /** Capture to render, the figure SPEC.md 9 budgets. Also on the canvas. */
  latency: string;
  lookahead: string;
  delegate: string;
  backend: string;
  mic: string;
  confidence: string;
}

export interface DebugPanelOptions {
  readonly stage: Stage;
  readonly camera: Camera;
  /** Sampled once per frame for the readouts. */
  readonly sample: () => {
    renderFps: number;
    cameraFps: number;
    trackerFps: number;
    inferenceMs: number;
    latencyMs: number;
    lookaheadMs: number;
    delegate: string;
    backend: string;
    mic: string;
    confidence: number;
  };
}

export class DebugPanel {
  private readonly gui = new GUI({ title: "virtual-avatar" });
  /**
   * Folders by title.
   *
   * Tracked here rather than read back from lil-gui, whose title lives on an
   * underscore-prefixed field. That is typed but internal, and a rename on a
   * dependency bump would make folders quietly stop collapsing rather than
   * fail loudly.
   */
  private readonly folders = new Map<string, GUI>();
  private readonly camera: Camera;
  private readonly stage: Stage;
  private readonly sample: DebugPanelOptions["sample"];

  private readonly readouts: Readouts = {
    renderFps: "-",
    cameraFps: "-",
    resolution: "-",
    trackerFps: "-",
    inference: "-",
    latency: "-",
    lookahead: "-",
    delegate: "-",
    backend: "-",
    mic: "off",
    confidence: "-",
  };

  private readonly view = {
    background: "checker" as BackgroundMode,
    helpers: true,
    preview: true,
  };

  /** Sampled groups added by other modules, refreshed each frame. */
  private readonly readoutGroups: { proxy: Record<string, string>; labels: readonly string[]; sample: () => readonly number[]; digits: number }[] = [];

  private readonly cameraFolder;
  private readonly sessionFolder: GUI;
  private readonly viewFolder: GUI;
  private deviceController: ReturnType<GUI["add"]> | null = null;
  private selectedDeviceId = "";

  constructor(opts: DebugPanelOptions) {
    this.stage = opts.stage;
    this.camera = opts.camera;
    this.sample = opts.sample;

    /*
     * Created first so it sits at the top of a long panel. Resetting is
     * reached for when something has been tuned into a confusing state, which
     * is exactly when hunting for the control is most irritating.
     */
    const session = this.folder("Session");
    session
      .add({ reset: () => this.resetControls() }, "reset")
      .name("reset panel to defaults");
    this.sessionFolder = session;

    const stats = this.folder("Stats");
    for (const key of Object.keys(this.readouts) as (keyof Readouts)[]) {
      stats.add(this.readouts, key).listen().disable();
    }

    this.cameraFolder = this.folder("Camera");
    this.cameraFolder
      .add({ restart: () => void this.camera.start(this.selectedDeviceId || undefined) }, "restart")
      .name("restart");

    this.viewFolder = this.folder("View");
    const view = this.viewFolder;
    view
      .add(this.view, "background", ["checker", "key", "transparent"])
      .onChange((mode: BackgroundMode) => {
        // "transparent" removes the attribute entirely so nothing paints
        // behind the canvas -- this is what OBS capture actually sees.
        if (mode === "transparent") delete document.body.dataset["bg"];
        else document.body.dataset["bg"] = mode;
      });
    view.add(this.view, "helpers").onChange((v: boolean) => {
      this.stage.helpersVisible = v;
    });
    view.add(this.view, "preview").onChange((v: boolean) => {
      this.camera.element.style.display = v ? "" : "none";
    });

    this.camera.onStateChange((s) => {
      if (s.kind === "ready") {
        this.readouts.resolution = `${s.width}x${s.height}`;
        void this.refreshDevices();
      } else if (s.kind !== "requesting") {
        this.readouts.resolution = "-";
      }
    });
  }

  /**
   * lil-gui dropdowns have a fixed option list, so a changed device set means
   * replacing the controller rather than mutating it.
   */
  private async refreshDevices(): Promise<void> {
    const devices: CameraDevice[] = await this.camera.listDevices();
    if (devices.length === 0) return;

    this.deviceController?.destroy();
    const options = Object.fromEntries(devices.map((d) => [d.label, d.deviceId]));
    this.selectedDeviceId ||= devices[0]?.deviceId ?? "";

    const proxy = { device: this.selectedDeviceId };
    this.deviceController = this.cameraFolder
      .add(proxy, "device", options)
      .name("device")
      .onChange((id: string) => {
        this.selectedDeviceId = id;
        void this.camera.start(id);
      });
  }

  /** Call once per rendered frame. */
  update(): void {
    const s = this.sample();
    this.readouts.renderFps = s.renderFps.toFixed(0);
    this.readouts.cameraFps = s.cameraFps > 0 ? s.cameraFps.toFixed(0) : "-";
    this.readouts.trackerFps = s.trackerFps > 0 ? s.trackerFps.toFixed(0) : "-";
    this.readouts.inference = s.inferenceMs > 0 ? `${s.inferenceMs.toFixed(1)} ms` : "-";
    this.readouts.latency = s.latencyMs > 0 ? `${s.latencyMs.toFixed(0)} ms` : "-";
    this.readouts.lookahead = s.lookaheadMs > 0 ? `${s.lookaheadMs.toFixed(0)} ms` : "off";
    this.readouts.delegate = s.delegate;
    this.readouts.backend = s.backend;
    // Stated rather than inferred: a browser that already holds microphone
    // permission grants it without prompting, so the absence of a prompt says
    // nothing about whether the microphone is running.
    this.readouts.mic = s.mic;
    this.readouts.confidence = s.confidence > 0 ? s.confidence.toFixed(2) : "-";

    for (const group of this.readoutGroups) {
      const values = group.sample();
      for (let i = 0; i < group.labels.length; i++) {
        const label = group.labels[i];
        if (label === undefined) continue;
        group.proxy[label] = (values[i] ?? 0).toFixed(group.digits);
      }
    }
  }

  /**
   * The folder of this name, created on first use.
   *
   * Returning the existing one rather than adding a second is what stops the
   * panel growing two folders with the same title, which it did: the Face
   * readouts and the Face controls are added by different callers and each
   * made its own. It was also silently breaking `collapseAllExcept`, since
   * the map below is keyed by title and the second folder displaced the first
   * -- leaving one of the two unreachable by name and permanently open.
   *
   * Exposed so later stages can add controls without owning the GUI.
   */
  folder(name: string): GUI {
    const existing = this.folders.get(name);
    if (existing) return existing;

    const folder = this.gui.addFolder(name);
    this.folders.set(name, folder);
    return folder;
  }

  /**
   * Restores every control to the value it was created with, firing the
   * change handlers so side effects follow.
   *
   * Note what this does NOT undo: a setting restored from storage was the
   * controller's initial value, so resetting returns to the stored choice
   * rather than to the built-in default. Clearing saved settings is the
   * separate action for that.
   */
  resetControls(): void {
    this.gui.reset();
    console.info("panel: controls reset to their initial values");
  }

  /** Adds an action to the Session folder, for things the panel cannot do itself. */
  addSessionAction(label: string, run: () => void): void {
    this.sessionFolder.add({ [label]: run }, label);
  }

  /**
   * Collapses every folder except the named ones.
   *
   * The panel has grown to a dozen folders as features landed, which is long
   * enough that controls below the fold are effectively invisible -- the lip
   * sync toggle went unnoticed for exactly this reason. Collapsed by default
   * means the whole set is reachable without scrolling.
   */
  collapseAllExcept(keep: readonly string[]): void {
    for (const [title, folder] of this.folders) {
      if (!keep.includes(title)) folder.close();
    }
  }

  /**
   * A folder of live numeric readouts, pulled each frame.
   *
   * Used for per-bone tracking weights: when a limb misbehaves, seeing the
   * number it is being driven by beats inferring it from the motion, which is
   * how a left/right difference went unexplained for a while.
   */
  addReadoutGroup(
    name: string,
    labels: readonly string[],
    sample: () => readonly number[],
    digits = 2,
  ): void {
    const folder = this.folder(name);
    const proxy: Record<string, string> = {};
    for (const label of labels) {
      proxy[label] = "-";
      folder.add(proxy, label).listen().disable();
    }
    this.readoutGroups.push({ proxy, labels, sample, digits });
  }

  /**
   * Lets other modules add view toggles without the panel having to import
   * them, which would invert the dependency and couple the UI to the pipeline.
   */
  addViewToggle(label: string, initial: boolean, onChange: (v: boolean) => void): void {
    const proxy = { [label]: initial };
    this.viewFolder.add(proxy, label).onChange(onChange);
    onChange(initial);
  }

  dispose(): void {
    this.gui.destroy();
  }
}
