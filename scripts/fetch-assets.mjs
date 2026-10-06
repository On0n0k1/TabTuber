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
 * Both backends' models. Holistic is the default; pose is the fallback for
 * devices that cannot afford it (SPEC.md 9.5, 11).
 *
 * Deployments carry ~9MB they will often not serve. Clients do not: a browser
 * fetches whichever model its backend asks for, and pose's 9.4MB is smaller
 * than Holistic's 14MB -- so the slow device this exists for downloads less,
 * not more, as long as it does not load both in one session.
 */
const DOWNLOADS = [
  {
    file: "holistic_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task",
  },
  {
    file: "pose_landmarker_full.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
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
