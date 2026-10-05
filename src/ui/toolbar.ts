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
 */
export interface GroupItem {
  kind: "group";
  allowNone: boolean;
  options: readonly { value: string; label: string; tip: string; key?: string; icon: IconName }[];
  get: () => string | null;
  set: (value: string | null) => void;
}

export type ToolbarItem = ToggleItem | CycleItem | GroupItem | "divider";

/** The state a click moves a cycle item to. */
export function nextCycle(values: readonly string[], current: string): string {
  const i = values.indexOf(current);
  // An unrecognised current value lands on the first state rather than
  // throwing: a stale persisted posture should not stop the button working.
  if (i < 0) return values[0] ?? current;
  return values[(i + 1) % values.length] ?? current;
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
  shown: { icon: IconName; on: boolean } | null;
  /** Current icon and lit state, read fresh each frame. */
  read: () => { icon: IconName; on: boolean | null };
  tooltip: () => { label: string; tip: string; key?: string };
  click: () => void;
}

export class Toolbar {
  private readonly el: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly tipLabel: HTMLSpanElement;
  private readonly tipText: HTMLSpanElement;
  private readonly tipKey: HTMLSpanElement;
  private readonly buttons: Button[] = [];

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

    this.render();
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
      });
      return;
    }

    for (const option of item.options) {
      this.addButton({
        read: () => ({ icon: option.icon, on: item.get() === option.value }),
        tooltip: () => option,
        click: () => item.set(nextGroup(item.get(), option.value, item.allowNone)),
      });
    }
  }

  private addButton(spec: Omit<Button, "el" | "icon" | "shown">): void {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tool";

    const initial = spec.read();
    const icon = iconElement(initial.icon);
    el.append(icon);

    const button: Button = { el, icon, shown: null, ...spec };

    el.addEventListener("click", () => {
      spec.click();
      // Repainted now rather than waiting for the next frame, so the button
      // responds to the press even if the render loop is not running.
      this.render();
      this.showTip(button);
    });
    el.addEventListener("pointerenter", () => this.showTip(button));
    el.addEventListener("pointerleave", () => this.hideTip());
    // Keyboard focus gets the tooltip too, which `title` would not give it.
    el.addEventListener("focus", () => this.showTip(button));
    el.addEventListener("blur", () => this.hideTip());

    this.buttons.push(button);
    this.el.append(el);
  }

  private showTip(button: Button): void {
    const { label, tip, key } = button.tooltip();
    this.tipLabel.textContent = label;
    this.tipText.textContent = tip;
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
      if (button.shown && button.shown.icon === icon && button.shown.on === lit) continue;

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

      const { label, tip } = button.tooltip();
      button.el.setAttribute("aria-label", `${label}. ${tip}`);
      button.shown = { icon, on: lit };
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
