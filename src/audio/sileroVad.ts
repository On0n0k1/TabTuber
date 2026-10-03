/*
 * Silero VAD: a model that knows what speech sounds like (SPEC.md section 8).
 *
 * The duration gate rejects things that are SHORT -- typing, clicks. It cannot
 * reject things that are sustained: a snap carries room reverb past the
 * threshold, and music, fans or another person talking never trip it at all.
 * Separating those needs something that knows the shape of speech rather than
 * its length, which is what this is.
 *
 * LOADED ON DEMAND, deliberately. The ONNX runtime and the model are several
 * megabytes, and a toggle that leaves them in the main bundle would not be a
 * meaningful performance choice -- the cost would already have been paid.
 * The dynamic import means nothing is fetched, parsed or instantiated until
 * the toggle is turned on.
 *
 * It shares the existing microphone and AudioContext rather than opening its
 * own, so enabling it neither re-prompts for permission nor runs a second
 * capture pipeline.
 */

import type { MicVAD } from "@ricky0123/vad-web";

export type SileroState = "off" | "loading" | "on" | "error";

/** Where fetch-assets stages the worklet, model and ONNX runtime. */
const ASSET_PATH = "/vad/";
const ORT_WASM_PATH = "/vad/ort/";

export class SileroVad {
  /** Probability the current frame is speech, 0 to 1. */
  probability = 0;
  /** Model inference time per frame, milliseconds. */
  inferenceMs = 0;

  private vad: MicVAD | null = null;
  private status: SileroState = "off";
  private lastFrameAt = 0;

  get state(): SileroState {
    return this.status;
  }

  get ready(): boolean {
    return this.status === "on";
  }

  /** Frames arrive every 32ms at 16kHz; 0 once they stop. */
  get frameAgeMs(): number {
    return this.lastFrameAt === 0 ? 0 : performance.now() - this.lastFrameAt;
  }

  async start(stream: MediaStream, audioContext: AudioContext): Promise<void> {
    if (this.status === "on" || this.status === "loading") return;
    this.status = "loading";
    console.info("vad: loading Silero model");

    try {
      // Dynamic so the ONNX runtime is a separate chunk, fetched only here.
      const { MicVAD } = await import("@ricky0123/vad-web");

      const started = performance.now();
      this.vad = await MicVAD.new({
        model: "v5",
        audioContext,
        // Reuse the microphone already running rather than opening a second.
        getStream: () => Promise.resolve(stream),
        // The stream's lifetime belongs to MicLevel, so these must not stop
        // it -- doing so would silence the level meter as well.
        pauseStream: () => Promise.resolve(),
        resumeStream: () => Promise.resolve(stream),
        baseAssetPath: ASSET_PATH,
        onnxWASMBasePath: ORT_WASM_PATH,
        startOnLoad: true,
        onFrameProcessed: (probabilities) => {
          const now = performance.now();
          // Frames arrive every 32ms, so the gap between them is dominated by
          // that period rather than by inference. Measuring the interval and
          // subtracting the nominal period is the closest honest estimate of
          // the cost without instrumenting inside the worklet.
          if (this.lastFrameAt > 0) {
            this.inferenceMs = Math.max(0, now - this.lastFrameAt - 32);
          }
          this.lastFrameAt = now;
          this.probability = probabilities.isSpeech;
        },
      });

      console.info(`vad: ready in ${(performance.now() - started).toFixed(0)} ms`);
      this.status = "on";
    } catch (err) {
      console.warn("vad: failed to start", err);
      this.status = "error";
      this.vad = null;
    }
  }

  stop(): void {
    if (this.status === "off") return;
    console.info("vad: stopping");
    void this.vad?.destroy();
    this.vad = null;
    this.probability = 0;
    this.inferenceMs = 0;
    this.lastFrameAt = 0;
    this.status = "off";
  }
}
