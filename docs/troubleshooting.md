# Troubleshooting

These are measured behaviours rather than guesses. Each one cost somebody real
time to discover, which is why it is written down instead of left to be
rediscovered.

---

## Turn a light on first

**Lighting sets your frame rate, and your frame rate sets everything else.**
This is the single most useful piece of advice in this documentation.

A webcam lengthens its exposure in dim light and drops its frame rate to suit.
There is no setting to override it — it is the camera's decision, made before
any of this code sees a frame. Measured here on one machine:

| | Dim room | Lamp on |
|---|---|---|
| Camera frame rate | 11fps | 30fps |
| Total latency | 180ms | 90ms |

**Half the latency, from a lamp.** Nothing was changed in the application
between those two measurements.

**Below about 15fps, no setting in the application can compensate.** Smoothing
cannot invent frames that were never captured, and every filter in the pipeline
is working from a signal that is arriving too slowly to be smooth. If the
avatar feels laggy or stuttery, check the **fps number in the top-left corner**
before you change anything else. It turns amber below 20fps for this reason.

A lamp pointed at your face, not at the wall behind you. Backlight makes the
camera expose for the window and underexpose you, which is the same problem
with extra steps.

---

## Things that surprise people

### Hiding the camera preview does not stop tracking

The eye icon hides the picture. That is all it does. Tracking continues, the
camera light stays on, and the avatar keeps following you.

There is no control in the application that stops the camera. Close the tab or
revoke the permission in your browser.

### Face tracking is not free, and the cost is not confined to the face

Turning on face tracking **forces the entire pipeline onto the CPU**, because
of how the blendshape model is compiled. So it costs you body and hand tracking
frame rate, not just its own. It also rebuilds the tracker, so there is a pause
when you toggle it.

If the whole avatar got worse when you turned on blink and gaze, this is why,
and it is working as designed rather than failing.

### Body-only tracking is the default, for everyone

Out of the box there are **no individual fingers and no camera-driven blink or
gaze**. This is not a bug and it is not a phone-only default — everybody starts
here, including people who had the fuller model stored from before it was a
choice.

The fuller model costs roughly three and a half times the frame rate. The
**Tracking** button switches to `full` when you want hands and face, and
remembers it.

### It runs on a phone, but not at full tracking

| On one phone | |
|---|---|
| Body-only | ~11.8fps |
| Full tracking | ~3.4fps |

That is the difference between an avatar that follows you and one that lurches.
Body-only is already the default, so there is nothing you need to do. If you
switch to `full` on a phone, expect it to struggle, and switch back.

The numbers behind this are in [performance.md](performance.md).

### Legs are not tracked while sitting

By choice, and necessarily. The tracker reports **confident** positions for legs
it cannot see, so an avatar given that data stands up regardless of what your
lower body is doing. Ignoring the legs outright is more honest than believing a
confident guess.

This is also why posture is a button rather than something detected: detecting
it would mean reading leg visibility, which is the exact signal that cannot be
trusted here.

### Lip sync comes from your microphone, not your camera

Camera-driven mouth shapes were built and removed. The tracking was not good
enough to be worth the cost. See [lipsync.md](lipsync.md).

### The panel on the right is not settings

It is a diagnostic tool. You should never need it, and opening it is an
invitation to change something and then wonder why the avatar looks wrong.
Everything a first run depends on is in **Setup**, behind the leftmost toolbar
button.

---

## Specific problems

### The first start takes minutes

Expected once. `npm run fetch-assets` stages roughly 57MB before the page will
open — about 34MB of WebAssembly copied out of `node_modules` and about 23MB of
tracking models downloaded. It is idempotent and skips what it already has.

A failure here is almost always the network rather than the project. Run
`npm run fetch-assets` on its own to see the error by itself.

### The avatar does not appear, or the page shows a camera error

Check the **status bar along the top** — camera permission denied and model load
failures are both reported there. Errors stay up until dismissed and are also
written to the browser console.

The page needs a **secure context** for camera access: `https://` or
`localhost`. An `http://` address on your LAN will not get a camera, which is
the usual reason testing from a phone over the network fails.

### The wrong camera is running

Open **Setup** and pick one explicitly. If it reads **"(current camera
unknown)"**, the browser has declined to report which device is actually
feeding the tracker — the first start names no device and lets the browser
choose, and its choice is not reliably the first one listed. Choosing one
settles it.

If it reads **"no camera found"**, nothing was enumerated at all.

### The avatar moves sluggishly, or under-rotates

Likely a **model** problem rather than a tracking one. A missing humanoid bone
drops its share of the rotation rather than passing it to a neighbour, so the
avatar under-rotates in a way that reads as sluggishness.

Run `npm run inspect-vrm <path>` — it names any missing bones without needing a
browser. See [avatars.md](avatars.md).

### The hands jitter

Expected, especially with finger tracking on. Finger precision depends on how
many pixels your hand occupies in the frame, so a hand far from the camera is
being tracked from very little information. Finger tracking is marked
experimental partly because it makes this much easier to see.

Move closer to the camera, improve the lighting, or turn finger tracking off.

### The mouth is binary — fully open or shut

If you run aggressive upstream noise gating (EasyEffects, RNNoise, NVIDIA
Broadcast), this is a **known and measured limitation**. Hard gating produces
digital silence between words, the self-calibrating noise floor collapses, and
the normalisation saturates — measured at 89% of speech frames pinned fully
open.

Relax or disable the upstream gate and let this application's own duration gate
do that job. See [lipsync.md](lipsync.md#a-known-limitation-upstream-hard-gating).

### My avatar mouths along to my game audio

Turn **`echoCancellation`** on — it is on by default, so something has turned it
off. Or monitor on headphones.

### Viewers see my toolbar

The toolbar, the corner readout and the debug panel are page elements over the
transparent canvas, so OBS captures them with the avatar. Crop them out; they
never move, so one crop filter stays valid. See [obs.md](obs.md#crop-the-toolbar-out).

### My voice arrives before the avatar speaks

Only if you turned **lookahead** on in the debug panel. Add a positive sync
offset to your microphone source in OBS to delay the audio — **later**, not
earlier. See [obs.md](obs.md#audio-is-realigned-in-obs-not-in-the-page).

### The dev server fails with `ENOSPC`

Not a project fault. Your system's inotify watch limit has been exhausted,
usually by editors. Raise `fs.inotify.max_user_watches`, or use
`npm run build && npm run preview`, which needs no file watchers.

### Expression number keys do nothing

They are ignored while focus is in a text field, including a value being typed
into the debug panel. Click the page background and try again.

---

## Starting clean

If settings have got into a state you want rid of: the debug panel's `Session`
folder has **clear saved settings**, which removes everything stored and needs a
**reload** to take effect.

Note that **reset panel to defaults** is a different thing — it restores
controls to the value they were created with, which for a remembered setting is
the remembered value rather than the application's original one.

Six things persist: the tracking backend, whether lip sync is on, your posture,
your vowel calibration, the delegate preference, and the inference rate cap.
