/**
 * File: apps/web/src/core/audio/resample.ts
 * Purpose: Converts audio from the AudioContext's sample rate to 16 kHz (what the speech model
 *          expects), streaming: it keeps its position between calls, so chunk boundaries do not
 *          cause clicks or drift.
 * Used by: src/core/audio/resampler.worklet.ts (its source is embedded into the worklet)
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 ("resamples each channel to 16 kHz")
 *
 * Keep StreamingResampler self-contained (no imports, no references to other top-level names):
 * resampler.worklet.ts embeds its source text with `.toString()`.
 */

/** Sample rate the speech-to-text model expects. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Streaming linear-interpolation resampler for mono audio.
 * Linear interpolation is enough for speech recognition: the model only uses frequencies
 * below 8 kHz, and the AudioContext is normally created at 16 kHz already (then this is a copy).
 */
export class StreamingResampler {
  /** Input samples per output sample (for example 3 for 48 kHz → 16 kHz). */
  readonly ratio: number;
  /** Position of the next output sample, in input samples, relative to the current block. */
  position = 0;
  /** Last input sample of the previous block (needed to interpolate across the boundary). */
  previous = 0;

  /**
   * @param inputRate  Sample rate of the incoming audio, in Hz.
   * @param outputRate Sample rate to produce, in Hz.
   */
  constructor(inputRate: number, outputRate: number) {
    this.ratio = inputRate / outputRate;
  }

  /**
   * Resamples the next block of input.
   *
   * @param input The next mono samples (-1…1).
   * @returns The resampled samples for this block (may be empty for tiny inputs).
   */
  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    const output: number[] = [];
    // `position` may be negative: the next output lies between `previous` and input[0].
    while (this.position < input.length - 1) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const left = index < 0 ? this.previous : (input[index] ?? 0);
      const right = input[index + 1] ?? 0;
      output.push(left + (right - left) * fraction);
      this.position += this.ratio;
    }
    this.previous = input[input.length - 1] ?? 0;
    this.position -= input.length;
    return Float32Array.from(output);
  }
}

/**
 * Collects samples into fixed-size chunks (for example 1,600 samples = 100 ms at 16 kHz).
 */
export class Chunker {
  /** Chunk length in samples. */
  readonly size: number;
  /** Samples waiting for the current chunk to fill. */
  private buffer: Float32Array;
  /** How many samples of `buffer` are filled. */
  private filled = 0;

  /** @param size Chunk length in samples. */
  constructor(size: number) {
    this.size = size;
    this.buffer = new Float32Array(size);
  }

  /**
   * Adds samples and returns every chunk that became full.
   *
   * @param samples New samples.
   * @returns Zero or more complete chunks (each a new array, safe to transfer).
   */
  push(samples: Float32Array): Float32Array[] {
    const chunks: Float32Array[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.size - this.filled, samples.length - offset);
      this.buffer.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.size) {
        chunks.push(this.buffer);
        this.buffer = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return chunks;
  }
}
