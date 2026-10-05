/*
 * Owns the currently loaded VRM and swaps it out.
 *
 * Separate from VrmAvatar so the rest of the app holds one stable reference
 * rather than re-wiring every time a different model is dropped in. Loading a
 * 16MB VRM takes long enough that the old one is kept visible until the new
 * one is ready, so a failed load leaves something on screen rather than an
 * empty stage.
 */

import * as THREE from "three";
import { VrmAvatar, type VrmLoadWarning } from "./vrmAvatar.ts";
import type { AvatarPose } from "../types.ts";

export type AvatarStatus =
  | { readonly kind: "empty" }
  | { readonly kind: "loading"; readonly label: string }
  | {
      readonly kind: "ready";
      readonly label: string;
      readonly height: number;
      readonly warnings: readonly VrmLoadWarning[];
    }
  | { readonly kind: "error"; readonly label: string; readonly message: string };

export class AvatarSlot {
  readonly group = new THREE.Group();

  private current: VrmAvatar | null = null;
  private status: AvatarStatus = { kind: "empty" };
  private readonly listeners = new Set<(s: AvatarStatus) => void>();
  /** Rising counter so a slow load cannot replace a newer one. */
  private generation = 0;
  private visible = true;

  get avatar(): VrmAvatar | null {
    return this.current;
  }

  onStatus(cb: (s: AvatarStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  private setStatus(s: AvatarStatus): void {
    this.status = s;
    for (const cb of this.listeners) cb(s);
  }

  async load(source: string | ArrayBuffer, label: string): Promise<void> {
    const generation = ++this.generation;
    this.setStatus({ kind: "loading", label });

    let next: VrmAvatar;
    try {
      next = await VrmAvatar.load(source);
    } catch (err) {
      if (generation === this.generation) {
        this.setStatus({ kind: "error", label, message: String(err) });
      }
      return;
    }

    // Another load started while this one was parsing.
    if (generation !== this.generation) {
      next.dispose();
      return;
    }

    this.current?.dispose();
    this.current = next;
    next.setVisible(this.visible);
    this.group.add(next.object);

    this.setStatus({
      kind: "ready",
      label,
      height: next.height,
      warnings: next.warnings,
    });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.current?.setVisible(visible);
  }

  apply(pose: AvatarPose): void {
    this.current?.apply(pose);
  }

  setGaze(yawDegrees: number, pitchDegrees: number): void {
    this.current?.setGaze(yawDegrees, pitchDegrees);
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  dispose(): void {
    this.current?.dispose();
    this.current = null;
    this.listeners.clear();
  }
}

/**
 * Loads any .vrm dropped onto the page.
 *
 * Worth having beyond convenience: the browser file path is not sandboxed the
 * way a Flatpak'd authoring tool is, so a model can be tried from wherever it
 * was exported without copying it into the project first.
 */
export function enableVrmDrop(
  target: HTMLElement,
  onFile: (buffer: ArrayBuffer, name: string) => void,
): () => void {
  const prevent = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: DragEvent): void => {
    prevent(e);
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith(".vrm")) return;
    void file.arrayBuffer().then((buffer) => onFile(buffer, file.name));
  };

  target.addEventListener("dragover", prevent);
  target.addEventListener("drop", onDrop);
  return () => {
    target.removeEventListener("dragover", prevent);
    target.removeEventListener("drop", onDrop);
  };
}
