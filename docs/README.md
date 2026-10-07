# TabTuber documentation

Start at the [project README](../README.md) if you have not run it yet.

These documents are split by **who is reading**, because the two audiences want
different things and merging them serves neither. A performer who hits a wall of
solver terminology closes the tab.

---

## If you want a working avatar on screen

| | |
|---|---|
| **[The interface](interface.md)** | Every button on screen, what it does, and what it costs. The toolbar, the setup sheet, the latency readout, and why the panel on the right is not settings. |
| **[Streaming with OBS](obs.md)** | The two capture paths and the trade-off between them, which background mode goes with which, cropping the toolbar out of your scene, and audio sync. |
| **[Avatars](avatars.md)** | Bringing your own VRM, what a model needs in order to work fully, the two command-line tools, and the licence on the bundled models. |
| **[Lip sync](lipsync.md)** | The three mouth modes, vowel calibration, the noise gate, and why noise suppression ships off. |
| **[Troubleshooting](troubleshooting.md)** | Things that surprise people, and specific problems. **Read the first section even if nothing is wrong** — lighting sets your frame rate, and your frame rate sets everything else. |

## If you are working on the code

| | |
|---|---|
| **[Development](development.md)** | Setup, architecture and the import boundary, the layout, the check suite, commit conventions, CI and deployment, and where the design record lives. |
| **[Performance](performance.md)** | Where a frame actually goes, measured on a phone. What the tracking backends cost, what the worker changed, and what these numbers retired. |

---

## The short version

A few things that account for most of the questions:

- **Everything runs in the browser.** No video, audio or landmark data is
  uploaded, because there is no server to upload it to.
- **Lighting sets your frame rate.** 11fps in a dim room against 30fps with a
  lamp on, which halved total latency with no other change.
  → [troubleshooting.md](troubleshooting.md#turn-a-light-on-first)
- **Body-only tracking is the default, for everyone.** No fingers and no
  camera-driven blink or gaze until you switch the **Tracking** button to
  `full`. The fuller model costs about 3.5x the frame rate.
  → [interface.md](interface.md#tracking)
- **The panel on the right is a developer tool.** You should never need it.
  → [interface.md](interface.md#the-debug-panel)
- **Hiding the camera preview does not stop tracking.**
  → [interface.md](interface.md#camera-preview)
- **Expressions are chosen, not detected.** Number keys 1–5, and 0 or Escape
  for neutral. → [interface.md](interface.md#expressions)
- **Lip sync comes from the microphone, not the camera.**
  → [lipsync.md](lipsync.md)
- **The tracker is 83–92% of a frame and it is not ours.** Everything written
  here totals about 4%. → [performance.md](performance.md#the-tracker-is-the-whole-story-and-it-is-not-ours)
