# Getting started

What to do the first time you open TabTuber, and what everything on screen is.

---

## 1. Open it and allow the camera

**[Open the app →](https://on0n0k1.github.io/projects/tabtuber/)**

Your browser asks for permission to use your camera. Allow it. If you block it
by accident, the app tells you so in a bar across the top — you will need to
re-allow it in your browser's address bar and reload.

Nothing is installed and no account is made. If you would rather run it
yourself, the repository's [README](../README.md) has the two commands.

### Before anything else: turn a light on

**This matters more than any setting in the app.**

Your webcam makes its own decision about frame rate, and in a dim room it slows
down to let more light in. Measured on one machine: **11 frames per second in a
dim room, 30 with a lamp on.** That took the avatar's lag from 180ms to 90ms
with nothing changed but the lamp.

A lamp pointed at your face, not at the wall behind you. If the avatar feels
laggy later, come back to this before you change anything else — see
[Tracking quality](tracking-quality.md).

## 2. Wait for the avatar

The first load fetches the tracking model, so give it a few seconds. A bar
across the top tells you what it is doing.

When it is ready, an avatar appears and starts following you. Move your head and
shoulders; it should follow immediately.

---

## What you are looking at

Four things, and only one of them is for you.

### The row of icons along the bottom — **this is yours**

Everything you need. Hover any icon and it tells you what it does and gives you
its keyboard shortcut.

Left to right: setup, camera preview, microphone, tracking mode, face tracking,
finger tracking, posture, and five expressions.

[Performing](performing.md) covers them.

### The small picture, top left

Your camera, with the tracking dots drawn over it. Useful for checking you are
framed properly.

**Hiding it does not turn the camera off.** The eye icon hides the picture and
nothing else — tracking carries on. There is no button in the app that stops the
camera; close the tab or revoke the permission in your browser.

### The numbers under the preview

How well it is running.

- **The milliseconds** are how long it takes for your movement to reach the
  avatar. **Green is good** (under 100ms), amber is noticeable, red is bad.
- **The fps** is what your camera is delivering. **It turns amber under 20**,
  and when it does, that is your problem — not anything else on screen.

Note that this does *not* include OBS capturing and encoding, so what your
viewers see is a little higher.

### The panel on the right — **ignore this**

**It is a developer tool, not settings.** It opens collapsed to a single bar,
and you should never need to open it.

It holds internal values for diagnosing problems. You can get everything you
want without touching it, and changing things in there is a good way to make the
avatar look wrong and not know why.

Everything a normal setup needs is in **Setup**, behind the leftmost icon on the
toolbar. If you are looking for a setting and cannot find it, it is there — not
in the panel.

---

## 3. Set yourself up

Press the **leftmost toolbar icon** to open Setup. Four things:

### Camera

Which camera to use. If it says **"(current camera unknown)"**, your browser is
not telling the app which camera it picked — just choose one from the list and
that settles it. If it says **"no camera found"**, your browser is not seeing a
camera at all.

### Avatar

The two that come with it, or **Upload a VRM avatar** for your own. You can also
just **drag a `.vrm` file onto the page**.

See [Choosing an avatar](choosing-an-avatar.md).

### Background

What sits behind the avatar.

| | |
|---|---|
| **checker** | a grey checkerboard, for working on your setup |
| **key** | flat green, for chroma-keying in OBS |
| **transparent** | nothing, which is what OBS composites properly |

Leave it on **checker** until you set up OBS. [Streaming with
OBS](streaming-with-obs.md) says which to use.

### Mirror

Whether the avatar mirrors you like a mirror does. **On by default**, which is
what most people want — raise your right hand and the hand on the right of the
screen goes up.

---

## 4. Try the rest

- **Press the microphone icon** and allow microphone access. The avatar's mouth
  now follows your voice. → [Lip sync](lip-sync.md)
- **Press 1 to 5** for expressions, **0** for neutral. → [Performing](performing.md)
- **Press the posture icon** if you are sitting down. → [Performing](performing.md#sitting-or-standing)
- **Want fingers, blinking and eye movement?** Press the tracking icon to switch
  to full tracking — but read [the cost
  first](tracking-quality.md#full-tracking-versus-body-only).

Your choices are remembered, so the next time you open it you pick up where you
left off.

---

## Next

**[Choosing an avatar →](choosing-an-avatar.md)**

Or go straight to **[Streaming with OBS →](streaming-with-obs.md)** if you want
it in your scene now.
