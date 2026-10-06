/*
 * Setup sheet (SPEC.md 9.1).
 *
 * The things a first run depends on: which camera, which avatar, what sits
 * behind it, and whether the image is mirrored. None of them is a diagnostic,
 * and all of them used to live in the debug panel -- a camera picker hidden
 * in a developer tool means an unusable app whose fix cannot be found.
 *
 * A sheet rather than more toolbar buttons because two of these are lists
 * rather than states: a camera is chosen from however many are plugged in,
 * and a model is chosen from a few presets OR a file. An icon that cycles
 * blindly through cameras is not a camera picker.
 */

export interface ModelChoice {
  readonly label: string;
  readonly url: string;
}

export interface SetupSheetOptions {
  readonly models: readonly ModelChoice[];
  readonly listCameras: () => Promise<readonly { deviceId: string; label: string }[]>;
  /**
   * The camera actually running, or "" if none is.
   *
   * Asked for rather than assumed. The first start names no device and lets
   * the browser choose, and its choice is not reliably the first one
   * enumerated -- selecting the first entry showed one camera in the picker
   * while a different one was feeding the tracker.
   */
  readonly currentCamera: () => string;
  readonly onCamera: (deviceId: string) => void;
  readonly onModel: (url: string, label: string) => void;
  readonly onUpload: (buffer: ArrayBuffer, name: string) => void;
  readonly onBackground: (mode: string) => void;
  readonly onMirror: (on: boolean) => void;
  readonly mirror: () => boolean;
}

const BACKGROUNDS = ["checker", "key", "transparent"] as const;

/** Prefix marking a select option as an uploaded file rather than a URL. */
const UPLOAD_PREFIX = "upload:";

export class SetupSheet {
  private readonly el: HTMLDivElement;
  private readonly cameraSelect: HTMLSelectElement;
  private readonly modelSelect: HTMLSelectElement;
  /**
   * Files brought in this session, by the option value that selects them.
   *
   * Files, not their bytes: a File is a handle, so a dozen of them cost
   * nothing while a dozen VRMs would be well over a hundred megabytes. The
   * cost is that a file moved or deleted since cannot be read again, which
   * surfaces as an ordinary load error naming the file.
   */
  private readonly uploaded = new Map<string, File>();
  private uploadedGroup: HTMLOptGroupElement | null = null;
  private open = false;

  constructor(parent: HTMLElement, private readonly opts: SetupSheetOptions) {
    this.el = document.createElement("div");
    this.el.className = "sheet";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Setup");

    const title = document.createElement("h2");
    title.className = "sheet-title";
    title.textContent = "Setup";
    this.el.append(title);

    this.cameraSelect = this.addSelect("Camera", []);
    this.cameraSelect.addEventListener("change", () => {
      // The placeholder is not a device; selecting it would ask for a camera
      // named "" and restart whatever the browser feels like.
      if (this.cameraSelect.value === "") return;
      opts.onCamera(this.cameraSelect.value);
    });

    this.modelSelect = this.addSelect("Avatar", opts.models.map((m) => [m.url, m.label]));
    this.modelSelect.addEventListener("change", () => {
      const value = this.modelSelect.value;
      const file = this.uploaded.get(value);
      if (file) {
        void this.read(file);
        return;
      }
      const chosen = opts.models.find((m) => m.url === value);
      if (chosen) opts.onModel(chosen.url, chosen.label);
    });

    /*
     * A file input as well as the drag-and-drop that already exists. Dropping
     * is faster once you know about it and invisible until you do, and this
     * is the surface a first-time user is looking at.
     */
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".vrm,model/gltf-binary";
    file.className = "sheet-file";

    /*
     * The input is hidden behind a label rather than shown.
     *
     * A file input renders as the browser's own button with its own words --
     * "Choose File", "No file chosen" -- which say nothing about what this
     * one takes, and look like a form on a page rather than part of the app.
     * The text cannot be changed; only replaced. A label pointed at the input
     * is still a real control: clicking it opens the picker, and it stays
     * reachable by keyboard because the input keeps its focus.
     */
    file.id = "sheet-upload-input";
    const upload = document.createElement("label");
    upload.className = "sheet-upload";
    upload.htmlFor = file.id;
    upload.textContent = "Upload a VRM avatar";

    file.addEventListener("change", () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      this.useFile(chosen);
      // Cleared so choosing the same file twice fires again.
      file.value = "";
    });

    this.el.append(file, upload);

    const background = this.addSelect("Background", BACKGROUNDS.map((b) => [b, b]));
    background.addEventListener("change", () => opts.onBackground(background.value));

    const mirror = document.createElement("input");
    mirror.type = "checkbox";
    mirror.checked = opts.mirror();
    mirror.addEventListener("change", () => opts.onMirror(mirror.checked));
    this.addRow("Mirror", mirror);

    const hint = document.createElement("p");
    hint.className = "sheet-hint";
    hint.textContent = "A .vrm can also be dropped anywhere on the page.";
    this.el.append(hint);

    parent.append(this.el);
  }

  private addRow(label: string, control: HTMLElement): void {
    const row = document.createElement("label");
    row.className = "sheet-row";
    const name = document.createElement("span");
    name.textContent = label;
    row.append(name, control);
    this.el.append(row);
  }

  private addSelect(label: string, options: readonly (readonly [string, string])[]): HTMLSelectElement {
    const select = document.createElement("select");
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    this.addRow(label, select);
    return select;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Cameras are listed when the sheet opens, not once at startup.
   *
   * Labels are empty until camera permission has been granted, so a list
   * taken before the first prompt reads "Camera 1, Camera 2" and is useless
   * for choosing between them.
   */
  toggle(): void {
    this.open = !this.open;
    this.el.hidden = !this.open;
    if (this.open) void this.refreshCameras();
  }

  private async refreshCameras(): Promise<void> {
    const devices = await this.opts.listCameras();
    this.cameraSelect.replaceChildren();
    for (const d of devices) {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = d.label;
      this.cameraSelect.append(option);
    }

    const running = this.opts.currentCamera();
    if (devices.some((d) => d.deviceId === running)) {
      this.cameraSelect.value = running;
      return;
    }

    /*
     * The browser would not say which device it chose. Rather than point at
     * the first one and be confidently wrong, the picker says nothing is
     * selected -- choosing an entry then starts that camera explicitly and
     * the question stops being open.
     */
    const unknown = document.createElement("option");
    unknown.value = "";
    unknown.textContent = devices.length === 0 ? "no camera found" : "(current camera unknown)";
    this.cameraSelect.prepend(unknown);
    this.cameraSelect.value = "";
  }

  /**
   * Takes a file as the avatar, and adds it to the list.
   *
   * Called both by the upload button and by a file dropped on the page, so
   * the two behave identically -- a dropped avatar that could not be
   * selected again afterwards would be a worse version of the same feature.
   *
   * Keyed by name, so re-picking the same file replaces its entry instead of
   * growing a list of duplicates.
   */
  useFile(file: File): void {
    const value = `${UPLOAD_PREFIX}${file.name}`;
    this.uploaded.set(value, file);

    this.uploadedGroup ??= (() => {
      const group = document.createElement("optgroup");
      group.label = "Uploaded";
      this.modelSelect.append(group);
      return group;
    })();

    if (![...this.uploadedGroup.children].some((o) => (o as HTMLOptionElement).value === value)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = file.name;
      this.uploadedGroup.append(option);
    }

    this.modelSelect.value = value;
    void this.read(file);
  }

  private async read(file: File): Promise<void> {
    this.opts.onUpload(await file.arrayBuffer(), file.name);
  }

  /** Reflects a model chosen by other means, so the sheet cannot disagree. */
  setModel(url: string): void {
    if ([...this.modelSelect.options].some((o) => o.value === url)) {
      this.modelSelect.value = url;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
