/**
 * File: apps/web/src/core/stt/echoCanceller.ts
 * Purpose: Removes the other side's voice from the microphone before speech-to-text (1.5.2, ADR-0070), with
 *          WebRTC's echo canceller (AEC3) compiled to WebAssembly (@ennuicastr/webrtcaec3.js 0.3.0,
 *          BSD-3-Clause) and the "Them" channel as its reference. On laptop speakers the microphone hears
 *          the other side about as loud as the user (the real call of 11 Nov 2026: −1.4 dB at 10 ms), and the
 *          browser's own echo cancellation cannot help because another app plays that sound. Measured on
 *          that call's stereo file: the echo fell to −48 dB, the user's own voice changed by 0.0 dB, at
 *          about 3% of one core. With headphones there is no echo to learn and nothing changes.
 *          Audio in 10 ms frames (160 samples at 16 kHz), through small queues so any chunk size works; the
 *          output lags the input by at most one frame (10 ms), filled with silence at the very start.
 * Used by: src/core/stt/stt.worker.ts (in the speech worker, before the coupling gate)
 * Depends on: an AEC3 instance (the WebAssembly module's AEC3 class), passed in so tests use a fake
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2; ADR-0064 (its fallback), ADR-0070
 *
 * Audio only; nothing is stored, sent or logged.
 */

/** Samples per frame: 10 ms at 16 kHz, what AEC3 works in. */
export const AEC_FRAME = 160;

/** The sample rate the speech worker works at. */
export const AEC_RATE = 16_000;

/** The parts of the WebAssembly module's AEC3 instance used here. */
export interface Aec3Instance {
  /** Takes one frame of the reference (what the speakers play), one array per channel. */
  analyze(data: Float32Array[]): void;
  /** The output size for one captured frame, per channel. */
  processSize(data: Float32Array[]): number;
  /** Cancels the echo in one captured frame into `out`. */
  process(out: Float32Array[], data: Float32Array[]): void;
}

/** A first-in, first-out queue of samples. */
class SampleQueue {
  /** The samples, from `start`. */
  private buffer = new Float32Array(AEC_FRAME * 32);
  /** Where the oldest sample is. */
  private start = 0;
  /** How many samples are queued. */
  length = 0;

  /**
   * Adds samples at the end.
   *
   * @param samples The samples.
   */
  push(samples: Float32Array): void {
    if (this.start + this.length + samples.length > this.buffer.length) {
      const next = new Float32Array(
        Math.max(this.buffer.length, (this.length + samples.length) * 2),
      );
      next.set(this.buffer.subarray(this.start, this.start + this.length));
      this.buffer = next;
      this.start = 0;
    }
    this.buffer.set(samples, this.start + this.length);
    this.length += samples.length;
  }

  /**
   * Takes `count` samples from the front.
   *
   * @param count How many (at most `length`).
   * @returns A copy of them.
   */
  take(count: number): Float32Array {
    const out = this.buffer.slice(this.start, this.start + count);
    this.start += count;
    this.length -= count;
    if (this.length === 0) this.start = 0;
    return out;
  }
}

/** Cancels the reference's echo in the microphone's audio. */
export class EchoCanceller {
  /** Reference samples not yet analysed (less than a frame). */
  private readonly render = new SampleQueue();
  /** Microphone samples not yet processed (less than a frame). */
  private readonly capture = new SampleQueue();
  /** Processed samples not yet handed back. */
  private readonly out = new SampleQueue();
  /** True once the lag's silence was put in front (the first call). */
  private primed = false;

  /**
   * @param aec The AEC3 instance (16 kHz, one channel each way).
   */
  constructor(private readonly aec: Aec3Instance) {}

  /**
   * Feeds the reference: the other side's audio, as it arrives.
   *
   * @param samples 16 kHz samples.
   * Called from: stt.worker.ts (each "Them" chunk)
   */
  addReference(samples: Float32Array): void {
    this.render.push(samples);
    while (this.render.length >= AEC_FRAME) this.aec.analyze([this.render.take(AEC_FRAME)]);
  }

  /**
   * Cancels the echo in the microphone's audio. Call in time order, after the reference up to the same
   * time was added (the worker's held chunks see to that).
   *
   * @param samples 16 kHz samples.
   * @returns As many samples, the echo removed (up to one frame later).
   * Called from: stt.worker.ts (each "You" chunk, before the coupling gate)
   */
  cancel(samples: Float32Array): Float32Array {
    if (!this.primed) {
      // At most one frame waits in the queue: a constant lag, filled with silence once at the start.
      this.out.push(new Float32Array(AEC_FRAME));
      this.primed = true;
    }
    this.capture.push(samples);
    while (this.capture.length >= AEC_FRAME) {
      const frame = this.capture.take(AEC_FRAME);
      const size = this.aec.processSize([frame]);
      const cleaned = [new Float32Array(size)];
      this.aec.process(cleaned, [frame]);
      // AEC3 returns one frame for one frame; anything else is passed through unchanged.
      this.out.push(size === AEC_FRAME ? cleaned[0]! : frame);
    }
    const ready = Math.min(samples.length, this.out.length);
    const result = new Float32Array(samples.length);
    result.set(this.out.take(ready), samples.length - ready);
    return result;
  }
}
