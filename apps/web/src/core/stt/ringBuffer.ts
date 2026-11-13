/**
 * File: apps/web/src/core/stt/ringBuffer.ts
 * Purpose: The last RING_SECONDS of one channel's cleaned audio (ADR-0076, investigation C9). When a
 *          channel moves from Deepgram to the on-device engine, the audio Deepgram had not finished with is
 *          replayed from here first, so the words spoken during the gap are not lost. Memory only; never
 *          stored, sent or logged.
 * Used by: src/core/stt/cloudStt.ts; tests/unit/core/stt/ringBuffer.test.ts
 * Depends on: nothing
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C1, C9; ADR-0076
 */

/** How much audio each channel keeps, seconds. */
export const RING_SECONDS = 10;

/** One stored chunk. */
export interface RingChunk {
  /** 16 kHz samples (cleaned). */
  samples: Float32Array;
  /** Capture time of the last sample, audio clock seconds. */
  endTime: number;
}

/** A channel's recent audio. */
export class RingBuffer {
  /** Chunks, oldest first. */
  private chunks: RingChunk[] = [];

  /** @param seconds How much to keep (default RING_SECONDS). */
  constructor(private readonly seconds: number = RING_SECONDS) {}

  /**
   * Adds a chunk and drops what is older than the window.
   *
   * @param chunk The chunk.
   * Called from: cloudStt.ts (every chunk of the channel)
   */
  push(chunk: RingChunk): void {
    this.chunks.push(chunk);
    const keepFrom = chunk.endTime - this.seconds;
    while (this.chunks.length > 0 && this.chunks[0]!.endTime <= keepFrom) this.chunks.shift();
  }

  /**
   * The chunks that end after a moment, oldest first.
   *
   * @param afterTime Audio clock seconds (chunks ending at or before it are left out).
   * @returns The chunks (the stored objects; the caller copies before moving them).
   * Called from: cloudStt.ts (the replay after a failover)
   */
  since(afterTime: number): RingChunk[] {
    return this.chunks.filter((chunk) => chunk.endTime > afterTime);
  }

  /**
   * The start of the oldest chunk kept.
   *
   * @returns Audio clock seconds, or null when empty.
   */
  oldestStart(): number | null {
    const first = this.chunks[0];
    return first ? first.endTime - first.samples.length / 16_000 : null;
  }

  /** Drops everything. */
  clear(): void {
    this.chunks = [];
  }
}
