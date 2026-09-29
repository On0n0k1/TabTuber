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
  /** Inference time alone. End-to-end latency lands with SPEC.md section 9. */
  inference: string;
  delegate: string;
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
    delegate: string;
  };
}

export class DebugPanel {
  private readonly gui = new GUI({ title: "virtual-avatar" });
  private readonly camera: Camera;
  private readonly stage: Stage;
  private readonly sample: DebugPanelOptions["sample"];

  private readonly readouts: Readouts = {
    renderFps: "-",
    cameraFps: "-",
    resolution: "-",
    trackerFps: "-",
    inference: "-",
    delegate: "-",
  };

  private readonly view = {
    background: "checker" as BackgroundMode,
    helpers: true,
    preview: true,
  };

  private readonly cameraFolder;
  private readonly viewFolder: GUI;
  private deviceController: ReturnType<GUI["add"]> | null = null;
  private selectedDeviceId = "";

  constructor(opts: DebugPanelOptions) {
    this.stage = opts.stage;
    this.camera = opts.camera;
    this.sample = opts.sample;

    const stats = this.gui.addFolder("Stats");
    for (const key of Object.keys(this.readouts) as (keyof Readouts)[]) {
      stats.add(this.readouts, key).listen().disable();
    }

    this.cameraFolder = this.gui.addFolder("Camera");
    this.cameraFolder
      .add({ restart: () => void this.camera.start(this.selectedDeviceId || undefined) }, "restart")
      .name("restart");

    this.viewFolder = this.gui.addFolder("View");
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
    this.readouts.delegate = s.delegate;
  }

  /** Exposed so later stages can add their own folders without owning the GUI. */
  folder(name: string): GUI {
    return this.gui.addFolder(name);
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
