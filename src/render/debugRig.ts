/*
 * Milestone 3b: a real bone hierarchy driven by solved rotations.
 *
 * Built in code from the reference rig (SPEC.md 7.1.1) so the solver is
 * verifiable with no Blender asset in existence. It consumes exactly the
 * AvatarPose the VRM will later consume, so when the avatar arrives the only
 * new variables are VRM loading and bone mapping -- not the quaternion math.
 *
 * Rest rotation of every node is identity, matching three-vrm's normalised
 * humanoid, so applying a solved local rotation is a direct assignment.
 *
 * Carries the asymmetry markers from SPEC.md 7.1.2: a left-only shoulder
 * block and a forward-pointing nose wedge. A symmetric rig hides mirror and
 * handedness bugs, which are the most common failure here.
 */

import * as THREE from "three";
import { REFERENCE_RIG, type RestBone } from "../solver/referenceRig.ts";
import { REGION_COLORS } from "./palette.ts";
import type { ConnectionGroup } from "../tracker/landmarks.ts";
import { BONE_INDEX, type AvatarPose, type HumanBoneName } from "../types.ts";

function regionOf(bone: HumanBoneName): ConnectionGroup {
  if (bone.startsWith("left")) {
    return bone.includes("Leg") || bone.includes("Foot") ? "leftLeg" : "leftArm";
  }
  if (bone.startsWith("right")) {
    return bone.includes("Leg") || bone.includes("Foot") ? "rightLeg" : "rightArm";
  }
  return bone === "neck" || bone === "head" ? "head" : "torso";
}

/** Eyes sit inside the head and would otherwise be invisible clutter. */
const HIDDEN_BONES: ReadonlySet<HumanBoneName> = new Set(["leftEye", "rightEye"]);

const BONE_RADIUS = 0.022;
const JOINT_RADIUS = 0.03;

export class DebugRig {
  readonly object = new THREE.Group();

  private readonly nodes = new Map<HumanBoneName, THREE.Object3D>();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor() {
    const jointMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0,
    });
    this.materials.push(jointMaterial);

    for (const bone of REFERENCE_RIG) {
      const node = new THREE.Object3D();
      node.name = bone.name;

      const parent = bone.parent ? this.nodes.get(bone.parent) : undefined;
      const parentHead = bone.parent
        ? (REFERENCE_RIG.find((b) => b.name === bone.parent)?.head ?? [0, 0, 0])
        : [0, 0, 0];

      // Offset from the parent's head, since every node sits at its own head
      // with identity rest rotation.
      node.position.set(
        bone.head[0] - (parentHead[0] ?? 0),
        bone.head[1] - (parentHead[1] ?? 0),
        bone.head[2] - (parentHead[2] ?? 0),
      );

      (parent ?? this.object).add(node);
      this.nodes.set(bone.name, node);

      if (!HIDDEN_BONES.has(bone.name)) {
        this.addBoneVisual(node, bone, jointMaterial);
      }
    }

    this.addAsymmetryMarkers();
  }

  private addBoneVisual(
    node: THREE.Object3D,
    bone: RestBone,
    jointMaterial: THREE.Material,
  ): void {
    const dx = bone.tail[0] - bone.head[0];
    const dy = bone.tail[1] - bone.head[1];
    const dz = bone.tail[2] - bone.head[2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-5) return;

    // Six sides: this is a debug instrument, and a low-poly silhouette makes
    // twist readable where a smooth cylinder does not.
    const geometry = new THREE.CylinderGeometry(BONE_RADIUS, BONE_RADIUS * 0.6, length, 6);
    const material = new THREE.MeshStandardMaterial({
      color: REGION_COLORS[regionOf(bone.name)],
      roughness: 0.55,
      metalness: 0,
      flatShading: true,
    });
    this.geometries.push(geometry);
    this.materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    // Cylinders are built along +Y, so align to the rest direction and push
    // the midpoint halfway down the bone.
    const dir = new THREE.Vector3(dx / length, dy / length, dz / length);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.position.copy(dir).multiplyScalar(length / 2);
    node.add(mesh);

    // Joint markers make rotation legible where bare segments do not.
    const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 8, 6);
    this.geometries.push(jointGeometry);
    node.add(new THREE.Mesh(jointGeometry, jointMaterial));
  }

  /**
   * Deliberate asymmetry (SPEC.md 7.1.2). If the left block appears on the
   * right of the screen or the nose wedge points away, an axis is flipped --
   * a symmetric rig would look perfectly plausible while being mirrored.
   */
  private addAsymmetryMarkers(): void {
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0x8aff80,
      roughness: 0.5,
      flatShading: true,
    });
    this.materials.push(markerMaterial);

    const blockGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    this.geometries.push(blockGeometry);
    const block = new THREE.Mesh(blockGeometry, markerMaterial);
    block.position.set(0.06, 0.06, 0);
    this.nodes.get("leftShoulder")?.add(block);

    // Cone points along +Y by default; rotate it to face forward, +Z.
    const noseGeometry = new THREE.ConeGeometry(0.035, 0.12, 4);
    this.geometries.push(noseGeometry);
    const nose = new THREE.Mesh(noseGeometry, markerMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.07, 0.09);
    this.nodes.get("head")?.add(nose);
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }

  /** Horizontal offset, so the rig can sit beside the stick figure or over it. */
  setOffsetX(x: number): void {
    this.object.position.x = x;
  }

  apply(pose: AvatarPose): void {
    for (const bone of REFERENCE_RIG) {
      const node = this.nodes.get(bone.name);
      if (!node) continue;
      const o = BONE_INDEX[bone.name] * 4;
      node.quaternion.set(
        pose.rotations[o] ?? 0,
        pose.rotations[o + 1] ?? 0,
        pose.rotations[o + 2] ?? 0,
        pose.rotations[o + 3] ?? 1,
      );
    }

    // Hip sway rides on the root so it does not disturb bone rotations.
    const hips = this.nodes.get("hips");
    if (hips) {
      const rest = REFERENCE_RIG[0];
      hips.position.set(
        (rest?.head[0] ?? 0) + (pose.rootOffset[0] ?? 0),
        (rest?.head[1] ?? 0) + (pose.rootOffset[1] ?? 0),
        (rest?.head[2] ?? 0) + (pose.rootOffset[2] ?? 0),
      );
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
