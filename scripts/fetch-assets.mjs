/*
 * Stages MediaPipe runtime assets into public/.
 *
 * Both the wasm bundle and the model are self-hosted rather than pulled from
 * a CDN at runtime: a CDN dependency means the page is broken offline and is
 * hostage to an upstream path change (SPEC.md section 9).
 *
 * The .task model is not committed -- it is ~9MB of binary that git would
 * carry forever. This script is idempotent and runs before dev and build.
 */

import { createWriteStream } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const WASM_SRC = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const WASM_DEST = join(root, "public/mediapipe/wasm");

/**
 * "full" is the default per SPEC.md section 9. lite trades noticeable
 * accuracy for speed we do not need; heavy is ~29MB for a marginal gain.
 */
const MODELS = {
  lite: "pose_landmarker_lite",
  full: "pose_landmarker_full",
  heavy: "pose_landmarker_heavy",
};

const variant = process.env["POSE_MODEL"] ?? "full";
const name = MODELS[variant];
if (!name) {
  console.error(`unknown POSE_MODEL "${variant}" (expected: ${Object.keys(MODELS).join(", ")})`);
  process.exit(1);
}

/**
 * Holistic first: it is the default backend (SPEC.md 11), so a cold checkout
 * has what it needs soonest if the second download fails or is interrupted.
 * The pose model is still staged, since that backend stays selectable as a
 * fallback and reference.
 */
const DOWNLOADS = [
  {
    file: "holistic_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task",
  },
  {
    file: `${name}.task`,
    url: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${name}/float16/latest/${name}.task`,
  },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download({ file, url }) {
  const dest = join(root, "public/models", file);

  if (await exists(dest)) {
    console.log(`model -> public/models/${file} (cached)`);
    return;
  }

  await mkdir(dirname(dest), { recursive: true });
  console.log(`model -> fetching ${file} ...`);

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));

  const { size } = await stat(dest);
  console.log(`model -> public/models/${file} (${(size / 1e6).toFixed(1)} MB)`);
}

async function main() {
  await mkdir(dirname(WASM_DEST), { recursive: true });
  await cp(WASM_SRC, WASM_DEST, { recursive: true });
  console.log(`wasm  -> public/mediapipe/wasm`);

  for (const item of DOWNLOADS) await download(item);
}

await main();
