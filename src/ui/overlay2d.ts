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

import { CONNECTIONS, CONNECTION_GROUPS } from "../tracker/landmarks.ts";
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
}
