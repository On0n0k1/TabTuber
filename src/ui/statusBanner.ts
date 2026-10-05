/*
 * Full-width status banner for states the user must act on.
 *
 * Separate from the debug panel on purpose: a denied camera permission is not
 * a diagnostic, it is a blocking condition, and burying it in a collapsible
 * folder reads as "nothing is happening" instead of "do this".
 */

export type BannerKind = "error" | "info" | "busy";

/**
 * How long a non-blocking message stays up.
 *
 * Long enough to read a sentence, short enough that a message left behind by
 * whatever raised it clears itself. Errors are exempt: those are blocking
 * conditions with something to do about them, and a message that times out
 * before it is acted on is worse than one that lingers.
 */
const AUTO_DISMISS_MS = 3000;

export class StatusBanner {
  private readonly el: HTMLDivElement;
  private timer: number | null = null;
  private shown = "";

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "banner";
    this.el.hidden = true;
    parent.append(this.el);
    this.flag();
  }

  show(kind: BannerKind, message: string, action?: { label: string; run: () => void }): void {
    // Re-raising a live message restarts its countdown without rebuilding
    // anything: the calibration countdown calls this every frame.
    this.arm(kind);
    const key = `${kind}:${message}`;
    if (key === this.shown && !this.el.hidden) return;
    this.shown = key;

    this.el.dataset["kind"] = kind;
    this.el.replaceChildren(document.createTextNode(message));

    if (action) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.addEventListener("click", action.run);
      this.el.append(button);
    }

    /*
     * Always dismissible. Several unrelated parts of the app write to this one
     * banner and none of them owns it, so a message can outlive whatever it
     * was describing. Non-blocking messages now clear themselves, but an
     * error stays until it is acted on, and that one still needs a way out.
     */
    const close = document.createElement("button");
    close.className = "banner-close";
    close.type = "button";
    close.textContent = "\u00d7";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", () => this.hide());
    this.el.append(close);

    this.el.hidden = false;
    this.flag();
  }

  hide(): void {
    this.clearTimer();
    this.shown = "";
    this.el.hidden = true;
    this.flag();
  }

  /** Starts the countdown for anything that is not a blocking error. */
  private arm(kind: BannerKind): void {
    this.clearTimer();
    if (kind === "error") return;
    this.timer = window.setTimeout(() => this.hide(), AUTO_DISMISS_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Marks the body while a banner is up, and publishes its height, so
   * anything else pinned to the top of the screen can move out from under it.
   *
   * A flag rather than a CSS `:has()` on the banner: `:has` would couple the
   * two without either knowing about the other, which is tidier, but a
   * browser that does not support it drops the whole rule and the other
   * element silently ends up underneath -- which is exactly the failure this
   * exists to prevent, and it fails invisibly.
   *
   * The height is measured rather than assumed because the banner wraps: a
   * long message with an action and a dismiss runs to three rows, and a fixed
   * offset guessed from the one-line case puts the other element back
   * underneath. Reading offsetHeight forces a reflow, which is why this runs
   * when a banner changes and never per frame.
   */
  private flag(): void {
    const { style, dataset } = document.body;
    if (this.el.hidden) {
      delete dataset["banner"];
      style.removeProperty("--banner-height");
      return;
    }
    dataset["banner"] = "";
    style.setProperty("--banner-height", `${this.el.offsetHeight}px`);
  }
}
