/**
 * File: apps/web/src/core/stt/backlog.ts
 * Purpose: Keeps the live speech engine in real time (1.5.1, ADR-0069). The worker decodes both channels
 *          on one WebAssembly thread; when the computer is busy it decodes slower than the audio arrives,
 *          and before 1.5.1 nothing bounded the queue (measured 11 Nov 2026: 20–56 s behind on a busy
 *          laptop). This module decides, chunk by chunk, from how long the chunk waited in the worker's
 *          queue (the backlog):
 *          - above PAUSE_YOU_AT_MS: the user's own channel ("You") is set aside (kept, not decoded), so
 *            the other person's words, which make the questions, keep up; the page says the user's lines
 *            are filled in later;
 *          - above DROP_AT_MS: the other side's audio is skipped until the backlog is back under
 *            DROP_TARGET_MS (the words said meanwhile are lost; the page says it is catching up);
 *          - back under RESUME_BELOW_MS for RESUME_HOLD_MS: normal again, and the set-aside "You" audio
 *            is decoded a little faster than real time until none is left (and the rest at the end).
 *          DeferredAudio holds the set-aside "You" audio, at most MAX_DEFERRED_MS (the oldest goes first).
 * Used by: src/core/stt/stt.worker.ts
 * Depends on: nothing (pure; the caller passes the times)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §6.2; ADR-0069
 */

/** What the worker is doing about its backlog. */
export type BacklogState = 'ok' | 'you-paused' | 'dropping';

/** Backlog (ms) above which "You" is set aside. */
export const PAUSE_YOU_AT_MS = 1_000;

/** Backlog (ms) above which the other side's audio is skipped. */
export const DROP_AT_MS = 3_000;

/** While skipping, the backlog (ms) at which decoding the other side starts again. */
export const DROP_TARGET_MS = 1_000;

/** Backlog (ms) under which the worker counts as caught up. */
export const RESUME_BELOW_MS = 300;

/** How long (ms) the backlog must stay under RESUME_BELOW_MS before "You" is decoded again. */
export const RESUME_HOLD_MS = 5_000;

/** The most set-aside "You" audio kept (ms of audio); older audio is dropped. */
export const MAX_DEFERRED_MS = 90_000;

/** How many set-aside chunks are decoded per new "You" chunk while caught up (2× real time). */
export const CATCH_UP_CHUNKS = 3;

/**
 * Decides what the worker does with each chunk from the backlog it measures.
 */
export class BacklogController {
  /** The current state. */
  private current: BacklogState = 'ok';
  /** Since when (ms) the backlog has been under RESUME_BELOW_MS, or null. */
  private belowSince: number | null = null;

  /**
   * The current state.
   *
   * @returns 'ok', 'you-paused' or 'dropping'.
   */
  get state(): BacklogState {
    return this.current;
  }

  /**
   * Takes the backlog of a chunk that has just been taken from the queue.
   *
   * @param lagMs How long the chunk waited in the worker's queue, ms.
   * @param now   The worker's clock, ms.
   * @returns The state after this chunk.
   * Called from: stt.worker.ts (decodeChunk)
   */
  observe(lagMs: number, now: number): BacklogState {
    if (lagMs > DROP_AT_MS) {
      this.current = 'dropping';
      this.belowSince = null;
      return this.current;
    }
    if (this.current === 'dropping' && lagMs <= DROP_TARGET_MS) this.current = 'you-paused';
    if (this.current === 'ok' && lagMs > PAUSE_YOU_AT_MS) this.current = 'you-paused';
    if (this.current === 'you-paused') {
      if (lagMs < RESUME_BELOW_MS) {
        this.belowSince ??= now;
        if (now - this.belowSince >= RESUME_HOLD_MS) {
          this.current = 'ok';
          this.belowSince = null;
        }
      } else {
        this.belowSince = null;
      }
    }
    return this.current;
  }

  /**
   * How many set-aside "You" chunks to decode with a new "You" chunk.
   *
   * @param lagMs The new chunk's backlog, ms.
   * @returns 0 while not in real time; CATCH_UP_CHUNKS when caught up; 1 (keep pace) in between.
   * Called from: stt.worker.ts (decodeChunk)
   */
  catchUp(lagMs: number): number {
    if (this.current !== 'ok') return 0;
    return lagMs < RESUME_BELOW_MS ? CATCH_UP_CHUNKS : 1;
  }
}

/** One set-aside chunk. */
export interface DeferredChunk {
  /** 16 kHz samples. */
  samples: Float32Array;
  /** Capture time of the last sample, on the sender's audio clock (s). */
  endTime: number;
}

/**
 * The set-aside "You" audio, oldest first, bounded to MAX_DEFERRED_MS.
 */
export class DeferredAudio {
  /** The chunks. */
  private chunks: DeferredChunk[] = [];
  /** Audio held, ms. */
  private heldMs = 0;
  /** Audio dropped because the store was full, ms. */
  private droppedTotal = 0;

  /**
   * @param sampleRate Samples per second of the chunks (default 16 kHz).
   * @param maxMs      The most audio kept, ms (default MAX_DEFERRED_MS).
   */
  constructor(
    private readonly sampleRate = 16_000,
    private readonly maxMs = MAX_DEFERRED_MS,
  ) {}

  /**
   * Audio held.
   *
   * @returns Milliseconds of audio.
   */
  get ms(): number {
    return this.heldMs;
  }

  /**
   * Audio dropped so far because the store was full.
   *
   * @returns Milliseconds of audio.
   */
  get droppedMs(): number {
    return this.droppedTotal;
  }

  /**
   * Number of chunks held.
   *
   * @returns The count.
   */
  get length(): number {
    return this.chunks.length;
  }

  /**
   * Keeps a chunk; drops the oldest when the store is full.
   *
   * @param chunk The chunk.
   * Called from: stt.worker.ts
   */
  push(chunk: DeferredChunk): void {
    this.chunks.push(chunk);
    this.heldMs += this.lengthMs(chunk);
    while (this.heldMs > this.maxMs && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      const ms = this.lengthMs(dropped);
      this.heldMs -= ms;
      this.droppedTotal += ms;
    }
  }

  /**
   * Takes the oldest chunk.
   *
   * @returns The chunk, or undefined when none is held.
   * Called from: stt.worker.ts
   */
  shift(): DeferredChunk | undefined {
    const chunk = this.chunks.shift();
    if (chunk) this.heldMs = Math.max(0, this.heldMs - this.lengthMs(chunk));
    return chunk;
  }

  /**
   * A chunk's length.
   *
   * @param chunk The chunk.
   * @returns Its length, ms.
   */
  private lengthMs(chunk: DeferredChunk): number {
    return (chunk.samples.length / this.sampleRate) * 1000;
  }
}
