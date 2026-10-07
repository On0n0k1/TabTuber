# Performance

**Written for someone working on the code**, not for a performer. If you just
want to know whether it runs on your phone and which button to press, the
README's [On a phone](../README.md#on-a-phone) paragraph is the whole answer and
this page is not.

The reasoning behind these numbers — what was tried, what was rejected, and why
— lives in `SPEC.md` §9.4, §9.5 and §11. This page reports the measurements and
what they settle. It does not restate the argument, because two copies of a
rationale become two different rationales.

---

## Provenance, stated up front

Everything here comes from **Chrome DevTools traces on one Android phone**,
captured 2026-10-06 and 2026-10-07, a few seconds each, one trace per
configuration. Desktop comparisons come from two traces on one desktop.

That is thin, and it matters for how much weight each finding can carry:

- The **3.5x** difference between tracking backends survives this provenance
  comfortably. It is a large effect measured twice.
- The **3-percentage-point** move in blocked main-thread time does not, and
  should not be read as a finding. It is inside the noise of single short
  traces.

One device, one browser, two configurations. Treat the ratios as real and the
third significant figure as decoration.

> **One configuration has changed since these traces.** They were captured
> before the tracker moved off the main thread, which landed the same day as
> the second set. The per-inference costs below still describe what inference
> costs; the claims about the **main thread** being blocked describe the
> pre-worker build. See [What the worker changed](#what-the-worker-changed).

---

## Holistic against pose: the backend is the whole lever

Measured on the same phone, 2026-10-06 (Holistic) and 2026-10-07 (pose).

| | Holistic | Pose (body only) | Change |
|---|---|---|---|
| Tracking rate | 3.4fps | 11.8fps | **3.5x** |
| Frame wall time | 288.1ms | 82.3ms | −71% |
| Main thread blocked off-CPU | 64% | 61% | −3pp |
| Tracker total | 310.0ms/frame | 75.1ms/frame | −76% |
| `gl.readPixels` | 237.6ms/frame | 58.6ms/frame | −75% |
| `gl.readPixels`, share of runtime | 70.9% | 64.7% | −6.2pp |
| Readback sub-graphs | 5 | 3 | −2 |

Holistic runs five sub-graphs — pose detection, pose landmarks, face and two
hands — and **each pulls its output tensors back on its own**. Pose runs three.
Dropping two of them is where the 3.5x comes from.

This is why body-only is the shipping default for everyone, and why that
default is described as a **mitigation rather than a fix**: it bought less work
of the same kind. It did not change what the work does.

**What body-only costs you:** no hands, no face. Fingers are unavailable,
camera-driven blink and gaze are unavailable, and hand orientation falls back to
three crude knuckle estimates.

---

## Where a frame goes

Per frame, and as a share of sampled main-thread time. **Shares do not total
100%** — the remainder is native code and idle.

| Bucket | Holistic | share | Pose | share |
|---|---|---|---|---|
| MediaPipe tracker | 310.02ms | 92.5% | 75.11ms | 83.0% |
| three.js + three-vrm | 4.91ms | 1.47% | 3.35ms | 3.70% |
| Debug panel (lil-gui) | 3.27ms | 0.98% | 2.42ms | 2.67% |
| Solver, filters, buffer | 1.22ms | 0.36% | 0.40ms | 0.44% |
| 2D landmark overlay | 0.65ms | 0.19% | 0.28ms | 0.31% |
| Latency HUD | 0.49ms | 0.15% | 0.26ms | 0.29% |

### Read the shares column carefully — it is a trap

**Every first-party bucket shows a larger *share* after the change while
costing *less* per frame.** three.js went from 4.91ms to 3.35ms and its share
rose from 1.47% to 3.70%. The solver went from 1.22ms to 0.40ms and its share
rose.

Nothing got more expensive. **The denominator fell by 76%.** Rendering did not
become a bigger cost; the tracker stopped being such an enormous one.

This is the one way to misread the table, and it is an easy one, which is why it
is flagged immediately next to it rather than in a footnote.

### The tracker is the whole story, and it is not ours

**83–92% of a frame is MediaPipe.** Everything written in this repository —
rendering, solving, filtering, the overlay, the HUD — totals about **4.1%**.

That number settles a recurring question — "should we optimise the solver" — and
it settles it as **no**. The solver is 0.36% of a Holistic frame. Making it
infinitely fast is not measurable.

---

## Where a 288ms Holistic frame actually goes

From the 2026-10-06 trace: 5.2s, 16 inference frames, GPU delegate, inference
unthrottled, blendshapes off.

| Per frame | Share | What |
|---|---|---|
| **185ms** | **64%** | main thread **blocked off-CPU** in `gl.readPixels` |
| 55ms | 19% | MediaPipe's own wasm compute |
| 17ms | 6% | MediaPipe JS and WebGL glue |
| 13ms | 5% | native, unattributed |
| **12ms** | **4%** | **everything this repository wrote** |

Call chain: `step` (the `requestVideoFrameCallback` callback) → `process` →
`detectForVideo` → `finishProcessing` → graph → `_emscripten_glReadPixels` →
`readPixels`.

### The readback is a wait, not a cost

This is the distinction that decided the architecture, and it is the difference
between something to optimise and something to **move**.

The frame tasks carry thread CPU time alongside wall time: **4,610ms of wall
against 1,677ms of CPU**. The GPU process logs **185ms/frame of `GPUTask`
overlapping exactly that window**.

So the phone's GPU is genuinely busy for the duration. This is not IPC overhead
and not a driver quirk a flag might remove — it is the Holistic graph costing
~185ms of real shader work, which `glReadPixels` then waits for
**synchronously**, parking the thread that also draws the avatar.

**19 separate readback bursts per frame, across 5 distinct call paths**, one per
sub-graph.

---

## The phone is uniformly ~14x slower, and that is the finding

A share-based comparison — 73% of the phone's main thread against 15% of the
desktop's — **overstates the case**, because the desktop's denominator is full
of idle time. It renders at 60fps while its camera delivers about 11fps, so
roughly 12ms per frame of idle sits in the denominator.

Normalised **per inference** instead, the two devices look alike:

| Per inference | Desktop | Phone | Ratio |
|---|---|---|---|
| Frame wall time | 20.2ms | 288.1ms | **14x** |
| `gl.readPixels` | 14.6ms | 214.6ms | **15x** |
| MediaPipe wasm compute *(pure CPU)* | 2.5ms | 34.3ms | **14x** |
| MediaPipe JS and WebGL glue | 1.4ms | 21.0ms | **15x** |
| App JS | 0.9ms | 10.9ms | **13x** |

**The uniformity is the point.** If GPU readback were this phone's particular
weakness, its ratio would stand out. 15x for readback is indistinguishable from
14x for pure-CPU wasm that never touches a GPU. Both devices also run exactly
five readback paths per inference, so the graph is doing the same work on each.

Readback is **not a mobile pathology to engineer around**. It is the biggest
line item on a device that is slower at everything, and a uniform 14x gap cannot
be restructured away. **Doing less work is the only lever** — which is what the
pose backend is.

---

## What the worker changed

The tracker now runs in a **Worker** (`src/tracker/worker/`), selected at
startup by `chooseHost()`, with a main-thread host as the fallback when a
`Worker` or `OffscreenCanvas` is unavailable or the worker fails to start. The
console says which one is running, and by which frame transport.

**It makes nothing cheaper.** Inference costs exactly what it cost before. What
it changes is *where the stall sits*: the 82ms (pose) or 288ms (Holistic)
synchronous wait is no longer on the thread that draws the avatar, so the
avatar renders smoothly while tracking runs at its own rate.

That is why the "main thread blocked off-CPU" rows above should be read as
history rather than as current behaviour. They describe the configuration that
motivated the worker.

**Not yet re-measured.** There is no post-worker trace in this document, and the
numbers to expect it to change are the blocked-thread shares and the render
frame rate, not the per-inference costs.

---

## What these numbers retired

### Rust/WASM is not the mobile answer

Everything this repository wrote is **12ms of a 288ms frame**. The specifically
math-shaped part a port would replace — solver, one-euro filters, matrix and
quaternion work — is **~2ms/frame, 0.8%**.

Making it *infinitely fast* takes the frame from 288ms to 286ms. **3.42fps to
3.45fps.**

Three reasons the answer is structural rather than a language choice:

1. **The hot code is already wasm.** 874ms of the trace is MediaPipe's own
   compiled `vision_wasm_internal.wasm`, which is not ours to speed up.
2. **Our share is 4%**, and the addressable part of it is a fifth of that.
3. **It is a synchronous stall.** Single-threaded wasm runs on the same blocked
   thread and cannot overlap a readback.

The criteria for introducing Rust are further from being met than before these
traces, not closer. They are recorded in `SPEC.md` §10.

### Optimising the solver

0.36% of a Holistic frame, 0.44% of a pose frame. Settled as no.

---

## Still open

- **Whether the CPU delegate beats the GPU on a phone.** Unmeasured, and less
  promising than it first looks. The CPU delegate eliminates readback but moves
  the tensor math into wasm, where the phone is also 14x slower — trading a 15x
  penalty for a 14x penalty on *more* work. Worth running, since the experiment
  is one setting in the panel.
- **What inference rate is worth paying for.** The `maxInferenceHz` throttle is
  built and ships off, so no trace answers this yet.
- **A post-worker trace.** See above.
- **Model variant and capture resolution.** `full` → `lite`, and a smaller
  capture, both shrink the tensors and the shader work behind them. Untried.
- **The lil-gui readout loops.** `.listen()` on each disabled readout gives
  lil-gui one `requestAnimationFrame` loop per controller — **32 rAF callbacks
  per frame**, whether or not anyone can see a single number. Measured at 2.67%
  of runtime in pose mode, which is six times the solver and more than the
  three.js renderer. It is the largest piece of first-party code in that
  profile and it is a readout nobody is looking at. Deliberately not fixed yet:
  behind a 288ms tracker frame it was invisible, and it is worth an order of
  magnitude more now that the stall has moved off-thread. `SPEC.md` §18.4 has
  the three things a fix has to get right.
