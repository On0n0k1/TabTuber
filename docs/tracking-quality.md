# Tracking quality

How to get smooth, responsive tracking — and what to do when you cannot.

**If you read only one section, read the first one.** Lighting does more for
tracking than every setting in the app combined.

---

## Light yourself properly

Your webcam decides its own frame rate, and in a dim room it slows down to
gather more light. You cannot override this — the camera makes that choice before
the app ever sees a frame.

Measured on one machine, changing nothing but a lamp:

| | Dim room | Lamp on |
|---|---|---|
| Camera frame rate | **11 fps** | **30 fps** |
| Avatar lag | **180 ms** | **90 ms** |

**Half the lag, from a lamp.**

### What to do

- **Put a light in front of you**, pointed at your face. A desk lamp bounced off
  a wall or ceiling is fine and more flattering than direct light.
- **Do not sit with a window behind you.** The camera exposes for the bright
  window and leaves you a dark shape, which is the same problem with extra
  steps.
- **Check the fps number** under the camera preview. If it is amber, you do not
  have enough light.

### Why it matters so much

**Below about 15 fps, nothing in the app can save you.** Smoothing cannot invent
frames your camera never captured. Every setting that exists works on the signal
the camera delivers, and if that signal arrives twice a second there is nothing
to work with.

This is the first thing to check whenever the avatar feels wrong — before
settings, before tracking modes, before anything.

---

## Frame yourself properly

- **Fill a reasonable amount of the frame.** The tracker works from pixels, so a
  person far away is tracked from very little information. This matters most for
  hands and fingers.
- **Keep your hands in frame** if you want them tracked. When they leave, the
  avatar relaxes them smoothly rather than snapping.
- **Plain backgrounds help.** Not essential, but a cluttered background with
  person-shaped objects in it gives the tracker more chances to be wrong.
- **If you are sitting, press the posture button.** See
  [Performing](performing.md#sitting-or-standing).

---

## Reading the numbers

Under the camera preview, top left.

### Milliseconds — how far behind the avatar is

| | |
|---|---|
| **Green** | under 100 ms — feels attached to you |
| **Amber** | 100–150 ms — noticeable |
| **Red** | over 150 ms — feels like something following you |

This does **not** include OBS capturing and encoding, so your viewers see a bit
more than this. It tells you whether the app is your problem.

### fps — what your camera is giving you

**Amber below 20.** This is the number that explains a bad millisecond figure
most of the time, and the fix is usually light rather than a setting.

---

## Full tracking versus body-only

The one setting that genuinely changes performance. The **tracking button** on
the toolbar swaps between them.

| | **body only** | **full** |
|---|---|---|
| Head, torso, arms, legs | yes | yes |
| Individual fingers | **no** | yes |
| Blinking and eye movement from camera | **no** | yes |
| Speed on a mid-range phone | **~12 fps** | **~3 fps** |

**Body-only is the default**, for everyone. Full tracking costs roughly **three
and a half times** the frame rate, because it runs separate detection for each
hand and for your face on top of the body.

### Which should you use?

**Try full tracking.** If the fps number stays green and the avatar feels
responsive, keep it — fingers and real blinking are a genuine upgrade.

**If the fps drops or the lag goes amber, go back to body-only.** A smooth avatar
without fingers reads far better than a stuttering one with them. This is not a
close call: viewers notice stutter immediately and rarely notice fingers.

### Things to expect when you switch

- **It pauses.** A different model has to load. Your avatar keeps moving on the
  old one until the new one is ready.
- **It downloads.** Switching to full fetches another model the first time.
- **Your choice is remembered**, so you only pay that once.
- **Face and finger buttons grey out** in body-only mode, and hovering them
  explains why. They come back on when you return to full.

### What body-only actually loses

No fingers, and no camera-driven blinking or eye movement. Blinking still happens
— it runs on a timer instead, which most viewers never notice. Hand *orientation*
is also rougher, so wrists are less precise.

---

## Face tracking costs more than you would think

Turning on **face tracking** does not just add the cost of tracking your face. It
forces the whole pipeline onto a slower processing path, so **your body and hand
tracking get slower too.**

If everything got worse when you turned on blinking, that is why, and it is
working as designed rather than broken.

It also rebuilds the tracker, so expect a pause when you toggle it.

Worth it if you have frame rate to spare. The first thing to turn off if you do
not.

---

## Finger tracking is marked experimental

It works, but two things are worth knowing:

- **Fingers need pixels.** Precision depends on how much of the frame your hand
  occupies, so fingers are good close to the camera and poor far from it.
- **It makes jitter obvious.** A twitching fingertip is small and fast and far
  easier to see than a twitching arm. The jitter was always there; fingers show
  it to you.

If the hands look nervous, move closer, improve the light, or turn fingers off.

---

## On a phone

**It works**, on body-only tracking — around 12 fps, against 3 with full
tracking. That is the difference between an avatar that follows you and one that
lurches.

Body-only is already the default, so there is nothing you need to do. If you
switch to full on a phone, expect it to struggle, and switch back.

Phones also need good light more than laptops do, since phone cameras are
quicker to slow down in the dark.

---

## When it is still bad

In rough order of how often each is the answer:

1. **More light.** Check the fps number.
2. **Switch to body-only tracking.**
3. **Turn off face tracking**, which is the most expensive single option.
4. **Turn off finger tracking.**
5. **Close other tabs**, particularly anything playing video or running a game.
6. **Move closer** to the camera.
7. **Check nothing else is using the camera** — a video call holding the camera
   can force it to a lower frame rate.

If none of that helps, see [Troubleshooting](troubleshooting.md).
