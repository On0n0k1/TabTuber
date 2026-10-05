/*
 * Full-width status banner for states the user must act on.
 *
 * Separate from the debug panel on purpose: a denied camera permission is not
 * a diagnostic, it is a blocking condition, and burying it in a collapsible
 * folder reads as "nothing is happening" instead of "do this".
 */

export type BannerKind = "error" | "info" | "busy";

export class StatusBanner {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "banner";
    this.el.hidden = true;
    parent.append(this.el);
    this.flag();
  }

  show(kind: BannerKind, message: string, action?: { label: string; run: () => void }): void {
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
     * was describing -- and it sits across the top of the screen, over
     * anything else there. A way out that does not depend on the code that
     * raised it ever coming back is the floor.
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
    this.el.hidden = true;
    this.flag();
  }

  /**
   * Marks the body while a banner is up, so anything else pinned to the top
   * of the screen can move out from under it.
   *
   * A flag rather than a CSS `:has()` on the banner: `:has` would couple the
   * two without either knowing about the other, which is tidier, but a
   * browser that does not support it drops the whole rule and the other
   * element silently ends up underneath -- which is exactly the failure this
   * exists to prevent, and it fails invisibly.
   */
  private flag(): void {
    if (this.el.hidden) delete document.body.dataset["banner"];
    else document.body.dataset["banner"] = "";
  }
}
