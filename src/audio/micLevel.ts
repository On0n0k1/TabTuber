/*
 * Microphone level for lip sync (SPEC.md section 8).
 *
 * Audio drives the mouth rather than face tracking, deliberately. Mouth shapes
 * are subtle and their blendshapes are the noisiest part of a face model,
 * while viewers notice lip sync more than anything else on a face -- so the
 * microphone is both the cheaper and the better signal (SPEC.md 13.3).
 *
 * Levels are self-calibrating. A fixed silence threshold would be exactly the
 * user-specific constant that does not transfer: microphones, rooms and voices
 * differ by orders of magnitude. Instead the noise floor is measured from the
 * quiet passages that occur naturally between words (SPEC.md 12.1).
 */

/** Seconds of history kept, so the mouth can be aligned to a delayed body. */
const HISTORY_SECONDS = 0.5;

export interface MicParams {
  /** Manual trim on top of the self-calibrated floor. */
  gain: number;
  /**
   * How far above the measured noise floor counts as speech.
   *
   * A multiplier rather than an absolute level, so it means the same thing on
   * a quiet condenser and a noisy laptop microphone.
   */
  threshold: number;
  /** Seconds for the mouth to open. Short: mouths open fast. */
  attack: number;
  /** Seconds for the mouth to close. Longer than attack, as real mouths are. */
  release: number;
}

export const DEFAULT_MIC_PARAMS: MicParams = {
  gain: 1.6,
  threshold: 2.5,
  attack: 0.02,
  release: 0.12,
};

export type MicState =
  | { readonly kind: "off" }
  | { readonly kind: "starting" }
  | { readonly kind: "on" }
  | { readonly kind: "error"; readonly message: string };

export class MicLevel {
  params: MicParams = { ...DEFAULT_MIC_PARAMS };

  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  // Typed as backed by ArrayBuffer specifically: getFloatTimeDomainData
  // rejects a possibly-shared buffer.
  private samples = new Float32Array(new ArrayBuffer(0));

  private state: MicState = { kind: "off" };
  private readonly listeners = new Set<(s: MicState) => void>();

  /** Envelope-followed speech energy, 0 to 1. */
  private energy = 0;
  private rms = 0;
  /**
   * Slow estimate of the room's noise level. Falls quickly toward quiet and
   * rises slowly, so it settles on the floor between words rather than being
   * dragged up by speech.
   */
  private floor = 0.002;

  // Timestamped history, so the mouth can be read at the moment the body is
  // rendering rather than the moment the sound arrived.
  private readonly historyTime: number[] = [];
  private readonly historyEnergy: number[] = [];

  get current(): number {
    return this.energy;
  }

  get level(): number {
    return this.rms;
  }

  get noiseFloor(): number {
    return this.floor;
  }

  get running(): boolean {
    return this.state.kind === "on";
  }

  onState(cb: (s: MicState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => this.listeners.delete(cb);
  }

  private setState(s: MicState): void {
    this.state = s;
    for (const cb of this.listeners) cb(s);
  }

  /**
   * Must be called from a user gesture: browsers refuse to start an
   * AudioContext otherwise, which is why this is a panel toggle rather than
   * something requested at load.
   */
  async start(): Promise<void> {
    if (this.state.kind === "on" || this.state.kind === "starting") return;
    this.setState({ kind: "starting" });

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // All three would fight the envelope: the mouth should follow what
          // was said, not what a noise suppressor decided to keep.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch (err) {
      this.setState({ kind: "error", message: describeMicError(err) });
      return;
    }

    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    // Small window: speech envelope changes far faster than a large FFT would
    // resolve, and only amplitude is needed.
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.samples = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

    this.setState({ kind: "on" });
  }

  stop(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.context?.close();
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.energy = 0;
    this.rms = 0;
    this.historyTime.length = 0;
    this.historyEnergy.length = 0;
    this.setState({ kind: "off" });
  }

  /** Call once per rendered frame. `timestampMs` stamps the history entry. */
  update(dt: number, timestampMs: number): number {
    if (!this.analyser) return 0;

    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const v = this.samples[i] ?? 0;
      sum += v * v;
    }
    this.rms = Math.sqrt(sum / this.samples.length);

    // Fall fast, rise slow: the floor should track the quiet between words
    // and resist being pulled up by the words themselves.
    const towardFloor = this.rms < this.floor ? 0.5 : 0.002;
    this.floor += (this.rms - this.floor) * towardFloor;
    this.floor = Math.max(this.floor, 1e-5);

    const above = Math.max(0, this.rms - this.floor * this.params.threshold);
    // Normalised against the floor rather than an absolute level, so the
    // result is a ratio and transfers across microphones.
    const target = Math.min(1, (above / (this.floor * 8)) * this.params.gain);

    const tau = target > this.energy ? this.params.attack : this.params.release;
    this.energy += (target - this.energy) * approach(dt, tau);

    this.historyTime.push(timestampMs);
    this.historyEnergy.push(this.energy);
    const cutoff = timestampMs - HISTORY_SECONDS * 1000;
    while (this.historyTime.length > 1 && (this.historyTime[0] as number) < cutoff) {
      this.historyTime.shift();
      this.historyEnergy.shift();
    }

    return this.energy;
  }

  /**
   * Energy as it was at a given moment.
   *
   * The body is delayed by the lookahead buffer (SPEC.md 6.1), so reading the
   * newest value would put the mouth ahead of the rest of the avatar. The
   * rendered pose carries the timestamp of the moment it represents, and the
   * mouth is read at that same moment, which keeps the avatar internally
   * coherent. The voice is then realigned at the broadcast end, which is
   * standard practice.
   */
  sampleAt(timestampMs: number): number {
    if (this.historyTime.length === 0) return this.energy;
    for (let i = this.historyTime.length - 1; i >= 0; i--) {
      if ((this.historyTime[i] as number) <= timestampMs) {
        return this.historyEnergy[i] as number;
      }
    }
    return this.historyEnergy[0] as number;
  }
}

function approach(dt: number, tau: number): number {
  return tau <= 0 ? 1 : Math.min(1, 1 - Math.exp(-dt / tau));
}

function describeMicError(err: unknown): string {
  if (!(err instanceof DOMException)) return "The microphone could not be started.";
  switch (err.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone permission was denied. Allow it in site settings and retry.";
    case "NotFoundError":
      return "No microphone was found.";
    case "NotReadableError":
      return "The microphone is in use by another application.";
    default:
      return "The microphone could not be started.";
  }
}
