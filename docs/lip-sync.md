# Lip sync

Making the avatar's mouth follow your voice.

---

## Turn it on

Press the **microphone icon** on the toolbar and allow microphone access when
your browser asks. That is the whole setup — the mouth now opens and closes with
your voice.

Your choice is remembered, so it comes back on next time.

**Nothing is recorded and nothing is sent anywhere.** Your microphone is read in
the page, like your camera.

## The mouth follows your microphone, not your camera

Even with full face tracking on, the mouth comes from your voice. Reading mouth
shapes off the camera was tried and abandoned — the tracking was not accurate
enough, and a mouth that is wrong *in sync with your face* looks worse than one
that is approximate but always in time with what you are saying.

---

## Making it look better

The microphone button is all most people need. If you want the mouth to actually
articulate rather than just open and shut, there is more to turn on — but it
lives in the **panel on the right**, the one the rest of this guide tells you to
ignore.

That is a fair criticism of the app rather than of you. Open the panel, find
**Lip sync**, and everything below is in there. Nothing you do in that folder can
break anything.

### The three mouth modes

| Mode | What you get |
|---|---|
| **amplitude** | the mouth opens as far as you are loud. The default |
| **animated** | it also moves through mouth shapes at the rate of speech |
| **vowel** | it matches the actual vowel you are saying — **needs calibration** |

**amplitude** is honest and never wrong, because it only claims to know how loud
you are. It can look a little like a puppet.

**animated** looks considerably more like talking. It does not know which sound
you are making — it moves through plausible shapes at roughly the right rate,
which your eye reads as speech. For most people this is the best
effort-to-result step available.

**vowel** is the real thing, and it needs a minute of setup first. **Without
calibration it behaves exactly like animated** — so if you switch to it and see
no difference, that is why.

`openness` next to the mode controls how far the mouth travels.

### Calibrating your vowels

In the **Vowel calibration** folder, press **record aa / ee / ou** and hold three
sounds when prompted:

| | |
|---|---|
| **"ahh"** | as in f*a*ther |
| **"eee"** | as in s*ee* |
| **"ooo"** | as in b*oo*t |

About a second each. Hold each one steadily rather than saying it — it is
listening to the sustained sound. The avatar holds still while you do this.

Only three, because those three are the corners of the range and every other
vowel sits between them. The app works the rest out.

**Your calibration is remembered between sessions.** *forget calibration*
clears it if you want to redo it, and *cancel* abandons a recording in progress.

Do it with the microphone you actually stream with, in the room you stream from.

---

## Stopping things that are not your voice

### The browser's noise cancelling

Three switches in the **Noise cancelling** folder. The defaults are deliberate
and not all the same, so here is what each one is for:

| | Default | |
|---|---|---|
| **echoCancellation** | **on** | **Leave this on.** Without it, game audio coming out of your speakers moves your avatar's mouth. The single most useful one here |
| **noiseSuppression** | **off** | Removes steady background noise — fans, hum. Off because most people already have noise removal in front of the browser, and doing it twice chews up the quiet parts of words |
| **autoGainControl** | **off** | Evens out your volume, which is exactly the signal the mouth is reading. Turning it on makes the mouth less expressive |

If you have no other noise processing and a noisy room, **noiseSuppression** is
worth trying. If you already run something like RNNoise or NVIDIA Broadcast,
leave it off.

Note that noise suppression only deals with *steady* noise. A clap, a snap or a
keyboard clack goes straight through it — that is what the gate below is for.

### The noise gate

A sound has to **last** a moment before it counts as speech. This is what stops
a finger snap or a door closing from flapping the avatar's mouth.

The defaults work for most people. If you want to tune it:

| | |
|---|---|
| **min duration (s)** | how long a sound must last to count. **0 turns the gate off** |
| **hangover (s)** | how long speech stays open after you stop, so gaps between words do not close the mouth |
| **open level** | how loud something must be before it is considered at all |
| **noise gate** | how far above your room's noise floor counts as speech |
| **mic gain** | turn this up if your microphone is quiet |

**To set it:** open the **Mic** readouts and watch while you talk. You want
`level` sitting near zero when you are quiet and climbing when you speak, and
`speaking` flipping between 0 and 1 in time with your voice rather than with your
room.

---

## If the mouth is snapping fully open and shut

A known problem with a known cause. If you run **aggressive noise removal before
the browser** — EasyEffects, RNNoise, NVIDIA Broadcast — those tools produce
*complete digital silence* between words. The app measures your room's noise
level to work out what counts as speech, and complete silence breaks that
measurement, so almost everything reads as maximum volume.

The result is a mouth that is either fully open or shut, with nothing in between.

**The fix:** turn the upstream noise removal down or off and let the app's own
gate do that job. It is built for exactly this.

---

## Quick fixes

| Problem | Try |
|---|---|
| Mouth does not move at all | Check the microphone icon is lit, and that your browser has microphone permission. Check `level` in the **Mic** readouts moves when you talk |
| Mouth moves when you are not talking | Raise **min duration** or **open level**. If it is tracking your game audio, turn **echoCancellation** on |
| Mouth barely opens | Raise **mic gain**, or **openness** |
| Mouth is open or shut with nothing between | See [above](#if-the-mouth-is-snapping-fully-open-and-shut) |
| Mouth looks like a puppet | Switch the mode to **animated** |
| Switched to **vowel** and nothing changed | You have not calibrated yet |

---

## Next

**[Tracking quality →](tracking-quality.md)** or **[Streaming with OBS
→](streaming-with-obs.md)**
