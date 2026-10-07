# Development

For anyone working on the code.

---

## Getting set up

```sh
npm install
npm run dev          # http://localhost:5173/
```

`npm run fetch-assets` runs automatically before `dev` and `build`. It copies
the MediaPipe WebAssembly bundle out of `node_modules` into
`public/mediapipe/wasm/` (~34MB) and downloads both tracking models into
`public/models/` (~23MB). It is idempotent and skips what it already has, so it
is slow once and instant afterwards.

Neither the wasm nor the downloaded models are committed. They are self-hosted
rather than pulled from a CDN at runtime: a CDN dependency means the page is
broken offline and hostage to an upstream path change.

```sh
npm run typecheck    # tsc --noEmit
npm run check        # 279 assertions
npm run build        # typecheck, then vite build
npm run preview      # serve the build; needs no file watchers
```

If the dev server dies with `ENOSPC`, your system's inotify watch limit is
exhausted — raise `fs.inotify.max_user_watches`, or use `build` + `preview`.

---

## Architecture

Tracking is a **producer** into avatar state. It never touches the scene graph.

```
capture    getUserMedia -> HTMLVideoElement
   |
tracker    MediaPipe, in a Worker -> PoseFrame
   |
filter     one-euro filter bank, per landmark per axis
   |
solver     -> AvatarPose
   |
renderer   three.js + three-vrm applies AvatarPose
```

### The boundary that matters

**`AvatarPose` is the only thing that crosses between the solver and the
renderer**, and the rule is enforced by convention rather than by tooling:

- **The renderer must not import MediaPipe types.**
- **The solver must not import three.js types.** It works in plain quaternion
  arrays; the renderer adapts them.

`AvatarPose` carries bone rotations, a clamped root offset for hip sway, and an
`expressions` map. That map existed from the first commit even when only
procedural blink wrote to it — it is the seam that made lip sync and then face
tracking **additive** rather than a restructure. It earned its keep twice.

### Loop decoupling

Tracking runs at camera and model rate. Rendering runs on
`requestAnimationFrame` and **slerps toward the latest solved pose**. Rendering
never happens from the tracking callback.

This is a large fraction of perceived smoothness and it is independent of
filtering — a slow tracker with decoupled rendering looks far better than a
fast one without it.

### Where the tracker runs

Decided once at startup by `chooseHost()` in [main.ts](../src/main.ts), and
**reported rather than assumed** — the console says which host started and by
which frame transport.

| Host | When |
|---|---|
| `WorkerTrackingHost` | the normal path; needs `Worker` and `OffscreenCanvas` |
| `LocalTrackingHost` | neither is available, or the worker failed to start |

The worker makes inference no cheaper. It moves a synchronous GPU readback stall
off the thread that draws the avatar. See
[performance.md](performance.md#what-the-worker-changed).

---

## Layout

| Directory | |
|---|---|
| [src/capture/](../src/capture/) | camera access, capture-delay measurement |
| [src/tracker/](../src/tracker/) | MediaPipe backends, hosts, and the worker + its protocol |
| [src/filter/](../src/filter/) | the one-euro filter bank |
| [src/solver/](../src/solver/) | landmarks to bone rotations; the reference rig |
| [src/render/](../src/render/) | three.js stage, VRM avatar, pose buffer, expressions |
| [src/audio/](../src/audio/) | mic level, speech gate, mouth shapes, vowel space |
| [src/ui/](../src/ui/) | toolbar, setup sheet, debug panel, banner, HUD |
| [scripts/](../scripts/) | asset staging and the two VRM tools |

`src/types.ts` holds the shared contracts, including `AvatarPose`.

---

## The checks

```sh
npm run check
```

**279 assertions, no test framework.** Each check is a plain Node program run
under `--experimental-strip-types`, so Node executes the TypeScript directly —
nothing to install, nothing to configure, and a check runs in milliseconds.

Each `*.check.ts` sits next to the module it covers. Run one on its own:

```sh
npm run check:solver
npm run check:filter
npm run check:math
# ...and check:buffer, check:mouth, check:gate, check:vowel, check:face,
#    check:expression, check:toolbar, check:interp, check:banner, check:style
```

Two constraints the format imposes:

- **Strip-only TypeScript rejects constructor parameter properties.** Any class
  reachable from a check must assign its fields explicitly.
- **No check may import a module that touches `import.meta.env`**, which only a
  bundler defines.

### Things learned from these checks, worth not relearning

- **The solver checks caught two scratch-buffer aliasing faults** that were
  invisible at rest and appeared only under rotation. Treat any change to the
  solver's scratch layout as dangerous.
- **Mirroring shipped broken because every check ran unmirrored** while the app
  defaults to mirrored. Any transform applied to landmarks now needs coverage in
  **both** mirror states.
- **A check can keep passing after the behaviour it asserts is removed.** An
  "occluded arm returns to rest" assertion survived a switch to last-good
  degradation for an incidental reason: shared solver state happened to leave
  the fallback at identity. Passing is not the same as meaningful.
- **Only one of three problems reported from live testing was a code fault.**
  The upside-down head was a genuine bug and its reproduction became the
  permanent mirror checks. The T-pose snap was not a bug — the code did what it
  was written to do and the *design* was wrong. The hand jitter was not a bug
  either, but a signal-quality limit diagnosed from geometry. Worth keeping
  those three distinct; only the first was the kind of thing a check could have
  caught in advance.

---

## Code conventions

- **TypeScript, strict mode.** No `any` without a comment justifying it.
- **Vanilla TS.** No UI framework.
- Respect the solver/renderer import boundary above.
- Rust/WASM is **deferred**, and the measurements moved its criteria further
  away rather than closer. See
  [performance.md](performance.md#rustwasm-is-not-the-mobile-answer).

### Commits

[Conventional Commits](https://www.conventionalcommits.org/), and every commit
signed off and GPG-signed:

```sh
git commit -s -S
```

```
<type>(<scope>): <subject>

<body>
```

- **type**: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `chore`
- **scope**: `tracker`, `solver`, `filter`, `render`, `avatar`, `audio`, `ui`,
  `wasm`
- **subject**: imperative, lowercase, no trailing period, ≤72 chars
- **body**: wrapped at 72 columns, explaining **why** rather than what — the
  diff already says what

The release commit is the one exception to the signing rule:
`@semantic-release/git` pushes as `github-actions[bot]` with no sign-off and no
signature. Accepted as a bot-commit exception rather than worked around.

---

## CI, release and deployment

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) has three jobs.

**`test`** — typecheck, the check suite, and the build, on every push and pull
request. It also proves `fetch-assets` works from nothing.

This job exists because of a specific class of bug. The app once loaded
`avatar.vrm`, a gitignored file that `fetch-assets` does not stage, so it existed
only on the machine that exported it. A clean clone opened on a failed load, and
the bug was invisible locally for exactly the reason it was a bug. **A clean
build in a clean environment catches that whole class.**

**`release`** — semantic-release, gated on `test` and on a real push to `main`.
It derives the version from the commit history, writes `CHANGELOG.md`, and
creates the tag and GitHub Release. It publishes to **no registry**:
`@semantic-release/npm` runs with `npmPublish: false` and only rewrites the
version field. The release commit carries `[skip ci]`, so it neither
re-triggers the workflow nor causes a second deploy.

`package-lock.json` is committed alongside `package.json` because `npm version`
bumps both, and committing only the former leaves the lockfile's version
silently stale.

**`deploy`** — builds and syncs `dist/` into
`On0n0k1/On0n0k1.github.io`'s `sites/projects/tabtuber/`, served at
`on0n0k1.github.io/projects/tabtuber/`. Same gate as `release`.

Two details that are easy to get wrong:

- It needs a **`PAGES_DEPLOY_TOKEN_TABTUBER`** secret — a PAT with write access
  to the *pages* repo, not to this one.
- **It must be a PAT rather than the built-in `GITHUB_TOKEN`.** A
  `GITHUB_TOKEN` push does not trigger workflows in the target repository, so
  the pages repo's own `Deploy Pages` run would never fire and the site would
  silently never update.

The sync `rm -rf`s the target directory before copying, so files dropped from a
build disappear instead of lingering as orphans. The push retries with a rebase,
because the pages repo takes deploys from several projects and a push can lose a
race with a sibling.

**Manual runs are deliberately test-only.** `workflow_dispatch` is not a push,
so `release` and `deploy` both skip — it is a safe way to re-run the checks
against `main`. Re-deploying is done with *Re-run failed jobs* on the original
push's run, which keeps the push gate honest.

### The deployment subpath

The site is served from `/projects/tabtuber/` rather than a domain root.
[`vite.config.ts`](../vite.config.ts) sets `base: "./"` so every emitted asset
URL is document-relative and the build carries no knowledge of the prefix. Vite
normalises this to `/` for the dev server, so `npm run dev` stays at
`localhost:5173/`.

Anything resolving a runtime asset must go through `import.meta.env.BASE_URL`
rather than an absolute path.

### Build size

A clean build is around 66MB: 34MB of MediaPipe wasm in three variants of which
any given browser loads exactly one, 19MB of the two committed avatars, and
14MB of the holistic model. The first deploy pays that into the pages repo's
history; afterwards only changed bundles cost anything, since identical files
produce no diff and the sync step exits without committing.

**Open:** trimming the two unused wasm variants would cut roughly 22MB from
every deploy, but requires knowing which variant each target browser picks.

---

## The design record

**`SPEC.md` is the design record, and it is not in this repository.**

It holds every decision, the reasoning behind it, the measurements, and the
experiments that were built and then reverted — camera-driven mouth shapes,
inferred emotion, and others. It is roughly 3,200 lines. `CLAUDE.md` and
`DOCS.md` are untracked for the same reason.

That was the right call while it was a working document being rewritten hourly.
It is a **weaker position now**: it is the only account of why the solver is
shaped as it is, it lives on one disk, and it does not travel with the code.
Someone cloning this repository gets source, two avatars, and this
documentation — not the reasoning.

**The decision is under review.** Until it changes, this documentation is the
public record, and anything in `SPEC.md` that a contributor needs should be
moved here rather than cited.

### Known drift, as of 2026-10-07

`SPEC.md` has fallen behind the code in four places. Recorded here so the
documentation is not blamed for the disagreement:

| `SPEC.md` says | Actually |
|---|---|
| §16: Holistic is the default backend | pose is the default, for everyone |
| §16: 262 assertions | 279 |
| §18.1: the repository contains no documentation at all | it contains this |
| §18.3: the tracker worker is unbuilt | built, shipped in 1.4.0, and preferred at startup |

One consequence worth drawing out: **every performance measurement in `SPEC.md`
predates the worker.** The per-inference costs still hold; the claims about the
main thread being blocked describe the pre-worker build.

These docs follow the code. A matching note has been added to `SPEC.md` rather
than editing the stale sections, so the drift is visible from both sides.
