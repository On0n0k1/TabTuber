# TabTuber — user guide

TabTuber turns your webcam into a VTubing avatar. It runs entirely in a browser
tab: your camera and microphone never leave your machine, and there is no
account to make and nothing to install.

**[Open the app →](https://on0n0k1.github.io/projects/tabtuber/)**

---

## Start here

New to it? Read these three, in order. Twenty minutes and you will have an
avatar on screen and in OBS.

**1. [Getting started](getting-started.md)**
Open the app, allow the camera, and understand what you are looking at.

**2. [Choosing an avatar](choosing-an-avatar.md)**
Use one of the two that come with it, or bring your own.

**3. [Streaming with OBS](streaming-with-obs.md)**
Get the avatar into your scene, over your game footage.

## Then, as you need it

**[Performing](performing.md)** — expressions and their keyboard shortcuts,
sitting or standing, mirroring, and the backdrop.

**[Lip sync](lip-sync.md)** — turn the microphone on and make the mouth follow
your voice properly.

**[Tracking quality](tracking-quality.md)** — how to get smooth, responsive
tracking, and what to do when it is not. **Read the first section even if
nothing is wrong.**

**[Troubleshooting](troubleshooting.md)** — something is wrong and you want it
fixed.

---

## The five-minute version

If you would rather not read anything:

1. **Open the app and allow the camera.** Your avatar appears.
2. **Turn a light on, facing you.** This matters more than any setting. A dim
   room halves your frame rate and doubles the lag.
3. **Ignore the panel on the right.** It is a developer tool. Everything you
   need is the row of icons along the bottom.
4. **Press the leftmost icon** to pick a camera, an avatar, and a backdrop.
5. **Press the microphone icon** if you want the mouth to move with your voice.
6. **Press 1 to 5** for expressions, and **0** to go back to neutral.

## Things worth knowing up front

- **Only the body is tracked by default.** No individual fingers, and blinking
  is on a timer rather than following your eyes. Fuller tracking is one button
  away, but it costs a lot of frame rate — see
  [Tracking quality](tracking-quality.md#full-tracking-versus-body-only).
- **Hiding the camera preview does not turn the camera off.** It only hides the
  picture.
- **Expressions are chosen by you, not read from your face.** The number keys
  are how you use them.
- **The mouth follows your microphone, not your camera.**
- **Your legs are not tracked while sitting.** On purpose — see
  [Performing](performing.md#sitting-or-standing).

## Nothing is uploaded

Worth being specific, because this is unusual for the category.

Your camera and microphone are read in the page. The tracking runs in the page.
The avatar is drawn in the page. An avatar file you drop in is read off your
disk and never sent anywhere. **There is no server** — the whole thing is a
static web page, so there is nowhere for your video to go even in principle.

Once the page has loaded, you can disconnect from the internet and it keeps
working.
