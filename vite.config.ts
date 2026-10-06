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
  build: {
    target: "es2022",
    // MediaPipe wasm and .task assets are large and must not be inlined.
    assetsInlineLimit: 0,
  },
});
