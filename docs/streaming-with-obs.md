# Streaming with OBS

Getting the avatar into your scene, over your game footage.

There are two ways. **If you want to be streaming in five minutes, use [Window
Capture](#the-quick-way-window-capture).** If you want the best-looking result,
use [Browser Source](#the-better-way-browser-source).

---

## Which one?

| | **Window Capture** | **Browser Source** |
|---|---|---|
| Set-up difficulty | easy | fiddly |
| Transparency | needs a chroma key | **real transparency** |
| Camera permission | **just works** | awkward inside OBS |
| Green fringing on hair | some | **none** |
| Can your avatar wear green? | no | yes |

They trade exactly one thing against each other: **Browser Source gives you
proper transparency but makes camera permission difficult; Window Capture makes
permission trivial but has no transparency.**

Start with Window Capture. Move to Browser Source when you are building a scene
you will keep.

---

## The quick way: Window Capture

### 1. Set up the page

- Open the app in your normal browser.
- Allow the camera.
- **Setup → Background → `key`.** The backdrop turns flat green.
- **Hide the camera preview** with the eye icon.
- Leave the panel on the right collapsed.

Put the browser in full screen (**F11**) so there is no tab bar or address bar to
deal with.

### 2. Capture it

- In OBS, add a **Window Capture** and pick your browser window.
- Add a **Chroma Key** filter to it. The defaults for green usually work
  straight away.
- Resize and position the avatar in your scene.

### 3. Crop the leftovers

The toolbar is part of the page, so OBS captures it along with the avatar. See
[Crop the interface out](#crop-the-interface-out).

That is it. The flat green backdrop is a single solid colour with no texture in
it, which is about the easiest thing you can hand a chroma key.

**One rule: your avatar cannot wear green.** Anything green in the model
disappears along with the background.

---

## The better way: Browser Source

### 1. Set up the page

**Setup → Background → `transparent`.** The backdrop disappears entirely.

Do not use `key` here. You already have real transparency, and keying green out
of it would only cost you quality.

### 2. Add the source

- Add a **Browser Source** in OBS.
- Point it at **`https://on0n0k1.github.io/projects/tabtuber/`** (or
  `http://localhost:5173/` if you run it yourself).
- Set the width and height to suit your scene.

### 3. Deal with camera permission

**This is the awkward part.** OBS's built-in browser does not ask for camera
permission the way a normal browser does, and depending on your OBS version it
may refuse the camera outright.

Things to try, in order:

- **Check the source's properties** for a page-permissions or "control audio via
  OBS" style option, and look for anything about media access.
- **Some OBS builds need a launch flag** to allow camera access to Browser
  Sources. Search for the flag for your OBS version and platform.
- **If it will not work, use Window Capture instead.** It is not worth hours;
  the chroma key result is good.

Once permission is granted, OBS remembers it.

### 4. Crop the leftovers

Same as the other path — see below.

### Why it looks better

OBS composites the page's real transparency directly. No keying means **no green
fringe around hair**, no holes in anything green, and clean edges at any size.
Hair is where you notice it most.

---

## Crop the interface out

**Whichever path you took, OBS is capturing your toolbar.** The toolbar, the
camera preview, the numbers and the panel are all part of the page, sitting over
the avatar.

Crop them with a **Crop/Pad** filter on the source, or by holding **Alt** and
dragging the source's edges in the OBS preview.

| What | Where |
|---|---|
| Toolbar | along the bottom |
| Camera preview and numbers | top left |
| Panel | right edge |
| Status messages | along the top |

**None of these move**, so one crop lasts forever — as long as you do not resize
the window. Set your window size once and leave it alone; resizing moves the
toolbar relative to the avatar and your crop will be wrong.

Two things that make this much easier:

- **Hide the camera preview.** It is the biggest thing in the corner and hiding
  it costs you nothing, since tracking continues regardless.
- **Leave the panel collapsed.** Collapsed it is one thin bar instead of a
  column.

**Cropping does not disable anything.** The toolbar is still there and still
listening for the number keys — which is exactly what you want mid-stream. You
just cannot see it on the stream.

---

## Audio sync

**Normally there is nothing to do here.** Your voice and the avatar are already
in step.

The one exception: if you have turned on **lookahead** in the panel (it is off by
default, and it buys slightly smoother motion), the avatar's body is deliberately
held back a little. Your microphone audio is not, so your voice arrives before
the avatar that is saying it.

**The fix:** add a **positive sync offset** to your microphone source in OBS, to
hold the audio back until it matches. **Nudge it later, not earlier** — the
instinct is to pull it earlier, which doubles the problem.

---

## Before you go live

- [ ] Background set to match your capture path — `transparent` for Browser
      Source, `key` for Window Capture
- [ ] Camera preview hidden
- [ ] Panel collapsed
- [ ] Toolbar, corner and panel cropped out
- [ ] Window size fixed, so your crop stays valid
- [ ] **A light on your face** — see [Tracking
      quality](tracking-quality.md#light-yourself-properly)
- [ ] fps number green
- [ ] Microphone icon on, if you want lip sync
- [ ] Posture set to sitting, if you are sitting
- [ ] Tested that expression keys 1–5 work while OBS has focus

### One tip about the number keys

The expression keys only work when the **browser window** has focus, not OBS. If
you stream with OBS in front, you will not be able to hit expressions.

Keep the browser window visible on a second monitor, or click into it when you
want to use expressions.

---

## Next

**[Troubleshooting →](troubleshooting.md)** if something is not right.
