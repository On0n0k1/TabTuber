/*
 * Where the tracking assets live.
 *
 * One place, because the answer differs by thread. On the main thread these
 * are document-relative, exactly as they have always been: the site is served
 * from a subpath (SPEC.md 3), `import.meta.env.BASE_URL` is `./` in a build,
 * and the browser resolves that against the document. In a worker that
 * resolution would be wrong -- a worker's `location` is the worker BUNDLE's
 * url, under `assets/`, so the same relative path lands a directory too deep.
 *
 * So the worker does not resolve anything. The main thread resolves these to
 * absolute urls and sends them across (SPEC.md 4.1), and `setAssetUrls`
 * installs them. Nothing else about the paths changes, and no leading slash
 * appears at any point.
 */

/** Staged into `public/` by scripts/fetch-assets.mjs. */
export interface AssetUrls {
  /** Directory, not a file: MediaPipe appends the glue and binary names. */
  readonly wasm: string;
  readonly poseModel: string;
  readonly holisticModel: string;
}

/*
 * Document-relative, which is correct on the main thread and is what shipped
 * before the worker existed.
 */
let urls: AssetUrls = {
  wasm: `${import.meta.env.BASE_URL}mediapipe/wasm`,
  poseModel: `${import.meta.env.BASE_URL}models/pose_landmarker_full.task`,
  holisticModel: `${import.meta.env.BASE_URL}models/holistic_landmarker.task`,
};

/**
 * Resolve the defaults against the current document.
 *
 * Called on the main thread to produce what the worker is sent. This is the
 * same resolution the browser performs implicitly for a relative url; doing
 * it explicitly is what lets the result be handed to a thread that would
 * otherwise resolve it against the wrong base.
 */
export function resolveAssetUrls(): AssetUrls {
  return {
    wasm: new URL(urls.wasm, location.href).href,
    poseModel: new URL(urls.poseModel, location.href).href,
    holisticModel: new URL(urls.holisticModel, location.href).href,
  };
}

/** Install absolute urls, which is only ever the worker doing so. */
export function setAssetUrls(next: AssetUrls): void {
  urls = next;
}

export function assetUrls(): AssetUrls {
  return urls;
}
