/*
 * Manual expression control (SPEC.md 13).
 *
 * Replaces inferring emotion from the face. Inference has to decide that a
 * smile plus a cheek squint means `happy` at some weight, and it is wrong
 * often enough to matter -- an avatar committing to an expression the
 * performer was not making reads worse than one that stays neutral. Blink and
 * gaze remain tracked because those are measurements; an emotion is not.
 *
 * It is also the wrong model of what an expression IS here. A VTuber chooses
 * to look pleased at a moment, the way they would choose a camera angle. That
 * is a performance decision, not a fact about their face, so it belongs under
 * their control.
 *
 * Keys are bound because the panel is unreachable mid-stream.
 */

/** VRM 1.0 emotion presets, in the order the number keys select them. */
export const EXPRESSIONS = ["happy", "angry", "sad", "relaxed", "surprised"] as const;
export type ExpressionName = (typeof EXPRESSIONS)[number];

export interface ExpressionParams {
  /** Seconds to fade between expressions. */
  fade: number;
  /** Respond to the number keys. */
  hotkeys: boolean;
}

export const DEFAULT_EXPRESSION_PARAMS: ExpressionParams = {
  // Slow enough to read as a change of mood rather than a cut, fast enough
  // to land on the beat of whatever prompted it.
  fade: 0.18,
  hotkeys: true,
};

export class ExpressionControl {
  params: ExpressionParams = { ...DEFAULT_EXPRESSION_PARAMS };

  private target: ExpressionName | null = null;
  private readonly weights: Record<ExpressionName, number> = {
    happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0,
  };
  private detachKeys: (() => void) | null = null;

  get active(): ExpressionName | null {
    return this.target;
  }

  /**
   * Selects an expression, or clears it with null.
   *
   * Selecting the active one clears it, so a key is a toggle rather than
   * something needing a separate "back to neutral" press.
   */
  set(name: ExpressionName | null): void {
    this.target = this.target === name ? null : name;
  }

  /**
   * Binds the number keys 1 to 5, and 0 or Escape for neutral.
   *
   * Ignores events from text fields, or typing a value into the panel would
   * also change the avatar's face.
   */
  bindKeys(target: EventTarget = window): () => void {
    const onKey = (event: Event): void => {
      if (!this.params.hotkeys) return;
      const e = event as KeyboardEvent;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;

      if (e.key === "0" || e.key === "Escape") {
        this.target = null;
        return;
      }
      const index = Number(e.key) - 1;
      const name = EXPRESSIONS[index];
      if (name) this.set(name);
    };

    target.addEventListener("keydown", onKey);
    this.detachKeys = () => target.removeEventListener("keydown", onKey);
    return this.detachKeys;
  }

  dispose(): void {
    this.detachKeys?.();
    this.detachKeys = null;
  }

  /** Call once per rendered frame, after the tracked expressions are written. */
  update(dt: number, out: Map<string, number>): void {
    const k = this.params.fade <= 0 ? 1 : Math.min(1, 1 - Math.exp(-dt / this.params.fade));
    for (const name of EXPRESSIONS) {
      const want = name === this.target ? 1 : 0;
      this.weights[name] += (want - this.weights[name]) * k;
      // Snapped once imperceptible, so a cleared expression reaches exactly
      // zero rather than leaving a trace of itself on the face forever.
      if (this.weights[name] < 0.002) this.weights[name] = 0;
      out.set(name, this.weights[name]);
    }
  }
}
