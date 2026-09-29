/*
 * Entry point. Wiring only -- the pipeline stages live in their own modules
 * and communicate through the contracts in src/types.ts.
 *
 * Pipeline: capture -> tracker -> filter -> solver -> render
 * See SPEC.md section 4.
 */

function boot(): void {
  document.body.dataset["bg"] = "checker";
  // eslint-disable-next-line no-console
  console.info("virtual-avatar: booting");
}

boot();
