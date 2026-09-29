import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // getUserMedia needs a secure context; localhost qualifies.
    // LAN testing from a phone requires https, see SPEC.md section 3.
    host: "localhost",
    port: 5173,
  },
  build: {
    target: "es2022",
    // MediaPipe wasm and .task assets are large and must not be inlined.
    assetsInlineLimit: 0,
  },
});
