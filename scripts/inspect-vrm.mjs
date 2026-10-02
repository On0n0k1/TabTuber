/*
 * Reports what a .vrm contains, run with `npm run inspect-vrm [path]`.
 *
 * Checks the things that make an avatar misbehave in ways that do not look
 * like errors: a missing bone silently drops its share of the rotation, so
 * the avatar under-rotates and reads as sluggish rather than broken
 * (SPEC.md 7.1). Parses the glTF container directly so it needs no browser.
 */

import { open } from "node:fs/promises";

/** Must match DRIVEN_BONES in src/types.ts. */
const DRIVEN = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
  "leftEye", "rightEye",
];

const path = process.argv[2] ?? "public/models/avatar.vrm";

const file = await open(path, "r");
try {
  const header = Buffer.alloc(20);
  await file.read(header, 0, 20, 0);
  if (header.toString("utf8", 0, 4) !== "glTF") {
    throw new Error(`${path} is not a glTF/VRM container`);
  }
  const total = header.readUInt32LE(8);
  const jsonLength = header.readUInt32LE(12);

  const jsonBuf = Buffer.alloc(jsonLength);
  await file.read(jsonBuf, 0, jsonLength, 20);
  const gltf = JSON.parse(jsonBuf.toString("utf8"));

  const ext = gltf.extensions ?? {};
  const isV1 = "VRMC_vrm" in ext;
  const vrm = isV1 ? ext.VRMC_vrm : ext.VRM;
  if (!vrm) throw new Error(`${path} has no VRM extension`);

  const bones = isV1
    ? Object.keys(vrm.humanoid?.humanBones ?? {})
    : (vrm.humanoid?.humanBones ?? []).map((b) => b.bone);

  const missing = DRIVEN.filter((b) => !bones.includes(b));

  console.log(`file        : ${path} (${(total / 1e6).toFixed(1)} MB)`);
  console.log(`VRM version : ${isV1 ? "1.0" : `0.x (spec ${vrm.specVersion ?? "?"})`}`);
  console.log(`humanoid    : ${bones.length} bones mapped`);
  console.log(`spring bones: ${"VRMC_springBone" in ext || !!vrm.secondaryAnimation}`);
  // Declared in extensionsUsed rather than the extensions object, since it
  // applies per material rather than to the document.
  const used = gltf.extensionsUsed ?? [];
  console.log(`MToon       : ${used.includes("VRMC_materials_mtoon") || used.includes("VRM_materials_mtoon")}`);
  console.log(`meshes      : ${(gltf.meshes ?? []).length}, materials: ${(gltf.materials ?? []).length}`);

  if (missing.length === 0) {
    console.log(`driven 22   : ALL PRESENT`);
  } else {
    console.log(`driven 22   : MISSING ${missing.length} -> ${missing.join(", ")}`);
    console.log("");
    console.log("A missing bone drops its share of the rotation rather than");
    console.log("redistributing it, so the avatar will under-rotate.");
  }
  if (!isV1) {
    console.log("");
    console.log("VRM 0.x loads via a compatibility path; 1.0 is preferred (SPEC.md 7.2).");
  }
} finally {
  await file.close();
}
