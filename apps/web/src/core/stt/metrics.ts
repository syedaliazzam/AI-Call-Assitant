/**
 * File: apps/web/src/core/stt/metrics.ts
 * Purpose: Measurement helpers for the speech-to-text spike: speech-onset detection (to measure
 *          the lag from speaking to partial text), real-time factor, and medians.
 * Used by: src/core/stt/stt.worker.ts, src/features/dev/SttTest.tsx
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 (speech → partial text target); ADR-0020
 */

/** Settings for OnsetDetector. */
export interface OnsetOptions {
  /** Sample rate of the audio, in Hz. */
  sampleRate: number;
  /** Analysis frame length, in ms (default 10). */
  frameMs?: number;
  /** Quiet time required before a new onset counts, in ms (default 500). */
  minQuietMs?: number;
  /** Absolute loudness (RMS, 0…1) that always counts as speech (default 0.02). */
  minSpeechRms?: number;
  /** Speech must be this many times louder than the background (default 4). */
  noiseFactor?: number;
}

/**
 * Finds the moment speech starts after a quiet stretch, to the frame.
 * Background loudness is tracked while it is quiet; a frame louder than both minSpeechRms and
 * noiseFactor × background, after at least minQuietMs of quiet, is an onset.
 * The time returned is accurate to one frame (10 ms) within the audio stream.
 */
export class OnsetDetector {
  /** Samples per analysis frame. */
  private readonly frame: number;
  /** Quiet frames needed before an onset. */
  private readonly minQuietFrames: number;
  /** Absolute speech threshold. */
  private readonly minSpeechRms: number;
  /** Relative speech threshold. */
  private readonly noiseFactor: number;
  /** Smoothed background loudness. */
  private noise = 0.005;
  /** Consecutive quiet frames seen. */
  private quietFrames = 0;
  /** Samples left over from the previous chunk (less than one frame). */
  private carry: Float32Array = new Float32Array(0);

  /** @param options See OnsetOptions. */
  constructor(options: OnsetOptions) {
    this.frame = Math.round((options.sampleRate * (options.frameMs ?? 10)) / 1000);
    this.minQuietFrames = Math.ceil((options.minQuietMs ?? 500) / (options.frameMs ?? 10));
    this.minSpeechRms = options.minSpeechRms ?? 0.02;
    this.noiseFactor = options.noiseFactor ?? 4;
  }

  /**
   * Feeds the next chunk.
   *
   * @param samples Mono samples (-1…1).
   * @returns Index (within this chunk) of the first sample of the onset frame, or -1 if none.
   */
  push(samples: Float32Array): number {
    const data = new Float32Array(this.carry.length + samples.length);
    data.set(this.carry, 0);
    data.set(samples, this.carry.length);
    let onset = -1;
    let start = 0;
    for (; start + this.frame <= data.length; start += this.frame) {
      let sum = 0;
      for (let i = start; i < start + this.frame; i += 1) sum += (data[i] ?? 0) ** 2;
      const rms = Math.sqrt(sum / this.frame);
      const speech = rms > this.minSpeechRms && rms > this.noise * this.noiseFactor;
      if (speech) {
        if (onset === -1 && this.quietFrames >= this.minQuietFrames) {
          onset = Math.max(0, start - this.carry.length);
        }
        this.quietFrames = 0;
      } else {
        this.quietFrames += 1;
        // Follow the background slowly, so a single noise does not move it much.
        this.noise = this.noise * 0.95 + rms * 0.05;
      }
    }
    this.carry = data.slice(start);
    return onset;
  }
}

/**
 * Real-time factor: processing time divided by audio duration. Below 1 means faster than
 * real time; for a single-threaded decoder it is also the share of one CPU core in use.
 *
 * @param decodeMs Processing time, in ms.
 * @param audioMs  Duration of the processed audio, in ms.
 * @returns The ratio, or 0 when no audio was processed.
 * Called from: stt.worker.ts
 */
export function realTimeFactor(decodeMs: number, audioMs: number): number {
  return audioMs > 0 ? decodeMs / audioMs : 0;
}

/**
 * Percentile of a list of numbers (nearest rank: the smallest value with at least p% of the
 * values at or below it).
 *
 * @param values The numbers (not modified).
 * @param p      Percentile, 0…100 (95 for p95).
 * @returns The value, or null for an empty list.
 * Called from: SttTest.tsx (latency p95); tests
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

/**
 * Median of a list of numbers.
 *
 * @param values The numbers (not modified).
 * @returns The median, or null for an empty list.
 * Called from: SttTest.tsx
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
