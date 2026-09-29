/*
 * Milestone 3a: bones drawn directly between landmark POSITIONS.
 *
 * Permanent ground truth (SPEC.md section 12). It shares nothing with the
 * rotation solver, so when the debug rig or the avatar looks wrong, whichever
 * of the two disagrees with this is the one that is broken. Deleting it once
 * 3D works would throw away the only independent reference in the pipeline.
 *
 * Consumes points already converted by mpToThree -- it does no axis work.
 */

import * as THREE from "three";
import { CONNECTIONS, CONNECTION_GROUPS, type ConnectionGroup } from "../tracker/landmarks.ts";
import { REGION_COLORS } from "./palette.ts";
import { LANDMARK_COUNT } from "../types.ts";

/** Joints below this are dimmed, matching the 2D overlay's convention. */
const LOW_VISIBILITY = 0.5;

export class StickFigure {
  readonly object = new THREE.Group();

  private readonly segments = new Map<ConnectionGroup, THREE.LineSegments>();
  private readonly joints: THREE.Points;
  private readonly jointPositions = new Float32Array(LANDMARK_COUNT * 3);
  private readonly jointAlpha = new Float32Array(LANDMARK_COUNT);

  constructor() {
    for (const group of CONNECTION_GROUPS) {
      const pairs = CONNECTIONS[group];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(pairs.length * 2 * 3), 3),
      );
      const material = new THREE.LineBasicMaterial({
        color: REGION_COLORS[group],
        transparent: true,
        opacity: 0.95,
        // Without this the figure disappears behind the grid helper from
        // some angles, which reads as a tracking dropout.
        depthTest: false,
      });
      const line = new THREE.LineSegments(geometry, material);
      line.renderOrder = 1;
      this.segments.set(group, line);
      this.object.add(line);
    }

    const jointGeometry = new THREE.BufferGeometry();
    jointGeometry.setAttribute("position", new THREE.BufferAttribute(this.jointPositions, 3));
    jointGeometry.setAttribute("alpha", new THREE.BufferAttribute(this.jointAlpha, 1));

    // Joint markers make rotation legible where bare segments do not
    // (SPEC.md 7.1.2). Per-point alpha carries visibility, so uncertain
    // joints are visible as uncertain rather than silently wrong.
    const jointMaterial = new THREE.PointsMaterial({
      size: 0.022,
      sizeAttenuation: true,
      color: 0xffffff,
      transparent: true,
      depthTest: false,
    });
    jointMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute float alpha;\nvarying float vAlpha;\nvoid main() {")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vAlpha = alpha;");
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying float vAlpha;\nvoid main() {")
        .replace(
          "#include <opaque_fragment>",
          "#include <opaque_fragment>\n  gl_FragColor.a *= vAlpha;",
        );
    };

    this.joints = new THREE.Points(jointGeometry, jointMaterial);
    this.joints.renderOrder = 2;
    this.object.add(this.joints);
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }

  /** `points` is LANDMARK_COUNT * 3 in three.js space, from mpToThree. */
  update(points: Float32Array, visibility: Float32Array): void {
    for (const group of CONNECTION_GROUPS) {
      const line = this.segments.get(group);
      if (!line) continue;

      const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attr.array as Float32Array;
      const pairs = CONNECTIONS[group];

      for (let p = 0; p < pairs.length; p++) {
        const pair = pairs[p];
        if (!pair) continue;
        const [a, b] = pair;
        const dst = p * 6;
        const sa = a * 3;
        const sb = b * 3;
        array[dst] = points[sa] ?? 0;
        array[dst + 1] = points[sa + 1] ?? 0;
        array[dst + 2] = points[sa + 2] ?? 0;
        array[dst + 3] = points[sb] ?? 0;
        array[dst + 4] = points[sb + 1] ?? 0;
        array[dst + 5] = points[sb + 2] ?? 0;
      }
      attr.needsUpdate = true;
    }

    this.jointPositions.set(points);
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const v = visibility[i] ?? 1;
      this.jointAlpha[i] = v >= LOW_VISIBILITY ? 1 : 0.25;
    }
    this.joints.geometry.getAttribute("position").needsUpdate = true;
    this.joints.geometry.getAttribute("alpha").needsUpdate = true;
  }

  dispose(): void {
    for (const line of this.segments.values()) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.joints.geometry.dispose();
    (this.joints.material as THREE.Material).dispose();
  }
}
