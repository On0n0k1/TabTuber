/*
 * VRM avatar: milestone 6.
 *
 * Consumes exactly the AvatarPose the debug rig consumes (SPEC.md 12), so the
 * solver is not a variable here. If the avatar misbehaves while the debug rig
 * beside it looks right, the fault is in loading or bone mapping, not in the
 * quaternion math -- which is the whole reason 3b was built first.
 *
 * Rotations are written to the NORMALISED humanoid, where every bone has an
 * identity rest rotation in a canonical frame. That is what lets the same
 * solver output drive any VRM regardless of how its rig was authored, and why
 * the model's proportions and scale are free (SPEC.md 2).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRM,
  VRMLoaderPlugin,
  VRMUtils,
  type VRMHumanBoneName,
} from "@pixiv/three-vrm";
import {
  BONE_INDEX,
  BONE_COUNT,
  DRIVEN_BONES,
  type AvatarPose,
  type HumanBoneName,
} from "../types.ts";

/*
 * Compile-time guarantee that every bone the solver drives is a real VRM
 * humanoid bone name. Without it the lookup below would need a cast, and a
 * typo or a future rename would surface as a bone that silently never maps --
 * which looks like the avatar under-rotating, not like an error.
 */
const _BONE_NAMES_ARE_VALID: readonly VRMHumanBoneName[] = DRIVEN_BONES;
void _BONE_NAMES_ARE_VALID;

/** Expected subject height in metres, from the reference rig (SPEC.md 7.1.1). */
const EXPECTED_HEIGHT_M = 1.6;
/** Beyond this ratio from expected, the model was probably authored wrong. */
const HEIGHT_WARN_RATIO = 1.5;

export interface VrmLoadWarning {
  readonly kind: "missing-bones" | "scale" | "version";
  readonly message: string;
}

export class VrmAvatar {
  readonly object: THREE.Group;
  /** Measured from the loaded model, not assumed (SPEC.md 7.2). */
  readonly height: number;
  /** Rest height of the hips. If this is 0 the model will sit in the floor. */
  readonly hipHeight: number;
  readonly warnings: readonly VrmLoadWarning[];
  readonly missingBones: readonly HumanBoneName[];

  private readonly vrm: VRM;
  /**
   * Bone nodes cached by BONE_INDEX. A name lookup per bone per frame is
   * avoidable work, and null entries make a missing bone a cheap skip.
   */
  private readonly nodes: Array<THREE.Object3D | null>;
  /**
   * The hips' authored rest position, captured before anything is written.
   *
   * rootOffset is a displacement, not a location, so it has to be added to
   * this rather than assigned over it -- assigning drops the hips to the
   * origin and sinks the model by its own hip height.
   */
  private readonly restHipPosition = new THREE.Vector3();

  private constructor(vrm: VRM) {
    this.vrm = vrm;
    this.object = vrm.scene;

    this.nodes = new Array<THREE.Object3D | null>(BONE_COUNT).fill(null);
    const missing: HumanBoneName[] = [];
    for (const bone of DRIVEN_BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      this.nodes[BONE_INDEX[bone]] = node;
      if (!node) missing.push(bone);
    }
    this.missingBones = missing;

    const hips = this.nodes[BONE_INDEX["hips"]];
    if (hips) this.restHipPosition.copy(hips.position);

    this.hipHeight = this.restHipPosition.y;

    const box = new THREE.Box3().setFromObject(vrm.scene);
    this.height = box.max.y - box.min.y;

    this.warnings = VrmAvatar.collectWarnings(vrm, missing, this.height);

    /*
     * Skinned meshes keep the bounding volume they were authored with, so a
     * raised arm can push geometry outside it and the whole mesh vanishes at
     * certain camera angles. Culling is not worth that failure here.
     */
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
  }

  private static collectWarnings(
    vrm: VRM,
    missing: readonly HumanBoneName[],
    height: number,
  ): VrmLoadWarning[] {
    const warnings: VrmLoadWarning[] = [];

    if (missing.length > 0) {
      // Worth surfacing rather than silently degrading: a missing bone drops
      // its share of the rotation, so the avatar under-rotates in a way that
      // reads as sluggish rather than broken.
      warnings.push({
        kind: "missing-bones",
        message: `${missing.length} driven bone(s) absent: ${missing.join(", ")}`,
      });
    }

    const ratio = height / EXPECTED_HEIGHT_M;
    if (ratio > HEIGHT_WARN_RATIO || ratio < 1 / HEIGHT_WARN_RATIO) {
      warnings.push({
        kind: "scale",
        message:
          `model is ${height.toFixed(2)}m, expected around ${EXPECTED_HEIGHT_M}m. ` +
          `Tracking is unaffected, but spring-bone physics were tuned at the ` +
          `authored scale and may look wrong.`,
      });
    }

    if (vrm.meta.metaVersion === "0") {
      warnings.push({
        kind: "version",
        message: "VRM 0.x; loaded with compatibility rotation applied.",
      });
    }

    return warnings;
  }

  static async load(source: string | ArrayBuffer): Promise<VrmAvatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf =
      typeof source === "string"
        ? await loader.loadAsync(source)
        : await loader.parseAsync(source, "");

    const vrm = gltf.userData["vrm"] as VRM | undefined;
    if (!vrm) throw new Error("file loaded but contains no VRM extension");

    // VRM 0.x faces -Z where 1.0 faces +Z; without this the avatar is
    // backwards and every rotation looks mirrored.
    if (vrm.meta.metaVersion === "0") VRMUtils.rotateVRM0(vrm);

    // Authoring tools leave geometry and joints that never deform anything.
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    VRMUtils.combineMorphs(vrm);

    return new VrmAvatar(vrm);
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  /** Writes solved rotations. Must run before update() for the frame. */
  apply(pose: AvatarPose): void {
    for (let i = 0; i < BONE_COUNT; i++) {
      const node = this.nodes[i];
      if (!node) continue;
      const o = i * 4;
      node.quaternion.set(
        pose.rotations[o] ?? 0,
        pose.rotations[o + 1] ?? 0,
        pose.rotations[o + 2] ?? 0,
        pose.rotations[o + 3] ?? 1,
      );
    }

    const hips = this.nodes[BONE_INDEX["hips"]];
    if (hips) {
      // Sway rides on the hips in normalised space, so it composes with the
      // bone rotations instead of sliding the whole scene graph. Added to the
      // rest position, never assigned over it.
      hips.position.set(
        this.restHipPosition.x + (pose.rootOffset[0] ?? 0),
        this.restHipPosition.y + (pose.rootOffset[1] ?? 0),
        this.restHipPosition.z + (pose.rootOffset[2] ?? 0),
      );
    }

    if (this.vrm.expressionManager) {
      for (const [name, weight] of pose.expressions) {
        this.vrm.expressionManager.setValue(name, weight);
      }
    }
  }

  /**
   * Drives spring bones, constraints and look-at, and copies the normalised
   * pose onto the raw rig. Call once per rendered frame, after apply().
   */
  update(dt: number): void {
    this.vrm.update(dt);
  }

  dispose(): void {
    this.object.removeFromParent();
    VRMUtils.deepDispose(this.object);
  }
}
