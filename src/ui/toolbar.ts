/*
 * Performer toolbar (SPEC.md 9.1).
 *
 * The debug panel is a tuning surface: a hundred controls, most of them set
 * once and never touched again. A handful of things are not like that -- the
 * microphone, posture, which expression the avatar is wearing -- and those get
 * reached for mid-performance, when hunting through collapsible folders is not
 * an option. They live here instead, as icons along the bottom edge.
 *
 * Each control has exactly ONE home. Nothing on this bar is also in the
 * panel, because two widgets over one piece of state is how they end up
 * disagreeing about it.
 *
 * State is PULLED, not pushed. Every item reads its own value through a
 * getter each frame rather than being told when it changed. The expressions
 * are already bound to the number keys and posture is already persisted, so
 * something else can always have moved the thing this bar is displaying;
 * polling a getter is both shorter than wiring change notifications through
 * every owner and impossible to get out of step.
 */

import { iconElement, type IconName } from "./icons.ts";

/** A plain on/off control, lit when on and darkened when off. */
export interface ToggleItem {
  kind: "toggle";
  /** Short name, shown as the tooltip's heading. */
  label: string;
  /** What it does, in a sentence. */
  tip: string;
  /** Keyboard shortcut to mention in the tooltip, if it has one. */
  key?: string;
  icon: IconName;
  /** Shown while off. Defaults to `icon`, dimmed. */
  iconOff?: IconName;
  get: () => boolean;
  set: (on: boolean) => void;
  /**
   * Why this control cannot be used right now, or null when it can.
   *
   * The REASON rather than a boolean, because a greyed button with no
   * explanation is a worse control than a live one that does nothing useful:
   * the state it is in is visible and the cause never is. What comes back
   * here replaces `tip` in the tooltip, so the button explains itself in the
   * one place a user is already looking.
   */
  disabled?: () => string | null;
}

/**
 * One button that advances through its states, the icon carrying which one is
 * current.
 *
 * Deliberately not lit or darkened: there is no "off" state to darken into --
 * you are either sitting or standing -- so dimming it would claim something
 * untrue. The icon is the entire readout.
 */
export interface CycleItem {
  kind: "cycle";
  label: string;
  tip: string;
  key?: string;
  states: readonly { value: string; label: string; icon: IconName }[];
  get: () => string;
  set: (value: string) => void;
}

/**
 * A run of buttons of which at most one is lit.
 *
 * `allowNone` is what separates a set of modes from a set of choices. The
 * expressions allow none, because neutral is a real answer and clicking the
 * lit one should get you back to it.
 *
 * It is also the only item that can be FOLDED UP. A run of buttons is the
 * widest thing the bar can hold, and the bar has a fixed set of controls on a
 * screen whose width it does not get to choose, so when there is not room for
 * the run it becomes one button that opens the run above the bar instead. All
 * of it is still one item with one getter and one setter -- the two
 * presentations are the same buttons, so they cannot disagree about which
 * option is on.
 */
export interface GroupItem {
  kind: "group";
  allowNone: boolean;
  /**
   * The single button the run folds into when the bar runs out of width.
   *
   * `icon` is the face it wears when nothing is selected; with a selection it
   * shows that option's own icon, so the folded button is the same readout the
   * run was rather than a disclosure arrow that says nothing.
   */
  collapsed: { label: string; tip: string; icon: IconName };
  options: readonly { value: string; label: string; tip: string; key?: string; icon: IconName }[];
  get: () => string | null;
  set: (value: string | null) => void;
}

export type ToolbarItem = ToggleItem | CycleItem | GroupItem | "divider";

/**
 * Clear space left either side of the bar before a group is folded up.
 *
 * The bar is centred, so this is the total of both margins. It decides only
 * WHEN folding happens, never whether the result fits: folding is the most the
 * bar can do, and on the narrowest phones the folded bar is still wider than
 * this would like.
 */
const GUTTER_PX = 24;

/** The state a click moves a cycle item to. */
export function nextCycle(values: readonly string[], current: string): string {
  const i = values.indexOf(current);
  // An unrecognised current value lands on the first state rather than
  // throwing: a stale persisted posture should not stop the button working.
  if (i < 0) return values[0] ?? current;
  return values[(i + 1) % values.length] ?? current;
}

/** What `render` last wrote to a button, and what it is about to write. */
export interface ButtonPaint {
  icon: IconName;
  on: boolean;
  disabled: boolean;
}

/**
 * Whether `render` has to touch the DOM for this button.
 *
 * Pulled out of `render` so it can be checked: it is a three-field comparison
 * that silently does nothing when it is wrong. Forgetting a field here does
 * not throw or render incorrectly on the next frame -- it renders the OLD
 * state forever, for whichever change was left out, and only for buttons
 * whose other two fields happen to be unchanged. A greyed-out control that
 * never greys out is the exact shape of that bug.
 */
export function needsRepaint(shown: ButtonPaint | null, next: ButtonPaint): boolean {
  if (!shown) return true;
  return (
    shown.icon !== next.icon ||
    shown.on !== next.on ||
    shown.disabled !== next.disabled
  );
}

/**
 * Whether a collapsible group folds up, given the bar's width unfolded and
 * the room available.
 *
 * Pulled out of the class and checked, because every way of getting it wrong
 * is silent. Reversed, the bar folds on a wide screen and nothing throws.
 * Fed the FOLDED width instead of the unfolded one, it answers "there is
 * room" the moment folding has made room -- so it unfolds, no longer fits,
 * folds again, and the bar flickers between the two forever at one particular
 * window width. Hence the argument name: this takes the width the bar needs
 * with the run in it, which the caller has to have remembered.
 *
 * A width of 0 means nothing has been measured yet, which is not the same as
 * fitting in nothing.
 */
export function shouldFold(unfoldedWidth: number, available: number): boolean {
  if (unfoldedWidth === 0) return false;
  return unfoldedWidth > available;
}

/** The state a click moves a group item to. */
export function nextGroup(
  current: string | null,
  clicked: string,
  allowNone: boolean,
): string | null {
  if (current !== clicked) return clicked;
  return allowNone ? null : current;
}

/** One rendered button, with the last state pushed into the DOM. */
interface Button {
  el: HTMLButtonElement;
  icon: SVGSVGElement;
  /** What `render` last wrote, so an unchanged frame touches nothing. */
  shown: ButtonPaint | null;
  /** Current icon and lit state, read fresh each frame. */
  read: () => { icon: IconName; on: boolean | null };
  tooltip: () => { label: string; tip: string; key?: string };
  click: () => void;
  /** Reason the control is unavailable, or null. Read fresh each frame. */
  disabled: () => string | null;
}

export class Toolbar {
  private readonly el: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly tipLabel: HTMLSpanElement;
  private readonly tipText: HTMLSpanElement;
  private readonly tipKey: HTMLSpanElement;
  private readonly buttons: Button[] = [];

  /** The collapsible group's run of buttons, and the button it folds into. */
  private group: HTMLSpanElement | null = null;
  private folded: HTMLButtonElement | null = null;
  private collapsed = false;
  private trayOpen = false;
  /** The bar's width with the run in it; see `fit`. */
  private unfoldedWidth = 0;
  private readonly onResize = (): void => this.fit();
  private readonly observer: ResizeObserver;

  constructor(parent: HTMLElement, items: readonly ToolbarItem[]) {
    this.el = document.createElement("div");
    this.el.className = "toolbar";
    // A toolbar, not a navigation landmark: these are controls over the thing
    // on screen rather than links to anywhere.
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Avatar controls");

    /*
     * A single tooltip moved between buttons rather than a `::after` on each.
     * Two reasons: the text is a heading, a sentence and a key rather than one
     * string, which wants real elements; and `title` is not an option at all
     * -- it waits about a second, is styled by the OS, and never appears for
     * a keyboard user.
     */
    this.tip = document.createElement("div");
    this.tip.className = "toolbar-tip";
    this.tip.hidden = true;
    this.tipLabel = document.createElement("span");
    this.tipLabel.className = "toolbar-tip-label";
    this.tipText = document.createElement("span");
    this.tipText.className = "toolbar-tip-text";
    this.tipKey = document.createElement("span");
    this.tipKey.className = "toolbar-tip-key";
    this.tip.append(this.tipLabel, this.tipText, this.tipKey);

    for (const item of items) this.addItem(item);
    this.el.append(this.tip);
    parent.append(this.el);
    this.syncGroup();

    /*
     * The bar measures itself rather than trusting a breakpoint.
     *
     * A media query would need a pixel threshold standing for "the width of
     * this particular set of controls", which is a figure nobody can read off
     * the stylesheet and which quietly becomes wrong the first time a button
     * is added. The bar knows its own width; the only thing it cannot know is
     * how much room it has, and that is one property of the window.
     *
     * Recorded only while unfolded, because that is the figure `fit` needs and
     * the folded bar cannot supply it. The width is a constant -- the controls
     * are fixed at construction -- so one good reading is enough, and taking
     * it from an observer rather than a frame callback means it is a reading
     * taken after layout rather than a guess about when layout happened.
     */
    this.observer = new ResizeObserver(() => {
      const width = this.el.getBoundingClientRect().width;
      if (!this.collapsed && width > 0) this.unfoldedWidth = width;
      this.fit();
    });
    this.observer.observe(this.el);
    // The bar's own size does not change when the window does, so the
    // observer alone would never hear about a resize that is the whole point.
    window.addEventListener("resize", this.onResize);
  }

  private addItem(item: ToolbarItem): void {
    if (item === "divider") {
      const divider = document.createElement("span");
      divider.className = "toolbar-divider";
      divider.setAttribute("aria-hidden", "true");
      this.el.append(divider);
      return;
    }

    if (item.kind === "toggle") {
      this.addButton({
        read: () => {
          const on = item.get();
          return { icon: on ? item.icon : (item.iconOff ?? item.icon), on };
        },
        tooltip: () => item,
        click: () => item.set(!item.get()),
        disabled: () => item.disabled?.() ?? null,
      });
      return;
    }

    if (item.kind === "cycle") {
      this.addButton({
        // `on: null` means "neither lit nor darkened"; see CycleItem.
        read: () => {
          const current = item.get();
          const state = item.states.find((s) => s.value === current) ?? item.states[0];
          return { icon: state?.icon ?? item.states[0]?.icon ?? "standing", on: null };
        },
        tooltip: () => {
          const current = item.get();
          const state = item.states.find((s) => s.value === current);
          // The tooltip names the state you are IN, since the icon already
          // shows it and the alternative is guessing what a click will do.
          return { label: state ? `${item.label}: ${state.label}` : item.label, tip: item.tip, ...(item.key !== undefined && { key: item.key }) };
        },
        click: () => item.set(nextCycle(item.states.map((s) => s.value), item.get())),
        disabled: () => null,
      });
      return;
    }

    /*
     * The button the run folds into, then the run itself. Both are built
     * once and both stay where they are: folding is a CSS state on the bar,
     * not a rebuild and not a DOM move. The run keeps its identity either
     * way, so a selection made in the tray is already shown by the same
     * button when the window widens and the run returns to the bar.
     */
    const folded = this.addButton({
      read: () => {
        const active = item.get();
        const option = item.options.find((o) => o.value === active);
        return { icon: option?.icon ?? item.collapsed.icon, on: active !== null };
      },
      tooltip: () => {
        const active = item.get();
        const option = item.options.find((o) => o.value === active);
        // Names the option you are WEARING, since the icon already shows it.
        return {
          label: option ? `${item.collapsed.label}: ${option.label}` : item.collapsed.label,
          tip: item.collapsed.tip,
        };
      },
      click: () => {
        this.trayOpen = !this.trayOpen;
        this.syncGroup();
        // The tray opens where the tooltip sits and the pointer is still over
        // the button, so the tooltip would land on top of what just opened.
        this.hideTip();
      },
      disabled: () => null,
    });
    // Hidden until the bar runs out of room for the run it replaces.
    folded.hidden = true;
    this.folded = folded;

    const group = document.createElement("span");
    group.className = "toolbar-group";
    this.group = group;
    this.el.append(group);

    /*
     * Choosing does NOT close the tray. Only the button that opened it closes
     * it again.
     *
     * A menu that dismisses on selection would be the usual behaviour, and it
     * is wrong here: these are not navigation, they are a performance control
     * whose whole use is trying one expression after another and watching the
     * avatar. Closing after each one means reopening the tray for every
     * change, and it hides the run of buttons at the moment the lit one is
     * the thing worth seeing.
     */
    for (const option of item.options) {
      this.addButton({
        read: () => ({ icon: option.icon, on: item.get() === option.value }),
        tooltip: () => option,
        click: () => item.set(nextGroup(item.get(), option.value, item.allowNone)),
        disabled: () => null,
      }, group);
    }
  }

  /**
   * Which of the group's two presentations is on screen.
   *
   * Everything about folding goes through here, so the folded button, the
   * run's visibility and the attribute the stylesheet reads can never be left
   * describing different states.
   */
  private syncGroup(): void {
    const { group, folded } = this;
    if (!group || !folded) return;
    this.el.dataset["group"] = this.collapsed ? "folded" : "inline";
    folded.hidden = !this.collapsed;
    // A disclosure, which `render` has no way to express: its aria-pressed
    // says whether an expression is on, not whether the tray is showing.
    folded.setAttribute("aria-expanded", this.trayOpen ? "true" : "false");
    // In the bar the run is simply part of it; folded it is a tray, and a
    // tray is only on screen while it is open.
    group.hidden = this.collapsed && !this.trayOpen;
  }

  /**
   * Fold the group up, or let it back out, according to the room available.
   *
   * The width compared against is the bar's own width while UNFOLDED, which is
   * recorded by the observer below and is a constant: the set of controls is
   * fixed at construction. It has to be remembered rather than re-measured,
   * because once the bar is folded the width it would need in order to unfold
   * is no longer anywhere on screen to measure -- asking the folded bar
   * whether it fits would always answer yes, and it would never unfold again.
   */
  private fit(): void {
    const collapse = shouldFold(this.unfoldedWidth, window.innerWidth - GUTTER_PX);
    if (collapse === this.collapsed) return;
    this.collapsed = collapse;
    // A tray left open across a resize would float over a bar that now has
    // the run in it, showing the same five buttons twice.
    if (!collapse) this.trayOpen = false;
    this.syncGroup();
  }

  private addButton(
    spec: Omit<Button, "el" | "icon" | "shown">,
    container: HTMLElement = this.el,
  ): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tool";

    const initial = spec.read();
    const icon = iconElement(initial.icon);
    el.append(icon);

    const button: Button = { el, icon, shown: null, ...spec };

    el.addEventListener("click", () => {
      // Guarded here rather than with the `disabled` attribute, which would
      // drop the button out of the tab order and take the explanation with
      // it -- the tooltip that says WHY is raised on focus (see below), so a
      // keyboard user reaching it is the whole point.
      if (spec.disabled() !== null) return;
      spec.click();
      // Repainted now rather than waiting for the next frame, so the button
      // responds to the press even if the render loop is not running.
      this.render();

      /*
       * The tooltip is refreshed only if it is still up, which it is when a
       * pointer is hovering -- a cycle button's tooltip names the state it is
       * now in, and that should update under the cursor.
       *
       * Re-showing unconditionally was wrong twice over: it put the tooltip
       * back after an action deliberately dismissed it, so a button that
       * opens something where the tooltip sits covered what it had just
       * opened; and it raised a tooltip for a click that came from code
       * rather than from a pointer that was never there.
       */
      if (!this.tip.hidden) this.showTip(button);
    });
    el.addEventListener("pointerenter", () => this.showTip(button));
    el.addEventListener("pointerleave", () => this.hideTip());
    // Keyboard focus gets the tooltip too, which `title` would not give it.
    el.addEventListener("focus", () => this.showTip(button));
    el.addEventListener("blur", () => this.hideTip());

    this.buttons.push(button);
    container.append(el);
    return el;
  }

  private showTip(button: Button): void {
    /*
     * Nothing gets a tooltip while a tray is open, because the tray is in the
     * tooltip's place: one sits over the other whichever button the pointer
     * is on -- the tray's own buttons, and the button that opened it when the
     * pointer comes back to it.
     *
     * It also keeps `offsetLeft` below honest. A tray is positioned, so it
     * becomes the offsetParent of the buttons inside it, and an offset
     * measured from the tray would place the tooltip as though the tray were
     * the bar. The buttons are unreachable while the tray is shut, so this is
     * the only state in which that could ever be read.
     */
    if (this.trayOpen) return;
    const { label, tip, key } = button.tooltip();
    const reason = button.disabled();
    this.tipLabel.textContent = label;
    // The reason displaces the description: what the control would do is of
    // no use while it cannot do it.
    this.tipText.textContent = reason ?? tip;
    // Labelled here rather than by each caller, so "1" cannot reach the
    // tooltip on its own with nothing to say what it is.
    this.tipKey.textContent = key === undefined ? "" : `key ${key}`;
    this.tipKey.hidden = key === undefined;
    this.tip.hidden = false;
    // Centred over its own button by offset within the bar, so neither the
    // viewport nor the bar's own position has to be measured.
    this.tip.style.left = `${button.el.offsetLeft + button.el.offsetWidth / 2}px`;
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }

  /**
   * Dismisses the tooltip from outside.
   *
   * For a button that opens something in the same place the tooltip occupies.
   * The pointer is still over the button after the click, so the tooltip
   * would otherwise sit on top of whatever just opened.
   */
  dismissTip(): void {
    this.hideTip();
  }

  /**
   * Call once per rendered frame.
   *
   * Writes nothing when nothing changed. At 60Hz a rebuilt icon per button
   * per frame would be pure waste, and swapping an element under the pointer
   * would also lose the hover.
   */
  render(): void {
    for (const button of this.buttons) {
      const { icon, on } = button.read();
      const lit = on ?? false;
      const reason = button.disabled();
      const paint: ButtonPaint = { icon, on: lit, disabled: reason !== null };
      if (!needsRepaint(button.shown, paint)) continue;
      const off = paint.disabled;

      if (!button.shown || button.shown.icon !== icon) {
        const next = iconElement(icon);
        button.icon.replaceWith(next);
        button.icon = next;
      }

      if (on === null) {
        // A cycle button: no lit or darkened state to express.
        delete button.el.dataset["on"];
        button.el.removeAttribute("aria-pressed");
      } else {
        button.el.dataset["on"] = on ? "true" : "false";
        button.el.setAttribute("aria-pressed", on ? "true" : "false");
      }

      /*
       * aria-disabled, not the disabled property: the button stays focusable
       * so its tooltip can say why. The click handler enforces it.
       */
      if (off) button.el.setAttribute("aria-disabled", "true");
      else button.el.removeAttribute("aria-disabled");

      const { label, tip } = button.tooltip();
      button.el.setAttribute("aria-label", `${label}. ${reason ?? tip}`);
      button.shown = paint;
    }
  }

  dispose(): void {
    this.observer.disconnect();
    window.removeEventListener("resize", this.onResize);
    this.el.remove();
  }
}
