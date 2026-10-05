/*
 * End-to-end latency, on screen (SPEC.md 9.2).
 *
 * On the canvas rather than in the debug panel because the panel is docked
 * right and collapsible, and this is a number you want visible while moving
 * about in front of the camera -- which is exactly when the panel is not
 * where you are looking. Top LEFT for the same reason: the panel covers the
 * right edge.
 *
 * It is a budget readout, not a diagnostic. SPEC.md 9 puts the whole chain at
 * under about 100ms before the avatar stops feeling attached to the
 * performer, so the number is coloured against that rather than left for the
 * reader to judge.
 */

/** Milliseconds above which the avatar starts to feel detached (SPEC.md 9). */
const BUDGET_MS = 100;
/** Comfortably over budget rather than marginally; worth alarming about. */
const BAD_MS = 150;

/**
 * Camera frame rate below which the readout says so.
 *
 * Because the number alone does not say what is slow, and the answer is
 * frequently not the software. A webcam lengthens its exposure in dim light
 * and drops its frame rate to suit, and everything downstream inherits it:
 * measured at 180ms in a dim room, halving to 90ms with a lamp behind the
 * subject and no other change (SPEC.md 6.1). Nobody looks for a lightbulb
 * when a program is slow, so the readout has to point at it.
 *
 * 20 rather than something nearer 30, so an ordinary camera having a slightly
 * off moment does not sit there accusing the room.
 */
const LOW_CAMERA_FPS = 20;

export class LatencyHud {
  private readonly el: HTMLDivElement;
  private readonly value: HTMLSpanElement;
  private readonly note: HTMLSpanElement;

  /**
   * Smoothed, because the raw per-frame figure swings by tens of
   * milliseconds and an unreadable number is not a readout. Slow enough to
   * read, fast enough that a backend change shows up while you are still
   * looking at it.
   */
  private smoothed = 0;
  private shown = -1;
  private shownState = "";
  private shownNote = "";

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "latency";

    this.value = document.createElement("span");
    this.value.className = "latency-value";
    this.note = document.createElement("span");
    this.note.className = "latency-note";
    this.el.append(this.value, this.note);
    parent.append(this.el);
  }

  /**
   * Call once per rendered frame.
   *
   * `partial` marks a figure that is missing the camera's own delay because
   * the browser would not report it, so the readout can say so instead of
   * presenting a smaller number as the whole truth. `cameraFps` is 0 when
   * nothing is arriving.
   */
  update(latencyMs: number, cameraFps: number, partial: boolean): void {
    if (latencyMs <= 0) {
      this.setText("-", "", "idle");
      return;
    }

    this.smoothed = this.smoothed === 0
      ? latencyMs
      : this.smoothed + (latencyMs - this.smoothed) * 0.08;

    const rounded = Math.round(this.smoothed);
    const state = rounded <= BUDGET_MS ? "ok" : rounded <= BAD_MS ? "warn" : "bad";
    const note = this.noteFor(cameraFps, partial);

    // Only touched when something displayed actually changes: this runs every
    // frame, and a text write per frame is layout work for nothing.
    if (rounded === this.shown && state === this.shownState && note === this.shownNote) return;
    this.shown = rounded;
    this.setText(`${rounded} ms`, note, state);
  }

  /**
   * The one line under the number, or nothing.
   *
   * A slow camera outranks an unreported capture delay: it is the larger
   * effect by far and it is the one with something to do about it.
   */
  private noteFor(cameraFps: number, partial: boolean): string {
    if (cameraFps > 0 && cameraFps < LOW_CAMERA_FPS) {
      return `camera ${cameraFps.toFixed(0)} fps`;
    }
    return partial ? "capture delay unknown" : "";
  }

  private setText(value: string, note: string, state: string): void {
    this.shownNote = note;
    this.value.textContent = value;
    this.note.textContent = note;
    this.note.hidden = note === "";
    this.el.dataset["state"] = state;
    this.shownState = state;
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  dispose(): void {
    this.el.remove();
  }
}
