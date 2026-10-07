import { defineConfig } from "vite";

export default defineConfig({
  /*
   * The site is deployed under /projects/tabtuber/ rather than at a domain
   * root (SPEC.md section 3). A relative base makes every emitted asset URL
   * document-relative, so the build carries no knowledge of the subpath and
   * the same output would serve from any prefix. Vite normalises this to "/"
   * for the dev server, which keeps `npm run dev` at localhost:5173/.
   */
  base: "./",
  server: {
    // getUserMedia needs a secure context; localhost qualifies.
    // LAN testing from a phone requires https, see SPEC.md section 3.
    host: "localhost",
    port: 5173,
    watch: {
      /*
       * Staged MediaPipe assets are ~23MB of binaries that are downloaded
       * once and never edited, so watching them buys nothing. On Linux each
       * watched path costs an inotify handle against a system-wide limit
       * that editors consume aggressively, and exhausting it fails the dev
       * server outright with ENOSPC rather than degrading.
       */
      ignored: [
        "**/public/models/**",
        "**/public/mediapipe/**",
        "**/dist/**",
        "**/target/**",
      ],
    },
  },
  /*
   * The tracker worker is created with `{ type: "module" }`, so the emitted
   * bundle has to be an ES module for the two to agree. Vite's default here
   * is `iife`, which happens to parse as a module and therefore works by
   * accident -- an accident that ends the moment the worker bundle contains
   * a static import rollup cannot inline (SPEC.md 4.1).
   *
   * The pairing is forced in the other direction too: Vite's dev server
   * always serves a worker as a module, so a classic worker -- which is what
   * MediaPipe's classic wasm glue needs -- cannot be developed against.
   * Hence the module glue, selected by `useModule` in worker/wasmGlue.ts.
   */
  worker: { format: "es" },
  build: {
    target: "es2022",
    // MediaPipe wasm and .task assets are large and must not be inlined.
    assetsInlineLimit: 0,
  },
});
