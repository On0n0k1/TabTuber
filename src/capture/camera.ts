/*
 * Webcam capture.
 *
 * Produces a playing <video> for the tracker to sample. Does no mirroring:
 * the stream stays as the camera reports it and handedness is resolved once
 * in the coordinate conversion (SPEC.md 5.1). Flipping here would silently
 * swap the subject's left and right for the solver.
 */

/**
 * 640x480 is deliberate rather than a fallback. BlazePose downsamples its
 * input internally, so a higher capture resolution buys no landmark accuracy
 * and costs latency in both the copy and the inference -- and latency is a
 * hard constraint for live use (SPEC.md 9).
 */
const REQUESTED_WIDTH = 640;
const REQUESTED_HEIGHT = 480;
const REQUESTED_FPS = 30;

export type CameraErrorReason =
  | "insecure-context"
  | "unsupported"
  | "denied"
  | "no-device"
  | "in-use"
  | "unknown";

export interface CameraDevice {
  readonly deviceId: string;
  readonly label: string;
}

export type CameraState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting" }
  | {
      readonly kind: "ready";
      readonly video: HTMLVideoElement;
      /**
       * The device actually in use, which is not necessarily the one asked
       * for.
       *
       * The first start asks for no device at all and lets the browser
       * choose, so anything wanting to show or restart the current camera has
       * to be told which one that turned out to be. Assuming it is the first
       * entry of `listDevices()` is wrong whenever the browser's default is
       * not first -- which is how a picker came to display one camera while
       * another was running, and how `restart` came to restart the wrong one.
       *
       * Empty if the browser will not report it.
       */
      readonly deviceId: string;
      readonly label: string;
      readonly width: number;
      readonly height: number;
      readonly frameRate: number;
    }
  | {
      readonly kind: "error";
      readonly reason: CameraErrorReason;
      readonly message: string;
    };

/** User-facing text for each failure, since all of these are recoverable. */
const ERROR_MESSAGES: Record<CameraErrorReason, string> = {
  "insecure-context":
    "Camera access needs https or localhost. Open the page over a secure origin.",
  unsupported: "This browser does not expose getUserMedia.",
  denied:
    "Camera permission was denied. Allow access in the browser's site settings, then retry.",
  "no-device": "No camera was found. Connect one and retry.",
  "in-use":
    "The camera is already in use by another application. Close it and retry.",
  unknown: "The camera could not be started.",
};

function classify(err: unknown): CameraErrorReason {
  if (!(err instanceof DOMException)) return "unknown";
  switch (err.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no-device";
    case "NotReadableError":
    case "AbortError":
      return "in-use";
    default:
      return "unknown";
  }
}

export class Camera {
  private stream: MediaStream | null = null;
  private currentState: CameraState = { kind: "idle" };
  private readonly listeners = new Set<(s: CameraState) => void>();
  private readonly deviceListeners = new Set<() => void>();
  private readonly video: HTMLVideoElement;

  constructor() {
    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    // Kept out of the layout by default; the debug panel reparents it when
    // the camera preview is shown.
    this.video.style.display = "none";
    document.body.append(this.video);

    navigator.mediaDevices?.addEventListener(
      "devicechange",
      this.handleDeviceChange,
    );
  }

  get state(): CameraState {
    return this.currentState;
  }

  /** The element is stable across restarts, so it can be bound to once. */
  get element(): HTMLVideoElement {
    return this.video;
  }

  onStateChange(cb: (s: CameraState) => void): () => void {
    this.listeners.add(cb);
    cb(this.currentState);
    return () => this.listeners.delete(cb);
  }

  private setState(s: CameraState): void {
    this.currentState = s;
    for (const cb of this.listeners) cb(s);
  }

  /**
   * Device labels are empty strings until permission has been granted at
   * least once, so calling this before start() yields unnamed entries.
   */
  async listDevices(): Promise<CameraDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
  }

  async start(deviceId?: string): Promise<void> {
    if (!window.isSecureContext) {
      this.fail("insecure-context");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail("unsupported");
      return;
    }

    this.stop();
    this.setState({ kind: "requesting" });

    const video: MediaTrackConstraints = {
      width: { ideal: REQUESTED_WIDTH },
      height: { ideal: REQUESTED_HEIGHT },
      frameRate: { ideal: REQUESTED_FPS },
    };
    // facingMode and deviceId conflict; an explicit choice wins.
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = "user";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: false,
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      // Metadata can lag play(), and the tracker needs real dimensions.
      await this.waitForDimensions();

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings() ?? {};
      this.setState({
        kind: "ready",
        video: this.video,
        deviceId: settings.deviceId ?? "",
        label: track?.label ?? "camera",
        width: settings.width ?? this.video.videoWidth,
        height: settings.height ?? this.video.videoHeight,
        frameRate: settings.frameRate ?? REQUESTED_FPS,
      });
    } catch (err) {
      this.fail(classify(err));
    }
  }

  private waitForDimensions(): Promise<void> {
    if (this.video.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.video.addEventListener("loadedmetadata", () => resolve(), {
        once: true,
      });
    });
  }

  private fail(reason: CameraErrorReason): void {
    this.setState({ kind: "error", reason, message: ERROR_MESSAGES[reason] });
  }

  /**
   * The set of attached cameras changed.
   *
   * Its own channel, not a replay of the camera state. Replaying state made
   * every state listener re-handle a transition that had not happened, and
   * they cannot tell the difference: the status banner re-raised whatever
   * message matched the current state on every devicechange, so a message
   * could not be dismissed or time out while the events kept coming -- which
   * they do, on systems where the device list churns.
   *
   * An active stream that was unplugged is not this; that surfaces through
   * the track's ended event.
   */
  onDevicesChanged(cb: () => void): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  private readonly handleDeviceChange = (): void => {
    for (const cb of this.deviceListeners) cb();
  };

  stop(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
    if (this.currentState.kind === "ready") this.setState({ kind: "idle" });
  }

  dispose(): void {
    this.stop();
    navigator.mediaDevices?.removeEventListener(
      "devicechange",
      this.handleDeviceChange,
    );
    this.video.remove();
    this.listeners.clear();
    this.deviceListeners.clear();
  }
}
