/**
 * File: apps/web/src/core/stt/gate.ts
 * Purpose: Skips decoding for a channel while it is silent (an "energy gate"), so a silent
 *          channel costs almost no CPU and cannot produce phantom words. Each ~100 ms chunk is
 *          either passed to the recognizer or held back; when speech starts, the last 300 ms
 *          that were held back are passed first, so the start of the first word is not cut.
 * Used by: src/core/stt/channel.ts (one gate per channel)
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 ("VAD skips silence"); ADR-0020
 *
 * Why (measured on Day 2, Chrome/Electron, plugged in): each channel cost a real-time factor of
 * about 0.25 whether it carried speech or silence, so two channels reached 0.50–0.51 (the limit
 * is 0.5), and a digitally silent channel produced phantom "AND" lines.
 *
 * Why it is lenient: on Day 1 a loudness threshold cut sentences in the middle. This gate never
 * closes while an utterance is showing text (the caller tells it), stays open 1.5 s after the
 * last loud chunk (longer than the end-of-utterance rules need), and opens at a low level.
 * Day 2 Stage 5 evaluates Silero VAD, which can replace this.
 */

/** Settings for SilenceGate. */
export interface GateOptions {
  /** Chunk loudness (RMS, 0…1) that always counts as sound (default 0.004). */
  minRms?: number;
  /** Sound must also be this many times louder than the background (default 2.5). */
  noiseFactor?: number;
  /** How long the gate stays open after the last loud chunk, in ms (default 1500). */
  hangoverMs?: number;
  /** How much held-back audio is passed on when the gate opens, in ms (default 300). */
  preRollMs?: number;
  /** Window for the background level (the quietest chunk in it), in chunks (default 50 = 5 s). */
  noiseWindowChunks?: number;
}

/** A chunk with its capture time (as the channel receives it). */
export interface GateChunk {
  /** 16 kHz mono samples. */
  samples: Float32Array;
  /** Capture time of the last sample (sender's audio clock, seconds). */
  endTime: number;
}

/**
 * Root-mean-square loudness of a chunk.
 *
 * @param samples Samples (-1…1).
 * @returns RMS, 0…1 (0 for an empty chunk).
 * Called from: SilenceGate.push(); tests
 */
export function chunkRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += (samples[i] ?? 0) ** 2;
  return Math.sqrt(sum / samples.length);
}

/** One channel's energy gate. */
export class SilenceGate {
  /** Absolute sound threshold. */
  private readonly minRms: number;
  /** Relative sound threshold. */
  private readonly noiseFactor: number;
  /** Hangover length, in ms. */
  private readonly hangoverMs: number;
  /** Pre-roll length, in ms. */
  private readonly preRollMs: number;
  /**
   * Loudness of the latest chunks. The background level is the quietest of them ("minimum
   * statistics"): speech always has dips between words, so it cannot raise the level, while a
   * steady noise sets it within the window. (A level learned only from quiet chunks never learns
   * a noise that is itself above the threshold.)
   */
  private recentRms: number[] = [];
  /** Size of that window, in chunks. */
  private readonly noiseWindowChunks: number;
  /** Audio time (ms) since the last loud chunk; starts "long ago" so the gate starts closed. */
  private msSinceSound = Number.POSITIVE_INFINITY;
  /** Held-back chunks (the latest preRollMs of audio). */
  private held: GateChunk[] = [];
  /** Audio held back in `held`, in ms. */
  private heldMs = 0;
  /** True while chunks are being passed on. */
  private open = false;

  /** @param options See GateOptions. */
  constructor(options: GateOptions = {}) {
    this.minRms = options.minRms ?? 0.004;
    this.noiseFactor = options.noiseFactor ?? 2.5;
    this.hangoverMs = options.hangoverMs ?? 1_500;
    this.preRollMs = options.preRollMs ?? 300;
    this.noiseWindowChunks = options.noiseWindowChunks ?? 50;
  }

  /**
   * Decides what to do with the next chunk.
   *
   * @param chunk      The chunk.
   * @param chunkMs    Its duration, in ms.
   * @param busy       True while the channel's current utterance shows text (keeps the gate open).
   * @returns The chunks to decode now, in order: [] while silent; the held-back pre-roll plus
   *          this chunk when sound starts; just this chunk while open.
   * Called from: ChannelDecoder.accept() in channel.ts
   */
  push(chunk: GateChunk, chunkMs: number, busy: boolean): GateChunk[] {
    const rms = chunkRms(chunk.samples);
    // Background = quietest recent chunk (0 before any: then only minRms applies).
    const background = this.recentRms.length > 0 ? Math.min(...this.recentRms) : 0;
    const loud = rms >= this.minRms && rms >= background * this.noiseFactor;
    this.recentRms.push(rms);
    if (this.recentRms.length > this.noiseWindowChunks) this.recentRms.shift();
    if (loud) this.msSinceSound = 0;
    else this.msSinceSound += chunkMs;
    const shouldBeOpen = busy || this.msSinceSound <= this.hangoverMs;

    if (shouldBeOpen) {
      const out = this.open ? [chunk] : [...this.held, chunk];
      this.open = true;
      this.held = [];
      this.heldMs = 0;
      return out;
    }
    this.open = false;
    this.held.push(chunk);
    this.heldMs += chunkMs;
    while (this.held.length > 1 && this.heldMs - chunkMs >= this.preRollMs) {
      this.held.shift();
      this.heldMs -= chunkMs;
    }
    return [];
  }

  /**
   * True while chunks are passed on.
   *
   * @returns Whether the gate is open.
   */
  get isOpen(): boolean {
    return this.open;
  }
}
