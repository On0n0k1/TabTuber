# Lip sync

The avatar's mouth is driven by **your microphone, not your camera**.

Camera-driven mouth shapes were built, tried and removed: the tracking was not
good enough to be worth what it cost. A mouth that is wrong in a way that
tracks your face reads worse than one that is approximate but always in time
with your voice.

Turn it on with the **microphone icon** on the toolbar. The browser asks for
permission the first time, and your choice is remembered between sessions.
Nothing is recorded and nothing is sent anywhere.

Everything below lives in the debug panel's **`Lip sync`** folder. It is the one
part of that panel worth documenting, because the defaults are deliberate and
several of them are the opposite of what you would guess.

---

## The three mouth modes

| Mode | What it does | Claims to know |
|---|---|---|
| `amplitude` | the mouth opens as far as you are loud | nothing but volume |
| `animated` | adds plausible articulation at speech rate | that you are speaking, not what |
| `vowel` | blends visemes using your own calibrated vowel space | which vowel you are on |

**`amplitude`** is the default and the honest one. Loud means open. It is never
wrong about anything because it does not assert anything beyond your volume.

**`animated`** moves the mouth through viseme shapes at the rate speech
actually articulates, without claiming to know which phoneme you are on. This
is a deliberate piece of plausible fakery: a mouth that only opens and closes
reads as a puppet, and a mouth that cycles through shapes at roughly the right
rate reads as speech even though the particular shapes are invented. It avoids
visiting all five visemes evenly, which would look like someone enunciating
vowel exercises rather than talking.

**`vowel`** is the real thing, and it needs calibration first. It places your
voice in your own vowel space and blends the visemes by where it lands.
**Without a calibration it behaves exactly as `animated`**, because there is no
space to place anything in — so switching to it and noticing no difference
means you have not calibrated yet.

`openness` scales how far the mouth travels in any mode.

---

## Vowel calibration

Press **record aa / ee / ou** in the `Vowel calibration` folder and hold three
vowels when prompted:

| Prompt | |
|---|---|
| Hold "ahh" | as in *father* |
| Hold "eee" | as in *see* |
| Hold "ooo" | as in *boot* |

About **1.2 seconds each**, with the first 0.3s of each discarded — the start of
a sound is still becoming the vowel and is spectrally unlike it. Only three are
recorded because those three are the *corners* of the vowel triangle and every
other vowel sits inside it; `ih` and `oh` are derived rather than asked for.

The avatar holds still while you are holding a vowel, because calibration
consumes those frames instead of the mouth. Silence between prompts is fine —
collection is gated on you actually making a sound, so a pause neither
contaminates the sample nor advances the step.

Your calibration is **remembered between sessions**. *forget calibration*
clears it, and *cancel* abandons a capture in progress.

---

## Noise cancelling

These three are the **browser's own** audio processing, applied live rather than
on restart. There is no model to ship and nothing implemented here — Chrome
routes them through the same WebRTC code that cleans up calls.

**The defaults are not uniform, because the three do different things:**

| | Default | Why |
|---|---|---|
| `noiseSuppression` | **off** | runs a second suppressor over an already-cleaned signal |
| `echoCancellation` | **on** | without it, game audio through speakers moves the avatar's mouth |
| `autoGainControl` | **off** | it flattens exactly the variation the mouth exists to express |

**`noiseSuppression` is off, having been on.** Anyone who cares about their
audio already has a processing chain in front of the browser, and a second
suppressor over a clean signal attacks the quiet parts of words, because that is
all that is left to attack. The project's position on the speech gate is the
same one: a performer's own microphone does this better than a browser tab can.

Turning it off costs less than it sounds, and for a reason worth knowing:
suppression targets **stationary** noise — fans, hum, room tone. A snap, clap or
knock is a transient and passes through it largely intact. So the thing
suppression removed was never what was moving the mouth wrongly. The duration
gate below is what defends against those.

**`echoCancellation` matters specifically for VTubing.** If you monitor on
speakers rather than headphones, your game's audio arrives at your microphone
and your avatar mouths along to it.

**`autoGainControl` normalises loudness**, which is precisely the signal the
mouth is reading. Leave it off.

---

## The noise gate

A sound must **last** a minimum duration before it counts as speech. This is
what stops a finger snap, a keyboard clack or a door closing from moving the
avatar's mouth.

| Control | |
|---|---|
| `min duration (s)` | how long a sound must last to count. **0 disables the gate** |
| `hangover (s)` | how long speech stays "open" after the sound stops, so ordinary gaps between words do not close the mouth |
| `open level` | how loud a sound must be before the timer starts at all |
| `noise gate` | the threshold above the measured noise floor |
| `close time (s)` | how quickly the envelope falls once you stop |
| `mic gain` | input scaling, if your microphone runs hot or quiet |

The gate rejects **transients only**. Sustained noise is the microphone's job
and it does it better than any envelope follower in a tab.

### Setting it

Open the **`Mic`** readout group and watch four numbers: `level`, `floor`,
`energy` and `speaking`. It is a meter to watch rather than numbers to trust.

Set the gate by watching `level` sit near zero while you are silent and climb
while you speak, and `speaking` flip between 0 and 1 in time with your voice
rather than with your room.

---

## A known limitation: upstream hard gating

**Measured, not speculated, and not yet fixed.**

The microphone's noise floor is self-calibrating, which assumes a noise floor
exists. Upstream hard gating — EasyEffects, RNNoise, NVIDIA Broadcast — produces
**digital silence** between words. The floor then collapses to its minimum
clamp, and the normalisation against it saturates: **89% of speech frames pin at
full open**, against 5% when normalising against a sensible lower bound.

The symptom is a mouth that is **binary** — fully open or shut, not following
your voice.

"There is no noise floor" is a legitimate input that the code cannot currently
represent. If you run aggressive upstream gating and the mouth snaps rather
than flows, this is why. The workaround for now is to relax or disable the
upstream gate and let this application's own duration gate do that job.
