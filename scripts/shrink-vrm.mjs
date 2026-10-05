/*
 * Removes the metadata thumbnail from a .vrm, run with
 * `npm run shrink-vrm <in> [out]`.
 *
 * A VRM carries a preview image for model browsers and galleries -- VRoid Hub
 * shows it, this app never does. On a VRoid export it is a 2048px PNG and
 * routinely the single largest image in the file: measured at 2.11MB of a
 * 13.49MB model, about 16%, downloaded by every visitor to be ignored.
 *
 * VRoid will not export without one and its texture floor is 2048, so this is
 * the only way to drop it. three-vrm reads it behind a null check, so a model
 * without one loads normally.
 *
 * Worth knowing before using the output elsewhere: a stripped model shows no
 * preview in tools that expect one. This is for serving, not for archiving.
 */

import { readFile, writeFile } from "node:fs/promises";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB/VRM container");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString("utf8"));
    else if (type === CHUNK_BIN) bin = body;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json || !bin) throw new Error("missing JSON or BIN chunk");
  return { json, bin };
}

/** Every place a bufferView index appears, so none is left pointing at the gap. */
function remapBufferViews(json, drop) {
  const shift = (i) => (i === undefined || i === null ? i : i > drop ? i - 1 : i);
  for (const a of json.accessors ?? []) {
    a.bufferView = shift(a.bufferView);
    if (a.sparse) {
      a.sparse.indices.bufferView = shift(a.sparse.indices.bufferView);
      a.sparse.values.bufferView = shift(a.sparse.values.bufferView);
    }
  }
  for (const im of json.images ?? []) im.bufferView = shift(im.bufferView);
}

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

export function stripThumbnail(buf) {
  const { json, bin } = parseGlb(buf);
  const meta = json.extensions?.VRMC_vrm?.meta;
  const imageIndex = meta?.thumbnailImage;
  if (imageIndex === undefined) return { buf, removed: 0 };

  const image = json.images[imageIndex];
  const viewIndex = image.bufferView;
  const view = json.bufferViews[viewIndex];

  // Only safe if nothing else points at the same bytes.
  const sharers = (json.images ?? []).filter((im) => im.bufferView === viewIndex).length
    + (json.accessors ?? []).filter((a) => a.bufferView === viewIndex).length;
  if (sharers > 1) throw new Error("the thumbnail's bufferView is shared; refusing to remove it");

  const start = view.byteOffset ?? 0;
  const end = start + view.byteLength;
  const removed = view.byteLength;

  // Cut the bytes, then pull every later view back over the gap.
  const nextBin = Buffer.concat([bin.subarray(0, start), bin.subarray(end)]);
  json.bufferViews.splice(viewIndex, 1);
  for (const v of json.bufferViews) {
    if ((v.byteOffset ?? 0) > start) v.byteOffset = (v.byteOffset ?? 0) - removed;
  }
  remapBufferViews(json, viewIndex);

  // Then the image itself, and anything referring to it by index.
  json.images.splice(imageIndex, 1);
  const shiftImage = (i) => (i === undefined ? i : i > imageIndex ? i - 1 : i);
  for (const t of json.textures ?? []) {
    t.source = shiftImage(t.source);
    const webp = t.extensions?.EXT_texture_webp;
    if (webp) webp.source = shiftImage(webp.source);
  }
  delete meta.thumbnailImage;
  json.buffers[0].byteLength = nextBin.length;

  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length), 0x20);
  const binPad = Buffer.alloc(pad4(nextBin.length), 0);
  const jsonLen = jsonBuf.length + jsonPad.length;
  const binLen = nextBin.length + binPad.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonLen + 8 + binLen, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonLen, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binLen, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return {
    buf: Buffer.concat([header, jsonHeader, jsonBuf, jsonPad, binHeader, nextBin, binPad]),
    removed,
  };
}

const input = process.argv[2];
if (!input) {
  console.error("usage: npm run shrink-vrm <in.vrm> [out.vrm]");
  process.exit(1);
}
const output = process.argv[3] ?? input.replace(/\.vrm$/i, ".min.vrm");
const before = await readFile(input);
const { buf, removed } = stripThumbnail(before);
await writeFile(output, buf);

const mb = (n) => (n / 1048576).toFixed(2);
console.log(`in   ${mb(before.length)} MB  ${input}`);
console.log(`out  ${mb(buf.length)} MB  ${output}`);
console.log(removed === 0
  ? "no thumbnail to remove"
  : `removed ${mb(removed)} MB of thumbnail (${(100 * removed / before.length).toFixed(1)}%)`);
