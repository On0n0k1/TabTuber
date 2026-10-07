import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

/** Where the rendered documentation is served from, under the site root. */
const DOCS = "/docs";

/**
 * Resolves `/docs` and `/docs/` to the documentation's index page.
 *
 * GitHub Pages does this for any directory holding an index.html -- a bare path
 * 301s to its slashed form, which then serves the index. Neither Vite server
 * does: the dev server serves publicDir files without resolving a directory
 * index, and `vite preview` does not redirect a bare directory either. So
 * typing localhost:5173/docs got nothing while the deployed site was fine,
 * which is the worst way round for a link nobody can test locally.
 *
 * The redirect is the part that matters, and the reason this is not simply a
 * rewrite of both forms: served at `/docs`, the page loads but every relative
 * URL in it resolves one level too high -- `docs.css` becomes `/docs.css` and
 * `getting-started.html` becomes `/getting-started.html`. The slash has to be
 * real by the time the browser resolves the document's links.
 */
function docsDirectoryIndex(): Plugin {
  const handle = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void => {
    const [path, query] = (req.url ?? "/").split("?");
    const suffix = query === undefined ? "" : `?${query}`;

    if (path === DOCS) {
      res.statusCode = 301;
      res.setHeader("Location", `${DOCS}/${suffix}`);
      res.end();
      return;
    }

    if (path === `${DOCS}/`) req.url = `${DOCS}/index.html${suffix}`;

    next();
  };

  return {
    name: "docs-directory-index",
    // Both servers, because both get used to look at the docs: `dev` while
    // writing them and `preview` to check the built layout before deploying.
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  plugins: [docsDirectoryIndex()],
  /*
   * The site is deployed under /projects/tabtuber/ rather than at a domain
   * root (SPEC.md section 3). A relative base makes every emitted asset URL
   * document-relative, so the build carries no knowledge of the subpath and
   * the same output would serve from any prefix. Vite normalises this to "/"
   * for the dev server, which keeps `npm run dev` at localhost:5173/.
   */
  base: "./",
  /*
   * No SPA fallback. The app is one page with no client-side routing, so the
   * fallback never actually serves it -- all it does is answer an unknown path
   * with index.html and a 200, which is how `/docs` silently served the app
   * instead of the documentation, and the same shape as the missing-model bug
   * that handed index.html to a model fetch (SPEC.md 16).
   *
   * With this, `npm run preview` resolves dist/docs/ the way GitHub Pages does,
   * so the deployed layout can be checked before it is deployed.
   */
  appType: "mpa",
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
