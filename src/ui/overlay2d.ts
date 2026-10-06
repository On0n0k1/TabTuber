/*
 * 2D landmark overlay drawn over the camera preview.
 *
 * This is the verification step for milestone 2 (SPEC.md section 12): confirm
 * tracking works in image space before any of it is interpreted in 3D. When
 * the 3D views look wrong later, this answers "is the tracker fine and the
 * solver wrong, or is the tracker itself struggling?" -- which is why it stays
 * in the build rather than being deleted once 3D works.
 *
 * Draws raw image-space landmarks and is CSS-mirrored to match the preview,
 * so no coordinate flipping happens here.
 */

import { HAND, HAND_CONNECTIONS, THUMB_CONNECTIONS } from "../tracker/handLandmarks.ts";
import { CONNECTIONS, CONNECTION_GROUPS } from "../tracker/landmarks.ts";
import { HAND_LANDMARK_COUNT, type HandFrame } from "../types.ts";
import { REGION_COLORS, toCss } from "../render/palette.ts";
import type { PoseFrame } from "../types.ts";

/**
 * Landmarks below this are drawn hollow rather than filled. The threshold is
 * cosmetic here, but seeing which joints the model is unsure about is how the
 * real gating thresholds get chosen (SPEC.md 5.7, 13).
 */
const LOW_VISIBILITY = 0.5;

export class Overlay2D {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private visible = true;

  constructor(parent: HTMLElement) {
    this.canvas.className = "overlay2d";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    parent.append(this.canvas);
  }

  /** The canvas itself, for anything that positions or hides it. */
  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.canvas.style.display = v ? "" : "none";
  }

  /** Matches the backing store to the preview's displayed size. */
  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(frame: PoseFrame, displayWidth: number, displayHeight: number): void {
    if (!this.visible) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const x = (i: number): number => (frame.image[i * 3] ?? 0) * displayWidth;
    const y = (i: number): number => (frame.image[i * 3 + 1] ?? 0) * displayHeight;

    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";

    for (const group of CONNECTION_GROUPS) {
      ctx.strokeStyle = toCss(REGION_COLORS[group], 0.9);
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS[group]) {
        ctx.moveTo(x(a), y(a));
        ctx.lineTo(x(b), y(b));
      }
      ctx.stroke();
    }

    this.drawHand(frame.leftHand, "L", displayWidth, displayHeight, 0x4cc9f0);
    this.drawHand(frame.rightHand, "R", displayWidth, displayHeight, 0xf77f00);

    for (let i = 0; i < frame.visibility.length; i++) {
      const v = frame.visibility[i] ?? 0;
      ctx.beginPath();
      ctx.arc(x(i), y(i), 3, 0, Math.PI * 2);
      if (v >= LOW_VISIBILITY) {
        ctx.fillStyle = toCss(0xffffff, 0.95);
        ctx.fill();
      } else {
        ctx.strokeStyle = toCss(0xffffff, 0.5);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.lineWidth = 2.5;
      }
    }
  }

  /**
   * Draws the real 21-point hand, with the thumb highlighted.
   *
   * The pose model contributes only three crude knuckle estimates, so without
   * this the overlay shows nothing of what actually drives the palm frame.
   *
   * It also reports the decisive comparison for a flipped hand: which side
   * the CAMERA sees, read from the winding of the projected palm triangle and
   * therefore unambiguous, against which side the MODEL believes it sees,
   * read from the depth of its own landmarks. When those disagree the tracker
   * has mistaken the palm for the back of the hand, and no amount of solver
   * work can recover it.
   */
  private drawHand(
    hand: HandFrame | null,
    label: string,
    w: number,
    h: number,
    color: number,
  ): void {
    if (!hand?.present) return;
    const ctx = this.ctx;

    const x = (i: number): number => (hand.image[i * 2] ?? 0) * w;
    const y = (i: number): number => (hand.image[i * 2 + 1] ?? 0) * h;

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = toCss(color, 0.9);
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(x(a), y(a));
      ctx.lineTo(x(b), y(b));
    }
    ctx.stroke();

    // Thumb in a colour nothing else uses, since which side it is on is the
    // whole question.
    ctx.strokeStyle = toCss(0x8aff80, 1);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const [a, b] of THUMB_CONNECTIONS) {
      ctx.moveTo(x(a), y(a));
      ctx.lineTo(x(b), y(b));
    }
    ctx.stroke();

    for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
      ctx.beginPath();
      ctx.arc(x(i), y(i), 1.6, 0, Math.PI * 2);
      ctx.fillStyle = toCss(0xffffff, 0.9);
      ctx.fill();
    }

    // Winding of the projected palm: positive and negative correspond to the
    // two sides of the hand, and the projection cannot be wrong about it.
    const ax = x(HAND.INDEX_MCP) - x(HAND.WRIST);
    const ay = y(HAND.INDEX_MCP) - y(HAND.WRIST);
    const bx = x(HAND.PINKY_MCP) - x(HAND.WRIST);
    const by = y(HAND.PINKY_MCP) - y(HAND.WRIST);
    const seen = ax * by - ay * bx;

    // The model's own belief, from the depth it assigned those same points.
    const wz = hand.world;
    const fx = (wz[HAND.MIDDLE_MCP * 3] ?? 0) - (wz[HAND.WRIST * 3] ?? 0);
    const fy = (wz[HAND.MIDDLE_MCP * 3 + 1] ?? 0) - (wz[HAND.WRIST * 3 + 1] ?? 0);
    const cx2 = (wz[HAND.PINKY_MCP * 3] ?? 0) - (wz[HAND.INDEX_MCP * 3] ?? 0);
    const cy2 = (wz[HAND.PINKY_MCP * 3 + 1] ?? 0) - (wz[HAND.INDEX_MCP * 3 + 1] ?? 0);
    // Only the z component of forward x across is needed: its sign is which
    // way the palm faces along the view axis.
    const believed = fx * cy2 - fy * cx2;

    ctx.save();
    ctx.scale(-1, 1); // undo the preview mirror so the text reads
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = Math.sign(seen) === Math.sign(believed)
      ? toCss(0x8aff80, 1)
      : toCss(0xff5566, 1);
    const row = label === "L" ? 14 : 28;
    ctx.fillText(
      `${label} seen ${seen > 0 ? "+" : "-"}  model ${believed > 0 ? "+" : "-"}` +
        `${Math.sign(seen) === Math.sign(believed) ? "" : "  FLIPPED"}`,
      -w + 6,
      row,
    );
    ctx.restore();
  }
}

