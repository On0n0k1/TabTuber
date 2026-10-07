/*
 * Loading MediaPipe's wasm glue inside a module worker.
 *
 * Two things here are not optional, and both were found by measurement
 * rather than reasoning (SPEC.md 4.1).
 *
 * ONE: the glue has to be the ES-module flavour. `vision_wasm_internal.js`
 * is a classic script that defines `ModuleFactory` as a top-level `var` and
 * relies on `importScripts` to turn that into a global. A module worker has
 * no `importScripts`, so MediaPipe falls back to a dynamic import, the `var`
 * stays module-scoped, and the task dies with "ModuleFactory not set".
 * `FilesetResolver.forVisionTasks(path, true)` selects
 * `vision_wasm_module_internal.js`, which is the same glue as an ES module
 * that assigns `globalThis.ModuleFactory` and default-exports the factory.
 *
 * The pairing is forced, not preferred. A classic worker with the classic
 * glue would work too, but Vite's dev server always serves a worker as a
 * module (`workerType = isBundled ? ... : "module"`), so that combination
 * cannot be developed against. The other two combinations each fail.
 *
 * TWO: the global has to be put back before every build. MediaPipe does
 * `self.ModuleFactory = self.Module = void 0` the moment it has used the
 * factory, then re-loads the glue for the next task. On the main thread that
 * re-load is a fresh <script> tag, which re-runs the script and re-sets the
 * global. In a module worker it is a dynamic import, which the module map
 * serves from cache WITHOUT re-running the body -- so the second task finds
 * the global undefined and throws.
 *
 * That second point is what makes `TrackerHost.use` possible here at all:
 * it deliberately keeps the old backend alive and serving frames until the
 * new one has finished loading, which means two tasks exist at once for the
 * length of a model download. Without re-arming, the switch fails every
 * time and a failed switch takes tracking down with it.
 */

/** Selects the ES-module flavour of the glue. See above; not a preference. */
export const USE_MODULE = true;

/**
 * Put `globalThis.ModuleFactory` back, ready for one more task build.
 *
 * Reads the factory out of the already-cached module rather than re-fetching
 * anything, so this costs a module-map lookup.
 */
export async function armModuleFactory(wasmPath: string): Promise<void> {
  const url = `${wasmPath}/vision_wasm_module_internal.js`;
  /*
   * @vite-ignore because the url is only known at runtime; without it Vite
   * tries to analyse the specifier at build time and warns. The url is
   * absolute, which also keeps it clear of the dev-time `?import` rewrite
   * that a `/`-rooted path would attract -- and that rewrite is fatal here,
   * since a file in `public/` refuses the transform with a 500.
   */
  const glue = (await import(/* @vite-ignore */ url)) as { default: unknown };
  (globalThis as unknown as { ModuleFactory: unknown }).ModuleFactory = glue.default;
}
