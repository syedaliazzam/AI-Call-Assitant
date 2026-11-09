/**
 * File: apps/web/src/core/stt/coupling.ts
 * Purpose: The coupling gate (v1.4, ADR-0064): keeps the other side's voice, played on the laptop's
 *          speakers and heard again by the microphone, out of the "You" channel's speech recognition.
 *          The browser's echo cancellation cannot do this in the desktop app, because the meeting app
 *          (Zoom, Teams) plays the sound outside the browser, so the browser has nothing to compare with.
 *          The speech worker has both channels on one audio clock, so it can:
 *          1. learn the coupling: how late (0–300 ms) and how loud the "Them" sound comes back on the
 *             microphone, from how closely the two channels' loudness moves together while "Them" talks;
 *          2. silence a 100 ms microphone chunk whose loudness that coupling explains frame by frame
 *             (each 10 ms frame no louder than the predicted echo plus a 6 dB margin).
 *          When the user talks over the other person, the microphone is clearly louder than the echo, so
 *          their words pass. With headphones there is no coupling to learn, so nothing is ever silenced.
 * Used by: src/core/stt/stt.worker.ts (one gate for the "you" channel, fed by both channels)
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2; ADR-0064
 *
 * Numbers only: no audio is kept beyond a few seconds of 10 ms loudness values.
 */

/** Samples per 10 ms frame at 16 kHz. */
export const FRAME_SAMPLES = 160;

/** Settings of the coupling gate. */
export interface CouplingOptions {
  /** The longest echo delay looked for, in ms (default 300). */
  maxDelayMs?: number;
  /** How much audio the coupling is learnt from, in ms (default 3,000). */
  windowMs?: number;
  /** How much louder than the predicted echo a frame may be and still count as echo, in dB (default 6). */
  marginDb?: number;
  /** How closely the loudness must move together to trust the coupling, 0…1 (default 0.6). */
  minCorrelation?: number;
  /** A "Them" frame quieter than this (mean square) is silence (default 1e-5, about -50 dBFS). */
  activeEnergy?: number;
  /** Share of a chunk's frames the echo must explain to silence it (default 0.9). */
  explainedShare?: number;
  /** How long a learnt coupling is kept without being confirmed again, in ms (default 15,000). */
  keepMs?: number;
}

/** What the gate has learnt (for statistics and tests). */
export interface CouplingState {
  /** True when a coupling is learnt and recent enough to use. */
  trusted: boolean;
  /** The echo's delay, in ms. */
  delayMs: number;
  /** The echo's level relative to the "Them" sound, in dB. */
  gainDb: number;
  /** How closely the loudness moved together when it was last learnt, 0…1. */
  correlation: number;
  /** Microphone chunks silenced so far. */
  silencedChunks: number;
}

/**
 * Mean square energy of each 10 ms frame of a chunk.
 *
 * @param samples The chunk (16 kHz).
 * @returns One energy per whole frame.
 * Called from: CouplingGate; tests
 */
export function frameEnergies(samples: Float32Array): Float32Array {
  const frames = Math.floor(samples.length / FRAME_SAMPLES);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = f * FRAME_SAMPLES; i < (f + 1) * FRAME_SAMPLES; i += 1)
      sum += (samples[i] ?? 0) ** 2;
    out[f] = sum / FRAME_SAMPLES;
  }
  return out;
}

/**
 * Pearson correlation of two equally long lists.
 *
 * @param a One list.
 * @param b The other.
 * @returns -1…1 (0 when either does not vary).
 * Called from: CouplingGate.learn()
 */
function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const meanA = a.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]! - meanA;
    const y = b[i]! - meanB;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb);
}

/** The coupling gate for the microphone channel. */
export class CouplingGate {
  /** Settings, with defaults applied. */
  private readonly options: Required<CouplingOptions>;
  /** "Them" frame energies by absolute 10 ms frame number (audio clock × 100). */
  private readonly them = new Map<number, number>();
  /** Microphone frame energies by absolute frame number. */
  private readonly you = new Map<number, number>();
  /** The newest "Them" frame number seen. */
  private themNewest = Number.NEGATIVE_INFINITY;
  /** The learnt delay, in frames. */
  private delayFrames = 0;
  /** The learnt gain (power ratio of echo to "Them"). */
  private gain = 0;
  /** The correlation when last learnt. */
  private lastCorrelation = 0;
  /** Frame number until which the learnt coupling may be used. */
  private trustedUntil = Number.NEGATIVE_INFINITY;
  /** Chunks silenced so far. */
  private silenced = 0;
  /** Microphone chunks since the coupling was last learnt (it is learnt every LEARN_EVERY chunks). */
  private sinceLearnt = 0;

  /** @param options See CouplingOptions. */
  constructor(options: CouplingOptions = {}) {
    this.options = {
      maxDelayMs: options.maxDelayMs ?? 300,
      windowMs: options.windowMs ?? 3_000,
      marginDb: options.marginDb ?? 6,
      minCorrelation: options.minCorrelation ?? 0.6,
      activeEnergy: options.activeEnergy ?? 1e-5,
      explainedShare: options.explainedShare ?? 0.9,
      keepMs: options.keepMs ?? 15_000,
    };
  }

  /**
   * The absolute frame number of a chunk's first frame.
   *
   * @param samples The chunk.
   * @param endTime Capture time of its last sample (audio clock, seconds).
   * @returns The frame number.
   */
  private firstFrame(samples: Float32Array, endTime: number): number {
    return Math.round(endTime * 100) - Math.floor(samples.length / FRAME_SAMPLES);
  }

  /**
   * Forgets frames older than the learning window plus the longest delay.
   *
   * @param map    Frame energies.
   * @param newest The newest frame number.
   */
  private prune(map: Map<number, number>, newest: number): void {
    const keep = (this.options.windowMs + this.options.maxDelayMs) / 10 + 20;
    for (const frame of map.keys()) {
      if (frame < newest - keep) map.delete(frame);
    }
  }

  /**
   * Takes a chunk of the other side's sound (the reference).
   *
   * @param samples 16 kHz samples (about 100 ms).
   * @param endTime Capture time of its last sample (audio clock, seconds).
   * Called from: stt.worker.ts (every "them" chunk)
   */
  pushThem(samples: Float32Array, endTime: number): void {
    const first = this.firstFrame(samples, endTime);
    frameEnergies(samples).forEach((energy, i) => this.them.set(first + i, energy));
    this.themNewest = Math.max(
      this.themNewest,
      first + Math.floor(samples.length / FRAME_SAMPLES) - 1,
    );
    this.prune(this.them, this.themNewest);
  }

  /**
   * Whether the reference is complete for a microphone chunk: every frame the echo of that chunk could
   * come from has arrived (the two channels' chunks reach the worker one after the other).
   *
   * @param samples The microphone chunk.
   * @param endTime Its capture time (audio clock, seconds).
   * @returns True when the "Them" sound up to the chunk's end is in.
   * Called from: stt.worker.ts (whether to hold a microphone chunk back one step)
   */
  hasReferenceFor(samples: Float32Array, endTime: number): boolean {
    return (
      this.themNewest >=
      this.firstFrame(samples, endTime) + Math.floor(samples.length / FRAME_SAMPLES) - 1
    );
  }

  /**
   * Takes a microphone chunk and decides whether it is only the echo of the other side.
   *
   * @param samples 16 kHz samples (about 100 ms).
   * @param endTime Capture time of its last sample (audio clock, seconds).
   * @returns The chunk to decode: the same samples, or silence when the coupling explains it.
   * Called from: stt.worker.ts (every "you" chunk)
   */
  processYou(samples: Float32Array, endTime: number): Float32Array {
    const first = this.firstFrame(samples, endTime);
    const energies = frameEnergies(samples);
    energies.forEach((energy, i) => this.you.set(first + i, energy));
    const newest = first + energies.length - 1;
    this.prune(this.you, newest);
    this.sinceLearnt += 1;
    if (this.sinceLearnt >= LEARN_EVERY) {
      this.sinceLearnt = 0;
      this.learn(newest);
    }
    if (newest > this.trustedUntil || this.gain === 0) return samples;
    const margin = 10 ** (this.options.marginDb / 10);
    let explained = 0;
    let active = 0;
    energies.forEach((energy, i) => {
      const at = first + i - this.delayFrames;
      const reference = this.them.get(at);
      if (reference === undefined) return;
      if (reference >= this.options.activeEnergy) active += 1;
      // The room keeps ringing a little after the other side stops: the loudest of the last
      // TAIL_FRAMES "Them" frames predicts the echo.
      let loudest = reference;
      for (let back = 1; back < TAIL_FRAMES; back += 1) {
        loudest = Math.max(loudest, this.them.get(at - back) ?? 0);
      }
      // A quiet microphone frame holds nothing to decode either.
      if (energy < this.options.activeEnergy || energy <= this.gain * loudest * margin)
        explained += 1;
    });
    // Only while the other side is talking: a quiet "Them" explains nothing.
    if (active < energies.length * ACTIVE_SHARE) return samples;
    if (explained < energies.length * this.options.explainedShare) return samples;
    this.silenced += 1;
    return new Float32Array(samples.length);
  }

  /**
   * Learns the coupling from the last window: for each delay, how closely the microphone's loudness
   * follows the delayed "Them" loudness while "Them" talks; the best delay, if close enough, gives the
   * gain (the median power ratio). Kept for keepMs without a new confirmation.
   *
   * @param newest The newest microphone frame number.
   */
  private learn(newest: number): void {
    const maxLag = Math.round(this.options.maxDelayMs / 10);
    const windowFrames = Math.round(this.options.windowMs / 10);
    let best = { lag: 0, r: 0 };
    for (let lag = 0; lag <= maxLag; lag += 1) {
      const a: number[] = [];
      const b: number[] = [];
      for (let frame = newest - windowFrames + 1; frame <= newest; frame += 1) {
        const mic = this.you.get(frame);
        const reference = this.them.get(frame - lag);
        if (mic === undefined || reference === undefined || reference < this.options.activeEnergy)
          continue;
        a.push(Math.log10(mic + 1e-12));
        b.push(Math.log10(reference + 1e-12));
      }
      // At least MIN_LEARN_FRAMES of "Them" talking in the window.
      if (a.length < MIN_LEARN_FRAMES) continue;
      const r = correlation(a, b);
      if (r > best.r) best = { lag, r };
    }
    if (best.r < this.options.minCorrelation) return;
    const ratios: number[] = [];
    for (let frame = newest - windowFrames + 1; frame <= newest; frame += 1) {
      const mic = this.you.get(frame);
      const reference = this.them.get(frame - best.lag);
      if (mic === undefined || reference === undefined || reference < this.options.activeEnergy)
        continue;
      ratios.push(mic / reference);
    }
    ratios.sort((x, y) => x - y);
    // The 40th percentile, not the median: frames where the user also talks have a higher ratio and
    // must not raise the estimate (that would silence the user's quieter words over the other person).
    this.gain = ratios[Math.floor(ratios.length * GAIN_PERCENTILE)] ?? 0;
    this.delayFrames = best.lag;
    this.lastCorrelation = best.r;
    this.trustedUntil = newest + this.options.keepMs / 10;
  }

  /**
   * What the gate has learnt.
   *
   * @returns The state.
   * Called from: stt.worker.ts (statistics); tests
   */
  state(): CouplingState {
    return {
      trusted: this.gain > 0 && this.trustedUntil > Number.NEGATIVE_INFINITY,
      delayMs: this.delayFrames * 10,
      gainDb: this.gain > 0 ? 10 * Math.log10(this.gain) : Number.NEGATIVE_INFINITY,
      correlation: this.lastCorrelation,
      silencedChunks: this.silenced,
    };
  }
}

/** The coupling is learnt again every this many microphone chunks (5 = half a second). */
export const LEARN_EVERY = 5;

/** Which share of the power ratios gives the echo's gain (see learn()). */
export const GAIN_PERCENTILE = 0.4;

/** Fewest 10 ms frames of the other side talking the coupling is learnt from (0.6 s). */
export const MIN_LEARN_FRAMES = 60;

/** How many 10 ms frames of the room's ringing the echo prediction covers (150 ms). */
export const TAIL_FRAMES = 15;

/** The share of a chunk's frames in which the other side must be talking for it to be silenced. */
export const ACTIVE_SHARE = 0.1;
