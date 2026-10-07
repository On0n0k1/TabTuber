# TabTuber

A webcam-driven VTubing avatar that runs entirely in a browser tab.

**Nothing leaves your machine.** Your camera and microphone are read in the
page, the tracking runs in the page, and the avatar is drawn in the page. No
video, no audio and no landmark data is uploaded, because there is no server to
upload it to — the whole application is a static site. Loading it once is
enough; after that it works offline.

Point a webcam at yourself and a VRM avatar mirrors your head, torso, arms and
hands in real time. Your voice moves its mouth. Your expressions are yours to
choose, on a toolbar or with the number keys.

**[Open it →](https://on0n0k1.github.io/projects/tabtuber/)**

---

## What you need

- **A webcam.** Any one your browser can see.
- **A recent browser.** Chrome and Edge are what this is tested on. The page
  needs WebGL and a secure context, so `https://` or `localhost`.
- **Good lighting.** This is not a nicety. A webcam lengthens its exposure in a
  dim room and drops its frame rate to suit — measured here at 11fps in dim
  light against 30fps with a lamp on, which took the avatar's lag from 180ms to
  90ms with no change but the lamp. Below roughly 15fps there is no setting in
  the application that can make up the difference. If something feels wrong,
  turn a light on before you change anything else.
- **A microphone**, only if you want lip sync. It is off until you ask for it.

## Running it

```sh
npm install
npm run dev
```

Then open <http://localhost:5173/>.

**The first start is slow, and that is not a bug.** `npm run fetch-assets`
runs automatically before `dev` and `build`. It copies about 34MB of MediaPipe
WebAssembly out of `node_modules` and downloads about 23MB of tracking models,
so a cold checkout stages roughly 57MB before the page will open. It is
idempotent and skips what it already has, so this happens once. If it fails, it
is almost always the network rather than the project — run `npm run
fetch-assets` on its own to see the error on its own.

To serve a production build instead:

```sh
npm run build
npm run preview
```

## Your first run

The browser asks for camera permission. Grant it, and an avatar appears with a
small camera preview in the top-left corner and a row of icons along the bottom.

Three things are worth knowing before you touch anything:

- **The panel on the right is a developer tool.** It opens collapsed to a
  single title bar, and you should never need it. It holds filter constants and
  solver ratios for diagnosing a problem, not settings for using the app. You
  can get a working avatar on screen without ever opening it. Everything a
  first run actually depends on — camera, avatar, background, mirroring — is
  behind the leftmost toolbar button instead.
- **Body-only tracking is the default.** Out of the box you get head, torso,
  arms and legs, but no individual fingers and no camera-driven blink or gaze.
  That is deliberate: the fuller model costs roughly three and a half times the
  frame rate, which is the difference between usable and broken on a phone or a
  modest laptop. The **Tracking** button on the toolbar switches to `full` when
  you want hands and face, and remembers your choice.
- **Hiding the camera preview does not stop tracking.** The eye icon only hides
  the picture. Tracking continues either way.

Hover any toolbar icon and it tells you what it does and names its keyboard
shortcut.

## Using your own avatar

Any **VRM 1.0** file works. Drop it anywhere on the page, or pick it in Setup.
A dropped file is read locally and is never uploaded.

For what a model needs in order to work fully, and for the two command-line
tools that inspect and shrink a `.vrm` before you use it, see
**[docs/avatars.md](docs/avatars.md)**.

## The bundled avatars

Two avatars ship with the application: **Avatar X** and **Avatar B**, which are
VRoid Studio's own sample models, authored by **pixiv VRoid Project**.

pixiv's published terms let anyone use these models in any activity, commercial
or not, with no credit required. Two things are prohibited, and one of them is
easy to do by accident:

- **Do not re-license them as CC0.** Copyright is not waived, and `authors`
  must keep naming pixiv.
- **Do not build a character-creation service** from the data in them.

The longer version, and why the licence embedded in the files reads more
narrowly than the terms that actually govern them, is in
[docs/avatars.md](docs/avatars.md#the-bundled-avatars).

## Streaming with it

There are two ways to get this into OBS and they trade different things away.
Browser Source gives you real transparency but makes camera permission awkward;
Window Capture has no transparency but permissions simply work.

**[docs/obs.md](docs/obs.md)** walks through both, including which background
mode to use, how to crop the toolbar out of your scene, and why you realign
your audio in OBS rather than in the page.

## On a phone

It works, at body-only tracking — around 11fps, against 3 to 4fps with hands
and face, which is the difference between an avatar that follows you and one
that lurches. Body-only is already the default, so there is nothing to do.
If you switch the **Tracking** button to `full` on a phone, expect it to
struggle; switch it back.

## Documentation

For performers:

| | |
|---|---|
| **[The interface](docs/interface.md)** | Every button, what it does, and what it costs |
| **[Streaming with OBS](docs/obs.md)** | Both capture paths, backgrounds, cropping, audio sync |
| **[Avatars](docs/avatars.md)** | Bringing your own VRM, and the bundled models' licence |
| **[Lip sync](docs/lipsync.md)** | The three mouth modes, vowel calibration, the noise gate |
| **[Troubleshooting](docs/troubleshooting.md)** | Things that surprise people, lighting first |

For anyone working on the code:

| | |
|---|---|
| **[Development](docs/development.md)** | Layout, the checks, the boundaries, CI and releases |
| **[Performance](docs/performance.md)** | Where a frame actually goes, measured on a phone |

## For contributors

```sh
npm run check       # 279 assertions, no test framework
npm run typecheck   # tsc --noEmit
npm run build       # typecheck, then vite build
```

`npm run check` is a set of plain Node programs run under
`--experimental-strip-types` — Node executes the TypeScript directly, so there
is no test framework and nothing to install. Each `.check.ts` sits next to the
module it covers. CI runs the typecheck, the checks and a clean build on every
push.

Two tools for working with models:

```sh
npm run inspect-vrm <path>        # VRM version, bone coverage, spring bones, MToon
npm run shrink-vrm <in> [out]     # strip the metadata thumbnail
```

The design record — every decision, measurement and reverted experiment — lives
in `SPEC.md`, which is **not in this repository**. It is deliberately
untracked, which was right while it was being rewritten hourly and is a weaker
position now that it is the only account of why the solver is shaped as it is.
That decision is under review. See
[docs/development.md](docs/development.md#the-design-record).

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and
must be signed off and GPG-signed (`git commit -s -S`). Releases are cut
automatically from the commit history.

## Licence

The source is the repository owner's. The two bundled avatars are pixiv's,
under the terms above.
