# The interface

Everything on screen, what it does, and where it costs you something.

There are four surfaces: a **toolbar** along the bottom to perform with, a
**setup sheet** behind its leftmost button for the things a first run depends
on, a **latency readout** and camera preview in the top-left corner, and a
**debug panel** on the right that you should never need.

---

## The toolbar

Twelve buttons in four groups, separated by dividers. The groups read left to
right as: setup, what you can see, what is being tracked, and what your face is
doing.

| Icon | Control | What it does |
|---|---|---|
| sliders | **Setup** | Opens the setup sheet — camera, avatar, background, mirror |
| eye | **Camera preview** | Shows or hides the preview and the landmarks drawn over it |
| microphone | **Microphone** | Lip sync on or off |
| figure | **Tracking** | Switches between `full` and `body only` |
| face in brackets | **Face tracking** | Blink and gaze from the camera |
| spread hand | **Finger tracking** | Articulates the fingers |
| seated or standing figure | **Posture** | Switches between `sitting` and `standing` |
| five faces | **Expressions** | Happy, angry, sad, relaxed, surprised |

**Hover any icon** and a tooltip gives it a heading, a sentence, and its
keyboard shortcut if it has one. The tooltip is raised on keyboard focus too,
so tabbing to a button tells you the same thing.

### Camera preview

Hides the picture and the landmark overlay. **Tracking is unaffected either
way** — people reasonably assume that hiding the camera turns it off, and it
does not. There is no control in the application that stops the camera; close
the tab or revoke the permission.

### Microphone

Drives the avatar's mouth from your voice. The browser asks for microphone
permission the first time, and your choice is remembered between sessions.
Nothing is recorded and nothing is sent anywhere.

Lip sync is driven by the **microphone, not the camera**. Camera-driven mouth
shapes were built and removed — the tracking was not good enough to be worth
the cost. See [lipsync.md](lipsync.md) for the three mouth modes and the
calibration.

### Tracking

Which tracking model runs. This is a **cost** setting rather than a quality
one: the full model tracks better on every axis, including the body, but a
phone spends around 288ms per inference on it where it spends 82ms on
body-only.

| | `full` | `body only` |
|---|---|---|
| Head, torso, arms, legs | yes | yes |
| Hands and fingers | yes | **no** |
| Blink and gaze from camera | yes | **no** |
| Measured on one phone | 3.4fps | 11.8fps |

**`body only` is the default**, for everyone and not just for phones. Your
choice is remembered, because switching back to the full model costs another
13MB download on top of the 9MB already fetched — paying that once is the
trade, paying it every visit is not.

Switching loads a different model, so **expect a pause**. The old model keeps
serving frames until the new one is ready, so the avatar does not freeze.

While `body only` is running, **Face tracking and Finger tracking grey out**,
and their tooltips replace the description with the reason — there is no hand
or face data for them to read. They are also switched off rather than merely
blocked, and switched back on when you return to `full`, so you do not come
back to a face toggle that is on with nothing behind it.

### Face tracking

Blink and gaze from the camera, rather than the periodic blink the avatar does
on its own.

**This is not free, and the cost is not confined to the face.** The blendshape
model forces the entire pipeline onto the CPU, so turning it on costs body and
hand tracking frame rate as well as its own. It also rebuilds the tracker, so
expect a pause when you toggle it.

Available only while **Tracking** is `full`.

### Finger tracking

Articulates individual fingers from the hand landmarks. **Experimental**, and
worth knowing why that word is there: it works, but it also makes tracking
jitter much easier to see, because a jittering fingertip is a smaller and
faster thing than a jittering arm.

Available only while **Tracking** is `full`.

### Posture

| | Tracks | Framing |
|---|---|---|
| `sitting` | upper body; **legs ignored** | upper body |
| `standing` | the whole figure | full body |

**Legs are not tracked while sitting, by choice.** The tracker reports
confident positions for legs it cannot see, so an avatar given that data stands
up regardless of what your lower body is actually doing. Ignoring the legs
outright is more honest than believing a confident guess.

Posture is a manual choice rather than a detected one, and necessarily so:
detecting it would mean reading leg visibility, which is the exact signal that
cannot be trusted here.

Your choice is remembered.

### Expressions

Five faces: **happy**, **angry**, **sad**, **relaxed**, **surprised**.

- **Number keys 1 to 5** select them, in that order.
- **0 or Escape** returns to neutral.
- **Only one at a time.** Clicking the lit one also returns to neutral, so
  there is no sixth button for it.
- The keys are ignored while you are typing in a text field.

On a narrow window the five fold into a **single button** that opens them in a
tray above the bar. The button wears whichever expression is active, so folding
costs you nothing in readout. The tray stays open after a choice.

**Expressions are chosen, not detected.** Inferring them from the camera was
built and removed. An avatar committing to an expression you were not making
reads far worse than one staying neutral, and choosing the beat to smile on is
a performance decision rather than a measurement. The number keys are the point
of the feature for anyone mid-stream.

---

## Setup

Behind the leftmost toolbar button. These are the four things a first run
depends on, which is why they are here rather than in the debug panel.

### Camera

Which camera to use. If it reads **"(current camera unknown)"**, the browser has
declined to say which device is actually running — the first start names no
device and lets the browser choose, and its choice is not reliably the first
one in the list. Picking one explicitly settles it. If it reads **"no camera
found"**, nothing was enumerated at all.

### Avatar

The two bundled models, plus **Upload a VRM avatar** for your own. Dropping a
`.vrm` anywhere on the page does the same thing, and uploaded files join the
list under their own group for the rest of the session.

See [avatars.md](avatars.md).

### Background

| Mode | What it is | Use it for |
|---|---|---|
| `checker` | a grey checkerboard | working on the page; it makes the transparent canvas visible |
| `key` | flat chroma green | chroma-keying a **Window Capture** in OBS |
| `transparent` | nothing behind the avatar | what a **Browser Source** actually composites |

See [obs.md](obs.md) for which to pick with which capture path.

### Mirror

Whether the avatar mirrors you, as a mirror would, rather than facing you as
another person would. **On by default**, which is the usual preference —
raising your right hand raises the hand on the right of the screen.

---

## The latency readout

Top-left corner, under the camera preview. Two numbers, each with a tooltip.

**Milliseconds** — camera to screen, through tracking and smoothing.

| | |
|---|---|
| green | under 100ms |
| amber | 100 to 150ms |
| red | beyond 150ms |

Under about 100ms the avatar feels attached to you. Past that it feels like
something following you.

**OBS capture and encoding are not included in this figure**, so what your
viewers see is higher than what the readout says. The number is there to tell
you whether the page is the problem.

**Frames per second** — what the camera is delivering, not what the avatar is
drawn at. Turns amber below 20fps.

This is the number that explains a bad latency figure most of the time, and
the fix is usually a lamp rather than a setting. See
[troubleshooting.md](troubleshooting.md).

---

## The status bar

Along the top. It carries three kinds of message:

- **Errors** — camera permission denied, a model failing to load. These stay
  up until you dismiss them, and carry an action where there is one to offer.
- **Progress** — requesting camera access, loading a model.
- **Notices** — everything else.

Everything but an error clears itself after about three seconds. Every message
is also written to the browser console, so a message you dismissed or missed is
still recoverable there.

---

## The debug panel

On the right, collapsed to its title bar.

**It is a diagnostic surface, not an advanced-settings surface.** You should
never need to open it, you should not be drawn to it, and you can get a working
avatar on screen without knowing what is in it. It holds solver ratios, filter
constants and per-bone weights for the moment something is wrong and someone
wants to know why. Opening it is an invitation to change something and then
wonder why the avatar looks wrong.

It is documented here for the curious and for contributors. **The individual
sliders are deliberately not documented**: they are empirical values, several
have never been measured against a real user, and writing them down would imply
more confidence in the numbers than exists.

Twelve folders — `Session`, `Stats`, `Camera`, `View`, `Solver`, `Filter`,
`Tracker`, `Liveliness`, `Lip sync`, `Face`, `Expression`, `Motion` — plus live
readout groups `Tracking`, `Mic`, `Face`, `Depth flip` and `Avatar`. Everything
opens closed except `Stats`, which is the one folder that answers "is this
working".

Three are worth calling out:

**`Session`** has two buttons that sound alike and are not:

- *reset panel to defaults* restores every control to the value it was created
  with — which, for a setting restored from storage, is the **stored** value
  rather than the application's original one.
- *clear saved settings* removes the stored settings and needs a **reload** to
  take effect.

Six things persist between sessions: the tracking backend, whether lip sync is
on, your posture, your vowel calibration, the delegate preference and the
inference rate cap.

**`Stats`** is the one to open when something feels wrong: render and camera
frame rate, resolution, tracker rate, inference time, latency, lookahead,
whether the tracker got the GPU or the CPU, microphone state and tracking
confidence.

**`Lip sync`** holds the mouth mode, the vowel calibration buttons, the
browser's noise cancelling and the noise gate. That one *is* documented, in
[lipsync.md](lipsync.md), because the defaults are deliberate and surprising.
