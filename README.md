# TabTuber

A webcam-driven VTubing avatar that runs entirely in a browser tab.

Point a webcam at yourself and a VRM avatar mirrors your head, torso, arms and
hands in real time. Your voice moves its mouth. It composites over game footage
in OBS with a transparent background.

**Nothing leaves your machine.** The camera and microphone are read in the page,
the tracking runs in the page, and the avatar is drawn in the page. No video,
no audio and no landmark data is uploaded, because there is no server to upload
it to — the whole application is a static site. Loading it once is enough.

**[Open the app →](https://on0n0k1.github.io/projects/tabtuber/)**

### Using it

**[User documentation →](docs/)** — getting started, choosing an avatar,
performing, lip sync, tracking quality, streaming with OBS, and
troubleshooting.

The rest of this file is for working on the code.

---

## Quick start

```sh
npm install
npm run dev          # http://localhost:5173/
```

**The first start is slow, and that is not a bug.** `npm run fetch-assets` runs
automatically before `dev` and `build`. It copies the MediaPipe WebAssembly
bundle out of `node_modules` into `public/mediapipe/wasm/` (~34MB) and downloads
both tracking models into `public/models/` (~23MB). It is idempotent and skips
what it already has, so this happens once. A failure here is almost always the
network — run `npm run fetch-assets` alone to see the error by itself.

Neither the wasm nor the downloaded models are committed. Both are self-hosted
rather than pulled from a CDN at runtime: a CDN dependency means the page is
broken offline and hostage to an upstream path change.

| | |
|---|---|
| `npm run dev` | dev server at `localhost:5173` |
| `npm run build` | typecheck, then `vite build` |
| `npm run preview` | serve the build; needs no file watchers |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | the assertion suite, 279 assertions |
| `npm run fetch-assets` | stage the wasm and models |
| `npm run build:docs` | render `docs/` to `public/docs/` |
| `npm run inspect-vrm <path>` | VRM version, bone coverage, spring bones, MToon |
| `npm run shrink-vrm <in> [out]` | strip the metadata thumbnail |

If the dev server dies with `ENOSPC`, the system inotify watch limit is
exhausted — raise `fs.inotify.max_user_watches`, or use `build` + `preview`.

The page needs a **secure context** for camera access, so `https://` or
`localhost`. An `http://` LAN address gets no camera, which is why testing from
a phone over the network needs https.

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

**`AvatarPose` is the only thing crossing between the solver and the renderer.**
Enforced by convention rather than by tooling:

- **The renderer must not import MediaPipe types.**
- **The solver must not import three.js types.** It works in plain quaternion
  arrays; the renderer adapts them.

`AvatarPose` carries bone rotations, a clamped root offset for hip sway, and an
`expressions` map. That map existed from the first commit when only procedural
blink wrote to it — it is the seam that made lip sync and then face tracking
**additive** rather than a restructure. It earned its keep twice.

### Loop decoupling

Tracking runs at camera and model rate. Rendering runs on
`requestAnimationFrame` and **slerps toward the latest solved pose**. Rendering
never happens from the tracking callback.

This is a large fraction of perceived smoothness and it is independent of
filtering: a slow tracker with decoupled rendering looks far better than a fast
one without it.

### Where the tracker runs

Decided once at startup by `chooseHost()` in [src/main.ts](src/main.ts), and
**reported rather than assumed** — the console says which host started and by
which frame transport.

| Host | When |
|---|---|
| `WorkerTrackingHost` | the normal path; needs `Worker` and `OffscreenCanvas` |
| `LocalTrackingHost` | neither is available, or the worker failed to start |

The worker makes inference no cheaper. It moves a synchronous GPU readback stall
off the thread that draws the avatar, so the avatar renders smoothly while
tracking runs at its own rate.

### Tracking backends

Two, selectable at runtime from the toolbar and remembered between sessions:

| | Supplies | Cost |
|---|---|---|
| `holistic` | body, hands, face | five readback sub-graphs |
| `pose` | body only | three |

**`pose` is the default, for everyone.** The fuller model costs roughly three
and a half times the frame rate, which is the difference between usable and
broken on a modest device. Face and finger tracking are unavailable on `pose`
and their toolbar buttons grey out with the reason, asked of the *running*
tracker rather than the stored setting.

---

## Layout

| | |
|---|---|
| [src/capture/](src/capture/) | camera access, capture-delay measurement |
| [src/tracker/](src/tracker/) | backends, hosts, and the worker + its protocol |
| [src/filter/](src/filter/) | the one-euro filter bank |
| [src/solver/](src/solver/) | landmarks to bone rotations; the reference rig |
| [src/render/](src/render/) | three.js stage, VRM avatar, pose buffer, expressions |
| [src/audio/](src/audio/) | mic level, speech gate, mouth shapes, vowel space |
| [src/ui/](src/ui/) | toolbar, setup sheet, debug panel, banner, HUD |
| [scripts/](scripts/) | asset staging and the two VRM tools |

`src/types.ts` holds the shared contracts, including `AvatarPose`.

### Two UI surfaces, deliberately

A **toolbar** along the bottom for things reached for mid-performance, and a
**lil-gui panel** on the right for diagnosing. The split is by *who reaches for
it and when*, and it is a constraint on where a control may live: **anything a
first run depends on may not be in the panel.** Camera, avatar, background and
mirror live in a setup sheet opened from the leftmost toolbar button.

The panel is a debug surface, not an advanced-settings surface. A new user
should never need to open it.

---

## The checks

```sh
npm run check
```

**279 assertions, no test framework.** Each check is a plain Node program run
under `--experimental-strip-types`, so Node executes the TypeScript directly —
nothing to install, nothing to configure, and a check runs in milliseconds. Each
`*.check.ts` sits next to the module it covers.

Run one alone with `npm run check:solver`, and likewise `check:math`,
`check:filter`, `check:buffer`, `check:mouth`, `check:gate`, `check:vowel`,
`check:face`, `check:expression`, `check:toolbar`, `check:interp`,
`check:banner`, `check:style`.

Two constraints the format imposes:

- **Strip-only TypeScript rejects constructor parameter properties.** Any class
  reachable from a check must assign its fields explicitly.
- **No check may import a module touching `import.meta.env`**, which only a
  bundler defines.

### Things learned from these checks

- **The solver checks caught two scratch-buffer aliasing faults** that were
  invisible at rest and appeared only under rotation. Treat any change to the
  solver's scratch layout as dangerous.
- **Mirroring shipped broken because every check ran unmirrored** while the app
  defaults to mirrored. Any transform applied to landmarks needs coverage in
  **both** mirror states.
- **A check can keep passing after the behaviour it asserts is removed.** An
  "occluded arm returns to rest" assertion survived a switch to last-good
  degradation because shared solver state happened to leave the fallback at
  identity. Passing is not the same as meaningful.
- **`style.check.ts` exists because of one CSS rule.** Setting `display` in an
  author stylesheet overrides the browser's `[hidden] { display: none }`, so an
  element styled `display: flex` and hidden with `el.hidden = true` keeps its
  attribute set and stays visible — and every JavaScript way of asking "is it
  hidden?" answers yes. The status banner shipped like that from the start.

---

## Conventions

- **TypeScript, strict mode.** No `any` without a comment justifying it.
- **Vanilla TS.** No UI framework.
- Respect the solver/renderer import boundary above.
- **Rust/WASM is deferred.** Do not introduce it until the criteria recorded in
  the design record are met; the measurements moved them further away rather
  than closer.
- Anything resolving a runtime asset must go through `import.meta.env.BASE_URL`
  rather than an absolute path — the site is served from a subpath.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/), signed off and
GPG-signed:

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

The release commit is the one exception: `@semantic-release/git` pushes as
`github-actions[bot]` with no sign-off and no signature. Accepted as a
bot-commit exception rather than worked around.

---

## CI, release and deployment

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) has three jobs.

**`test`** — typecheck, the check suite, and the build, on every push and pull
request. It also proves `fetch-assets` works from nothing.

This job exists because of a specific class of bug. The app once loaded
`avatar.vrm`, a gitignored file that `fetch-assets` does not stage, so it
existed only on the machine that exported it. A clean clone opened on a failed
load, and the bug was invisible locally for exactly the reason it was a bug. A
clean build in a clean environment catches that whole class.

**`release`** — semantic-release, gated on `test` and on a real push to `main`.
It derives the version from the commit history, writes `CHANGELOG.md`, and
creates the tag and GitHub Release. It publishes to **no registry**:
`@semantic-release/npm` runs with `npmPublish: false` and only rewrites the
version field. The release commit carries `[skip ci]`, so it neither
re-triggers the workflow nor causes a second deploy.

`package-lock.json` is committed alongside `package.json` because `npm version`
bumps both, and committing only the former leaves the lockfile's version
silently stale.

**`deploy`** — builds and syncs `dist/` into `On0n0k1/On0n0k1.github.io`'s
`sites/projects/tabtuber/`, served at `on0n0k1.github.io/projects/tabtuber/`.
Same gate as `release`. Two details that are easy to get wrong:

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
so `release` and `deploy` both skip — a safe way to re-run the checks against
`main`. Re-deploying is done with *Re-run failed jobs* on the original push's
run, which keeps the push gate honest.

### The deployment subpath

The site is served from `/projects/tabtuber/` rather than a domain root.
[`vite.config.ts`](vite.config.ts) sets `base: "./"` so every emitted asset URL
is document-relative and the build carries no knowledge of the prefix. Vite
normalises this to `/` for the dev server, so `npm run dev` stays at
`localhost:5173/`.

---

## Documentation

**The markdown in [docs/](docs/) is the source of truth.** It is what gets
reviewed and what reads correctly on the repository page, so nothing may require
it to be written in a way that reads worse there.

[`scripts/build-docs.mjs`](scripts/build-docs.mjs) renders it to static HTML:

```sh
npm run build:docs        # -> public/docs/
```

It runs automatically before `dev` and `build`, alongside `fetch-assets`.
Output goes to `public/docs/` rather than straight to `dist/`, because Vite both
copies `publicDir` into the build *and* serves it on the dev server — so one
staging step makes the pages reachable from both. `public/docs/` is gitignored,
like everything else that gets staged.

Served at **`/docs/`**, and linked from the app at the foot of the setup sheet.
Not from the toolbar: the toolbar is for things reached for mid-performance, and
reading a guide is not one of them.

**`README.md` is deliberately not published.** It is the developer entry point
and belongs on the repository page; `docs/` is the user documentation and is what
a visitor to the site should find. A link out of `docs/` into the source tree is
rewritten to a GitHub URL, since the published site carries no source.

### It fails rather than shipping a broken link

The build errors out, listing every problem at once, on:

- a link to a page that is not published
- an `#anchor` with no matching heading, in any page
- a referenced image that is not in `docs/`
- a `../` link to a path that is not in the repository

Headings are slugged with **GitHub's algorithm**, so the same `#anchor` works in
the rendered pages and in the markdown read on the repository page. Only one of
those two is ours to define, so the other one sets the rule.

### Adding screenshots

Put the image file in `docs/` and reference it normally:

```markdown
![The toolbar, with the microphone active](toolbar-mic.png)
```

Images beside the markdown are copied into the output as they are. A reference
to a file that is not there fails the build, so a typo cannot ship as a broken
image.

### How `/docs` resolves

Two pieces of [`vite.config.ts`](vite.config.ts) make the path behave the same
everywhere.

**`appType: "mpa"`** turns off Vite's SPA fallback. The app is one page with no
client-side routing, so the fallback never served it — all it did was answer an
unknown path with `index.html` and a **200**, which is how `/docs` silently
returned the app instead of the documentation. Same shape as the missing-model
bug that handed `index.html` to a model fetch.

**The `docs-directory-index` plugin** resolves `/docs` and `/docs/` to the index
page on both the dev and preview servers. GitHub Pages does this for any
directory holding an `index.html` — a bare path 301s to its slashed form, which
then serves the index — but neither Vite server does it unaided, so
`localhost:5173/docs` got nothing while the deployed site was fine. That is the
worst way round: a link nobody can check locally.

The **redirect** is the part that matters, rather than just rewriting both forms
to the index. Served at `/docs`, the page loads but every relative URL in it
resolves one level too high — `docs.css` becomes `/docs.css` and
`getting-started.html` becomes `/getting-started.html`. The slash has to be real
before the browser resolves the document's links.

| | dev | preview | Pages |
|---|---|---|---|
| `/docs` | 301 → `/docs/` | 301 → `/docs/` | 301 → `/docs/` |
| `/docs/` | index | index | index |

The in-app link still names `docs/index.html` outright, because it depends on
none of this and is the one path to the documentation that has to work wherever
the app is opened from.

---

## The design record

`SPEC.md` holds every design decision, the reasoning behind it, the
measurements, and the experiments that were built and then reverted. **It is not
in this repository** — it is deliberately untracked, as are `CLAUDE.md` and
`DOCS.md`.

That was the right call while it was a working document being rewritten hourly.
It is a weaker position now: it is the only account of why the solver is shaped
as it is, and it does not travel with the code. **The decision is under
review.** Until it changes, this file and `docs/` are the public record.

## Licence

The source is the repository owner's. The two bundled avatars — `AvatarSample_X`
and `AvatarSample_B` — are VRoid Studio sample models authored by **pixiv VRoid
Project**, usable by anyone in any activity with no credit required, but **not**
to be re-licensed as CC0 and **not** to be used to build a character-creation
service. See [docs/choosing-an-avatar.md](docs/choosing-an-avatar.md).
