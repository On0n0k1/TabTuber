# Streaming with OBS

Getting the avatar into a scene, and the three things that catch people out
once it is there.

---

## Two capture paths, and the trade-off

There is no single right answer. Transparency and camera permission pull in
opposite directions.

| | **Browser Source** | **Window Capture** |
|---|---|---|
| Transparency | **native** — composites straight over your scene | none; needs a chroma key |
| Camera permission | awkward inside OBS's embedded browser | **just works** |
| Background mode | `transparent` | `key` |
| Extra filters | none | Chroma Key |
| Good for | a finished scene you set up once | getting running in two minutes |

**Browser Source** is the better result. OBS's embedded browser composites the
page's alpha channel directly, so the avatar sits over your game footage with
clean edges and no keying artefacts — no green fringe on hair, no holes in
anything green the avatar happens to wear. The cost is permission: granting
camera access inside an embedded browser is fiddlier than in a normal one, and
depending on your OBS build you may need to launch it with the right flags
before the page can see a camera at all.

**Window Capture** is the pragmatic path. Open the page in your normal browser,
grant the camera permission the way you grant any other, and capture the
window. You pay for it with a chroma key, which means a green fringe you have
to tune out and a rule that the avatar may not wear green.

If you are setting up a scene you will use for months, spend the time on
Browser Source. If you are trying this out, use Window Capture.

---

## Browser Source

1. Set **Background** to `transparent` in Setup.
2. Add a **Browser Source** pointing at the deployed URL, or at
   `http://localhost:5173/` if you are running it yourself.
3. Size it to your canvas. The page lays out to whatever it is given.
4. Grant camera permission when the embedded browser asks. If it never asks,
   or asks and fails, this is the awkward part — check that your OBS build
   allows camera access to Browser Sources, and fall back to Window Capture if
   it will not.
5. Crop the toolbar out. See below.

Do not use the `key` background here. You already have real transparency;
keying green out of it would only lose you quality.

---

## Window Capture

1. Set **Background** to `key` in Setup. The page turns flat chroma green
   behind the avatar.
2. Open the page in a normal browser window and grant camera permission.
3. Add a **Window Capture** for that window.
4. Add a **Chroma Key** filter to the capture and set it to green.
5. Crop the toolbar out. See below.

The flat green is a single colour with no gradient or texture in it, which is
the easiest thing a chroma key will ever be given. Most of the remaining
fringing comes from your browser's own font smoothing and compositing rather
than from the page.

While you are at it, hide your browser's tab strip and address bar — full
screen, or kiosk mode — so there is less to crop.

---

## Crop the toolbar out

**The toolbar, the latency readout, the camera preview and the debug panel are
page elements over the transparent canvas**, which means OBS captures them
along with the avatar. Your viewers will see your icons.

Crop them out with a **Crop/Pad** filter on the source, or by holding `Alt` and
dragging the source's edges in the preview.

What to crop:

| Element | Where |
|---|---|
| Toolbar | along the bottom edge |
| Camera preview and latency readout | top-left corner |
| Debug panel | right edge |
| Status bar | along the top edge |

**None of these move**, so one crop stays valid for as long as you keep the
window the same size. That is the reason to set the source size once and leave
it alone: resizing the window moves the toolbar relative to the avatar and
invalidates the crop.

Two things that make this easier:

- **Hide the camera preview** with the eye icon. It does not stop tracking, so
  there is no cost to turning it off, and it is the largest thing in the
  corner.
- **Leave the debug panel collapsed.** Collapsed it is one narrow title bar
  rather than a column of controls.

A caveat worth knowing: cropping the toolbar out of the capture does not
disable it. It is still there, still clickable, and still listening for the
number keys — which is what you want mid-stream.

---

## Audio is realigned in OBS, not in the page

**By default there is nothing to fix.** The lookahead buffer ships at zero
frames, so the avatar's body is not deliberately delayed and your audio needs
no offset.

If you turn **lookahead** on in the debug panel's `Motion` folder — it buys
smoother motion by filtering with a little of the future as well as the past —
then each frame of it delays the avatar's body by one frame interval. Inside
the page the mouth stays aligned, because the microphone is sampled at the
moment the delayed body is drawn rather than at the newest sample. But the
**audio track OBS is mixing is not delayed by anything**, so your voice arrives
ahead of the avatar that is speaking it.

The fix is in OBS, not in the page: add a **positive sync offset** to your
microphone source to delay the audio until it matches the body. Nudge it
**later**, not earlier. The `Stats` folder reports the current lookahead in
milliseconds, which is the number to start from.

This is standard streamer practice and the direction is the one people get
wrong — the instinct is to pull the audio earlier, which doubles the error.

---

## Checklist

- [ ] Background mode matches the capture path — `transparent` for Browser
      Source, `key` for Window Capture
- [ ] Camera preview hidden
- [ ] Debug panel collapsed
- [ ] Toolbar, corner and panel cropped out
- [ ] Window size fixed, so the crop stays valid
- [ ] Audio sync offset set, **if** you turned lookahead on
- [ ] A lamp on — see [troubleshooting.md](troubleshooting.md)
