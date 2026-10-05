/*
 * Inline SVG icons for the toolbar (SPEC.md 9.1).
 *
 * Hand-drawn rather than pulled from an icon set: eight glyphs is not worth a
 * dependency, and a bundled font or sprite sheet would be a second asset to
 * fetch for a page whose whole point is being a single static file.
 *
 * All of them are 24x24, stroked in `currentColor` and unfilled, so the
 * toolbar's lit and darkened states are one CSS colour change rather than two
 * sets of artwork. Nothing here is sized or positioned: the stylesheet owns
 * that.
 *
 * The emotion faces are the hard ones. At 24px a face is three or four
 * strokes, and `angry` and `sad` differ only in which way the brows slope --
 * which is the real distinction between them, and a long diagonal is the part
 * that survives being small. `relaxed` is the one at risk of reading as
 * `happy`, so it gets closed eyes rather than a gentler smile, which is a
 * difference of shape instead of degree.
 */

export const ICONS = {
  /* --- microphone ------------------------------------------------------- */

  mic: `
    <rect x="9.4" y="3.4" width="5.2" height="9.9" rx="2.6" />
    <path d="M6.6 11.1v1.2a5.4 5.4 0 0 0 10.8 0v-1.2" />
    <path d="M12 18.7V21" />`,

  // The slash, not just a dimmer glyph: muted has to be readable at a glance
  // without the lit one beside it for comparison.
  micOff: `
    <rect x="9.4" y="3.4" width="5.2" height="9.9" rx="2.6" />
    <path d="M6.6 11.1v1.2a5.4 5.4 0 0 0 10.8 0v-1.2" />
    <path d="M12 18.7V21" />
    <path d="M4.2 3.6 19.8 20.4" />`,

  /* --- face tracking ---------------------------------------------------- */

  // Corner brackets plus a face: the brackets are what say "being detected"
  // rather than "a face", which is what the button actually controls.
  face: `
    <path d="M3.4 8.4V5.4a2 2 0 0 1 2-2h3" />
    <path d="M15.6 3.4h3a2 2 0 0 1 2 2v3" />
    <path d="M20.6 15.6v3a2 2 0 0 1-2 2h-3" />
    <path d="M8.4 20.6h-3a2 2 0 0 1-2-2v-3" />
    <path d="M9.6 10.2v.9M14.4 10.2v.9" />
    <path d="M9.6 14.4q2.4 2 4.8 0" />`,

  // The slash stops short of the brackets. Run corner to corner it lines up
  // with them and the whole icon reads as a resize arrow instead.
  faceOff: `
    <path d="M3.4 8.4V5.4a2 2 0 0 1 2-2h3" />
    <path d="M15.6 3.4h3a2 2 0 0 1 2 2v3" />
    <path d="M20.6 15.6v3a2 2 0 0 1-2 2h-3" />
    <path d="M8.4 20.6h-3a2 2 0 0 1-2-2v-3" />
    <path d="M9.6 10.2v.9M14.4 10.2v.9" />
    <path d="M9.6 14.4q2.4 2 4.8 0" />
    <path d="M7.4 7.4 16.6 16.6" />`,

  /* --- setup ------------------------------------------------------------- */

  /*
   * Sliders, not a gear. Two gears were drawn and both fail at 22px: the
   * teeth are about two pixels each, so one reads as a dotted ring and the
   * other as a ship's wheel. Sliders stay crisp, and they say "things to
   * adjust" where a gear says "machine configuration" -- which is the debug
   * panel's job, not this one's.
   */
  setup: `
    <path d="M5 7h14M5 12h14M5 17h14" />
    <circle cx="9.5" cy="7" r="1.9" />
    <circle cx="15" cy="12" r="1.9" />
    <circle cx="8" cy="17" r="1.9" />`,

  /* --- finger tracking --------------------------------------------------- */

  /*
   * A hand with its fingers SPREAD, not a closed palm.
   *
   * Four candidate hands were drawn and this was the only one whose fingers
   * stayed separate at 22 pixels; the others merged into a blob and read as a
   * generic "stop" hand. Spread fingers also happen to be the thing the
   * feature does -- fingers that move independently -- so the icon says what
   * is being toggled rather than merely "hand".
   */
  fingers: `
    <path d="M12 20.4a5.6 5.6 0 0 1-5.6-5.6V9.6" />
    <path d="M12 20.4a5.6 5.6 0 0 0 5.6-5.6V9.6" />
    <path d="M6.4 12.4 4.9 8.6" />
    <path d="M9.2 10.6V5.4" />
    <path d="M12 10.2V4.2" />
    <path d="M14.8 10.6V5.4" />
    <path d="M17.6 12.4 19.1 8.6" />`,

  // A mitten was the semantically better "off" -- fingers present but not
  // articulated -- and was drawn twice. Without finger strokes to give it
  // scale the silhouette reads as an egg, so the slash wins on legibility.
  fingersOff: `
    <path d="M12 20.4a5.6 5.6 0 0 1-5.6-5.6V9.6" />
    <path d="M12 20.4a5.6 5.6 0 0 0 5.6-5.6V9.6" />
    <path d="M6.4 12.4 4.9 8.6" />
    <path d="M9.2 10.6V5.4" />
    <path d="M12 10.2V4.2" />
    <path d="M14.8 10.6V5.4" />
    <path d="M17.6 12.4 19.1 8.6" />
    <path d="M5.6 5 18.4 19.2" />`,

  /* --- posture ---------------------------------------------------------- */

  standing: `
    <circle cx="12" cy="4.6" r="2.3" />
    <path d="M12 6.9v6.8" />
    <path d="M7.4 10.6 12 8.9l4.6 1.7" />
    <path d="M12 13.7 8.5 20.6M12 13.7l3.5 6.9" />`,

  /*
   * On the ground with the legs straight out: an upright torso, a horizontal
   * leg and a toe. Four strokes, and the silhouette is an L, which is what
   * survives being 22 pixels wide.
   *
   * Drawn and rejected on the way here: knees drawn up (the thigh, the shin
   * and the floor close into a wedge that reads as a ramp), crossed legs (a
   * mound under a torso -- a chess pawn), and this with a separate ground
   * line beneath (two horizontals, so the figure appears to sit on a
   * platform). The leg IS the contact with the floor; a second line saying
   * so costs more than it gives.
   */
  sitting: `
    <circle cx="8.3" cy="6.6" r="2.3" />
    <path d="M8.3 8.9V16.9" />
    <path d="M8.3 16.9h8.9" />
    <path d="M17.2 16.9V14.8" />`,

  /* --- expressions ------------------------------------------------------ */

  happy: `
    <circle cx="12" cy="12" r="9.2" />
    <path d="M9 9.8v1M15 9.8v1" />
    <path d="M7.9 14.1q4.1 3.1 8.2 0" />`,

  // Brows high on the outside and driven down at the inner corner. The
  // mirror of `sad`, and the only thing separating the two.
  angry: `
    <circle cx="12" cy="12" r="9.2" />
    <path d="M7.2 8.3 10.5 9.9M16.8 8.3 13.5 9.9" />
    <path d="M9 11.5v1M15 11.5v1" />
    <path d="M8.5 16.1q3.5-2.6 7 0" />`,

  sad: `
    <circle cx="12" cy="12" r="9.2" />
    <path d="M7.2 9.9 10.5 8.3M16.8 9.9 13.5 8.3" />
    <path d="M9 11.7v1M15 11.7v1" />
    <path d="M8.5 16.1q3.5-2.6 7 0" />`,

  // Closed eyes rather than a smaller smile: a difference of shape survives
  // being shrunk, where a difference of degree from `happy` would not.
  relaxed: `
    <circle cx="12" cy="12" r="9.2" />
    <path d="M7.3 10.3q1.7 1.8 3.4 0M13.3 10.3q1.7 1.8 3.4 0" />
    <path d="M9.1 14.6q2.9 1.9 5.8 0" />`,

  surprised: `
    <circle cx="12" cy="12" r="9.2" />
    <circle cx="9" cy="10.4" r="1.3" />
    <circle cx="15" cy="10.4" r="1.3" />
    <circle cx="12" cy="15.6" r="1.9" />`,
} as const;

export type IconName = keyof typeof ICONS;

/**
 * One icon as an `<svg>` element.
 *
 * Built by parsing the markup rather than by assembling elements one
 * `createElementNS` call at a time, which for artwork this shape is all
 * boilerplate. The input is a module constant, never anything from the
 * camera, the microphone or storage, so there is nothing here to inject into.
 */
export function iconElement(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // Decorative: the button carries the accessible name.
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}
