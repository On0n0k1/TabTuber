# Troubleshooting

Find your symptom. Each fix is something that has actually caught someone out.

---

## Start here

Two things account for most problems:

1. **Is there a light on your face?** Check the **fps number** under the camera
   preview. Amber means not enough light, and that affects everything else.
   → [Light yourself properly](tracking-quality.md#light-yourself-properly)
2. **Is there a message at the top of the page?** Errors stay up until you
   dismiss them and usually say exactly what is wrong.

---

## Nothing appears

### The page is blank, or stuck on a message

The first load fetches the tracking model, which takes a few seconds. The bar at
the top tells you what it is doing.

If it stays stuck: reload. If it is still stuck, your connection is probably
blocking the download.

### "Camera permission was denied"

Your browser blocked the camera, or you clicked Block. Look for a camera icon in
your browser's address bar, allow it, and reload the page.

### No camera error, but no avatar either

Check the panel on the right is not hiding it, and try switching avatar in
**Setup**. If an avatar fails to load, the top bar says so.

### It will not use my camera at all

The page needs a **secure address** to access a camera: `https://` or
`localhost`. If you are opening it over your home network by IP address
(`http://192.168...`), browsers refuse camera access and always will.

---

## Something is wrong with the camera

### The wrong camera is being used

**Setup → Camera**, and pick the one you want.

If it says **"(current camera unknown)"**, your browser is not reporting which
camera it chose — choosing one from the list explicitly settles it.

If it says **"no camera found"**, your browser is not seeing any camera. Check it
is plugged in and that nothing else has exclusive hold of it.

### Another app has my camera

Close video calls and anything else using the camera. Some apps will let the
camera be shared but force it to a lower frame rate, which looks like a
performance problem rather than a conflict.

### Turning off the preview did not turn off my camera

**It is not supposed to.** The eye icon hides the picture only — tracking carries
on, and the camera light stays on.

There is no control in the app that stops the camera. Close the tab or revoke the
permission in your browser.

---

## The avatar moves badly

### Everything is laggy or stuttery

**Light first.** Check the fps number — if it is amber, that is your answer.
→ [Tracking quality](tracking-quality.md#light-yourself-properly)

Then, in order: switch to **body-only** tracking, turn off **face tracking**,
turn off **finger tracking**, close other tabs.
→ [When it is still bad](tracking-quality.md#when-it-is-still-bad)

### It got much worse when I turned on blinking

Expected. **Face tracking forces the whole pipeline onto a slower path**, so your
body and hand tracking slow down too, not just the face. Turn it back off if you
cannot spare the frame rate.
→ [Face tracking costs more than you would think](tracking-quality.md#face-tracking-costs-more-than-you-would-think)

### The avatar moves less than I do, or seems sluggish

Likely your **model**, not the tracking. A missing bone silently drops its share
of the movement, so the avatar under-rotates — which reads as sluggishness rather
than as an error.

Try one of the bundled avatars. If that moves properly, it is your model.
→ [What makes a model work well](choosing-an-avatar.md#what-makes-a-model-work-well)

### The hands jitter

Normal, and most visible with finger tracking on. Fingers are tracked from pixels,
so a hand far from the camera is tracked from very little.

Move closer, add light, or turn finger tracking off.

### My avatar is standing up while I am sitting down

**Press the posture button** to switch to sitting.

The tracker reports your legs confidently even when it cannot see them under a
desk, so the avatar believes them. Sitting mode throws that data away.
→ [Sitting or standing](performing.md#sitting-or-standing)

### My fingers do not move

Three possible reasons:

1. **Tracking is set to body-only** — the default. Switch to full tracking.
2. **Finger tracking is off.** It is a separate button from tracking mode.
3. **Your model has no finger bones.** Try a bundled avatar to tell the
   difference.

### My avatar does not blink, or its eyes do not move

Blinking runs on a timer by default and should always happen. For blinking and
eye movement that follow *your* face, you need full tracking **and** the face
tracking button.

If the eyes never move even then, your model may have no eye bones.

### Raising my right hand raises the wrong one

That is mirroring, and it is on by default on purpose — the avatar behaves like a
mirror. Turn **Mirror** off in Setup if you want it to face you like another
person instead.

---

## The mouth is wrong

### It does not move at all

Check the microphone icon is lit and that your browser granted microphone
permission. Open the panel on the right, find the **Mic** readouts, and check
`level` moves when you talk.

### It moves when I am not talking

If it is following your game audio, turn **echoCancellation** on, or use
headphones. Otherwise raise **min duration** or **open level** in the Lip sync
folder.

### It snaps fully open and shut with nothing in between

A known problem. You are almost certainly running **aggressive noise removal
before the browser** — EasyEffects, RNNoise, NVIDIA Broadcast. Those produce
complete silence between words, which breaks the app's measurement of your room.

Turn the upstream noise removal down or off.
→ [Full explanation](lip-sync.md#if-the-mouth-is-snapping-fully-open-and-shut)

### It looks like a puppet just flapping

Switch the mouth mode to **animated**, or calibrate and use **vowel**.
→ [The three mouth modes](lip-sync.md#the-three-mouth-modes)

### I switched to vowel mode and nothing changed

You have not calibrated yet. Vowel mode behaves exactly like animated until you
do.
→ [Calibrating your vowels](lip-sync.md#calibrating-your-vowels)

---

## Streaming problems

### My viewers can see my toolbar

Crop it out. The toolbar is part of the page, so OBS captures it with the
avatar. It never moves, so one crop filter lasts.
→ [Crop the interface out](streaming-with-obs.md#crop-the-interface-out)

### The background is green on stream

Set **Background → `transparent`** if you are using a Browser Source, or add a
**Chroma Key** filter if you are using Window Capture.
→ [Streaming with OBS](streaming-with-obs.md)

### There is a green fringe around the hair

Chroma keying always costs a little edge quality. Tune the Chroma Key filter's
similarity and smoothness, or switch to a **Browser Source**, which has real
transparency and no fringe at all.
→ [The better way](streaming-with-obs.md#the-better-way-browser-source)

### OBS will not give the page my camera

A known awkwardness with Browser Sources. If the workarounds do not help, use
**Window Capture** instead — permissions simply work there.
→ [Deal with camera permission](streaming-with-obs.md#3-deal-with-camera-permission)

### Parts of my avatar are transparent on stream

You are chroma keying and your avatar is wearing green. Either change the outfit
or switch to a Browser Source.

### My voice is ahead of the avatar

Only happens if you turned on **lookahead**. Add a positive sync offset to your
microphone in OBS — later, not earlier.
→ [Audio sync](streaming-with-obs.md#audio-sync)

### The expression keys do nothing while I stream

The keys only work when the **browser window** has focus, not OBS. Click into the
browser window, or keep it on a second monitor.

### The expression keys do nothing at all

They are ignored while your cursor is in a text box. Click an empty part of the
page and try again.

---

## Starting over

If settings have ended up in a state you want rid of:

Open the panel on the right, find **Session**, and press **clear saved
settings**. Then **reload the page**.

That clears your remembered tracking mode, lip sync state, posture and vowel
calibration.

Note that **reset panel to defaults** next to it is a different thing — it only
resets the panel's own controls, and for anything remembered it resets to the
remembered value rather than the original.

---

## Still stuck

Nothing here matching? The browser console records every message the app raises,
including ones that cleared themselves — open your browser's developer tools and
look at the Console tab. That is the most useful thing to include if you report a
problem.
