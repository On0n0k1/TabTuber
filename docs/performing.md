# Performing

The controls you actually use while you are live.

Everything here is on the toolbar along the bottom. Hover any icon to see what
it does and its keyboard shortcut.

---

## Expressions

Five of them: **happy**, **angry**, **sad**, **relaxed**, **surprised**.

### Use the number keys

| Key | |
|---|---|
| **1** – **5** | happy, angry, sad, relaxed, surprised, in that order |
| **0** or **Escape** | back to neutral |

**The keys are the point.** Clicking a small icon mid-sentence is not something
you will do; tapping a number is. Learn 1 to 5 and you can hit a reaction on a
beat.

### How they behave

- **One at a time.** Picking a new one drops the old one.
- **Pressing the active one returns you to neutral**, so there is no separate
  neutral button to find.
- They fade in and out rather than snapping.
- **They do not fire while you are typing** in a text box, so you cannot
  accidentally pull a face while typing in chat.

On a narrow window the five icons collapse into **one button** that opens them
just above the bar. It wears whichever expression is currently on, so you can
still see your state at a glance, and the tray stays open after you pick — handy
for flicking between two reactions.

### They are your choice, not your face

The app does not read your expression off the camera and never tries to. You
pick. This is deliberate: an avatar deciding you are sad when you are not is far
worse than one that stays neutral until you tell it otherwise, and choosing the
moment to react is part of performing.

---

## Sitting or standing

One button that swaps between the two.

| | |
|---|---|
| **standing** | tracks your whole body, frames you full-length |
| **sitting** | ignores your legs, frames your upper body |

**Switch to sitting when you are sitting down.** Otherwise your avatar's legs
will do something strange.

Here is why that happens, because it surprises people: the tracker reports your
legs' positions *confidently* even when they are under a desk and it cannot see
them. Given that data, the avatar stands up regardless of what you are actually
doing. Sitting mode throws the leg data away instead of believing it.

This is also why it is a button rather than automatic — the app would have to
rely on the exact signal that cannot be trusted here.

Your choice is remembered.

---

## Mirroring

In **Setup**, and **on by default**.

With it on, the avatar behaves like a mirror: raise your right hand and the hand
on the right of the screen goes up. Off, the avatar faces you like another
person, so your right hand raises its left.

Most people want it on and never touch it. The one case for turning it off is if
you are showing something with handedness that matters — reading text, or
demonstrating which hand does what.

---

## The camera preview

The eye icon shows or hides the small picture of you in the top-left corner.

**Hiding it does not turn the camera off.** It hides the picture, and that is
all — the tracking carries on exactly as before. People reliably assume
otherwise, so it is worth saying plainly. There is no control in the app that
stops the camera; close the tab or revoke the permission in your browser.

Hide it before you stream, since it is the largest thing you would otherwise have
to crop out of your scene.

---

## The backdrop

In **Setup**, under **Background**.

| | |
|---|---|
| **checker** | grey checkerboard — use while setting up |
| **key** | flat green — for chroma-keying in OBS |
| **transparent** | nothing behind the avatar — for OBS Browser Source |

The checkerboard exists so you can see where the avatar's edges are while you
work. It is not meant to go on stream. [Streaming with
OBS](streaming-with-obs.md) covers which of the other two you want.

---

## Microphone

The microphone icon turns lip sync on and off, and the avatar's mouth follows
your voice.

The first time, your browser asks for microphone permission. Your choice is
remembered between sessions, so it comes back on next time.

Nothing is recorded and nothing is sent anywhere.

See **[Lip sync](lip-sync.md)** to make the mouth look right rather than just
move.

---

## Face and finger tracking

Two more icons, and both need **full tracking** turned on first — they are greyed
out otherwise, and hovering them tells you why.

- **Face tracking** makes blinking and eye movement follow your actual face
  instead of running on a timer.
- **Finger tracking** articulates individual fingers.

Both cost frame rate, face tracking especially. **[Tracking
quality](tracking-quality.md)** explains what you are trading and whether it is
worth it on your machine.

---

## What gets remembered

Close the tab and come back, and these are as you left them:

- whether lip sync is on
- sitting or standing
- your tracking mode
- your vowel calibration, if you did one

Camera, avatar, background and mirror are not remembered — set those each
session, or set them once and leave the tab open.

---

## Next

**[Lip sync →](lip-sync.md)** or **[Tracking quality →](tracking-quality.md)**
