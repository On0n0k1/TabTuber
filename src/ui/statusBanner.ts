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

/**
 * How often repeated raises are summarised to the console.
 *
 * A summary rather than a line per call: a caller in a render loop raises a
 * message sixty times a second, and sixty lines a second is not a diagnostic,
 * it is a wall. One line per second carrying the count and the call site says
 * the same thing and names the culprit.
 */
const REPORT_MS = 1000;

/** The first frame outside this file, which is whoever raised the message. */
function callSite(): string {
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  const outside = frames.find((f) => !f.includes("statusBanner"));
  return (outside ?? frames[2] ?? "unknown").trim();
}

export class StatusBanner {
  private readonly el: HTMLDivElement;
  private timer: number | null = null;
  private shown = "";
  /** Repeated raises in the current window, with where the first came from. */
  private readonly repeats = new Map<string, { count: number; from: string }>();
  private windowStart = 0;

  /**
   * A message that has had its turn, by timing out or by being closed.
   *
   * Remembered so that a caller raising the same text in a loop cannot
   * resurrect it. Cleared as soon as something different is raised.
   */
  private spent = "";

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "banner";
    this.el.hidden = true;
    parent.append(this.el);
    this.flag();
  }

  show(kind: BannerKind, message: string, action?: { label: string; run: () => void }): void {
    const key = `${kind}:${message}`;
    this.watch(key);

    /*
     * Two guards, both learned from one bug: a caller re-raising the same
     * message over and over made the banner impossible to get rid of. It had
     * been dismissed and came straight back, and its timeout never fired
     * because every call restarted it.
     *
     * So an identical message that is already up is a no-op -- it does not
     * rebuild and, crucially, does not re-arm, which means a message raised
     * every frame still times out three seconds after it first appeared.
     *
     * And once a message has had its turn, by timing out or by being closed,
     * the same text is refused until something different is raised. Without
     * that second rule the first one is not enough: hiding clears `shown`,
     * so the very next call in the loop puts the message straight back and it
     * only ever blinks off for a frame. A user dismissing something is an
     * instruction rather than a suggestion, and a timeout that a loop can
     * undo is not a timeout.
     *
     * The caller that prompted this is fixed; these keep the next one from
     * being able to do it.
     */
    if (key === this.spent) return;
    if (key === this.shown && !this.el.hidden) return;

    this.shown = key;
    this.spent = "";
    this.arm(kind);

    /*
     * Every error reaches the console, not only the banner.
     *
     * A banner is one line that is dismissed or times out, and an error that
     * has been seen but not recorded cannot be investigated afterwards. This
     * is the chokepoint all of them pass through, so putting it here makes it
     * a guarantee rather than a convention each caller has to remember.
     *
     * Callers holding an actual Error still log it themselves, because a
     * stack says where it came from and this only has the sentence.
     */
    if (kind === "error") console.error(`banner: ${message}`);

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
    close.addEventListener("click", () => this.dismiss());
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

  /**
   * Retires the current message, whether the user closed it or it timed out.
   *
   * `hide()` clears `shown`, so the key is taken first; it is what stops the
   * same text being raised again.
   */
  private dismiss(): void {
    const closing = this.shown;
    this.hide();
    this.spent = closing;
  }

  /**
   * Starts the countdown for anything that is not a blocking error.
   *
   * Timing out goes through `dismiss`, not `hide`, so the message is marked
   * spent. Otherwise a caller in a loop re-raises it on the next tick.
   */
  private arm(kind: BannerKind): void {
    this.clearTimer();
    if (kind === "error") return;
    this.timer = window.setTimeout(() => this.dismiss(), AUTO_DISMISS_MS);
  }

  /**
   * Counts how often each message is raised and reports anything repeating.
   *
   * Nothing is logged in normal operation, because a message raised once is
   * raised once. A warning here means some caller is in a loop -- which is
   * not fatal any more, since a repeated message neither rebuilds nor
   * re-arms, but it is still a bug in the caller and it hid one before. The
   * call site is captured so the loop can be found rather than guessed at;
   * taking a stack is not cheap, so it is taken once per message per window.
   */
  private watch(key: string): void {
    const now = performance.now();
    if (this.windowStart === 0) this.windowStart = now;

    const seen = this.repeats.get(key);
    if (seen) seen.count++;
    else this.repeats.set(key, { count: 1, from: callSite() });

    if (now - this.windowStart < REPORT_MS) return;

    const seconds = (now - this.windowStart) / 1000;
    for (const [k, { count, from }] of this.repeats) {
      if (count < 2) continue;
      console.warn(
        `banner: "${k}" raised ${count} times in ${seconds.toFixed(1)}s ` +
        `(${(count / seconds).toFixed(0)}/s). Raised from:\n${from}`,
      );
    }
    this.repeats.clear();
    this.windowStart = now;
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
