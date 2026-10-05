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
 * Camera frame rate below which the rate is coloured as a problem.
 *
 * The rate itself is always shown, not only when it is bad. The number alone
 * does not say WHAT is slow, and the answer is frequently not the software: a
 * webcam lengthens its exposure in dim light and drops its frame rate, and
 * everything downstream inherits it -- measured at 180ms in a dim room,
 * halving to 90ms with a lamp behind the subject and no other change
 * (SPEC.md 6.1). Nobody looks for a lightbulb when a program is slow.
 *
 * Showing it only when low would make its absence ambiguous: a healthy camera
 * and a readout that is not reporting would look identical. Always showing it
 * also makes it something to watch while changing the lighting, rather than a
 * verdict that appears once the damage is done. So the threshold colours the
 * number instead of gating it, and 20 is low enough that a camera having a
 * momentarily off second does not sit there accusing the room.
 */
const LOW_CAMERA_FPS = 20;

/** What each figure means, for anyone who did not build the pipeline. */
const EXPLAIN = {
  value:
    "How long it takes a frame to reach the screen, from the camera through " +
    "tracking and smoothing. OBS capture and encode are not included, so the " +
    "viewer's figure is higher.",
  note:
    "How many frames the camera is producing each second to be processed. " +
    "A webcam lengthens its exposure in dim light and slows down, which makes " +
    "everything above it slower too.",
} as const;

export class LatencyHud {
  private readonly el: HTMLDivElement;
  private readonly value: HTMLSpanElement;
  private readonly note: HTMLSpanElement;
  private readonly tip: HTMLDivElement;

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
    /*
     * Explained on hover, because the two figures are meaningless to anyone
     * who has not read SPEC.md 9.2 -- a number with no units of meaning
     * invites the wrong conclusion more than it informs.
     *
     * A tooltip element rather than `title`: that waits about a second, is
     * styled by the OS, and never appears for a keyboard user. The spans are
     * given tabindex so this one does.
     */
    this.tip = document.createElement("div");
    this.tip.className = "latency-tip";
    this.tip.hidden = true;

    for (const [key, el] of [["value", this.value], ["note", this.note]] as const) {
      el.tabIndex = 0;
      const show = (): void => {
        this.tip.textContent = EXPLAIN[key];
        this.tip.hidden = false;
      };
      const hide = (): void => { this.tip.hidden = true; };
      el.addEventListener("pointerenter", show);
      el.addEventListener("pointerleave", hide);
      el.addEventListener("focus", show);
      el.addEventListener("blur", hide);
    }

    this.el.append(this.value, this.note, this.tip);
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
    // Coloured rather than hidden when low, so the rate is always readable
    // and a bad one still catches the eye.
    const slow = cameraFps > 0 && cameraFps < LOW_CAMERA_FPS;

    // Only touched when something displayed actually changes: this runs every
    // frame, and a text write per frame is layout work for nothing.
    if (rounded === this.shown && state === this.shownState && note === this.shownNote) return;
    this.shown = rounded;
    this.setText(`${rounded} ms`, note, state);
    this.note.dataset["slow"] = slow ? "true" : "false";
  }

  /**
   * The line under the number: the camera's rate, plus any caveat about what
   * the figure above leaves out.
   */
  private noteFor(cameraFps: number, partial: boolean): string {
    const parts: string[] = [];
    if (cameraFps > 0) parts.push(`${cameraFps.toFixed(0)} fps`);
    if (partial) parts.push("capture delay unknown");
    return parts.join(" \u00b7 ");
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
