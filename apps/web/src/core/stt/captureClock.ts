/**
 * File: apps/web/src/core/stt/captureClock.ts
 * Purpose: One capture clock for a call (ADR-0076, investigation E3 rule 1). Every chunk of both channels
 *          comes from one AudioContext, stamped with that context's audio clock (seconds). This turns the
 *          audio clock into Unix ms, so every line, grey or final, from Deepgram or from the on-device
 *          fallback, carries the time its words were captured, never the time a message reached the page.
 *          The offset (Unix ms − audio ms) is the smallest seen over a sliding window: the chunk that waited
 *          least in transit is closest to the true clock difference, and the window lets it follow a slow
 *          drift between the audio and system clocks.
 * Used by: src/core/stt/audio.worker.ts (stamps each chunk); src/core/stt/cloudStt.ts (Deepgram's stream
 *          times → Unix ms; the on-device fallback is pinned to the same offset)
 * Depends on: nothing (pure)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C1, E3 rule 1; ADR-0076
 */

/** Length of one bucket of the sliding minimum, ms. */
export const CLOCK_BUCKET_MS = 5_000;

/** Buckets kept: the minimum is over the last 4 × 5 s = 20 s. */
export const CLOCK_BUCKETS = 4;

/** The audio clock → Unix ms mapping of one call. */
export class CaptureClock {
  /** The smallest offset of each recent bucket, newest last: [bucket number, offset ms]. */
  private readonly buckets: [number, number][] = [];

  /**
   * Notes a chunk's arrival.
   *
   * @param endTime   The chunk's last sample on the audio clock, seconds.
   * @param arrivedAt When it arrived, Unix ms (timeOrigin + performance.now()).
   * Called from: audio.worker.ts (every chunk of either channel)
   */
  observe(endTime: number, arrivedAt: number): void {
    const offset = arrivedAt - endTime * 1000;
    const bucket = Math.floor(arrivedAt / CLOCK_BUCKET_MS);
    const last = this.buckets.at(-1);
    if (last && last[0] === bucket) {
      last[1] = Math.min(last[1], offset);
    } else {
      this.buckets.push([bucket, offset]);
      while (this.buckets.length > CLOCK_BUCKETS) this.buckets.shift();
    }
  }

  /**
   * The current offset: Unix ms minus audio-clock ms.
   *
   * @returns The offset, or null before any chunk arrived.
   * Called from: audio.worker.ts; toUnix(); tests
   */
  offsetMs(): number | null {
    if (this.buckets.length === 0) return null;
    return Math.min(...this.buckets.map(([, offset]) => offset));
  }

  /**
   * An audio-clock time as Unix ms.
   *
   * @param seconds Audio clock, seconds.
   * @returns Unix ms (rounded), or NaN before any chunk arrived.
   * Called from: tests (cloudStt.ts uses the offset each chunk carries)
   */
  toUnix(seconds: number): number {
    const offset = this.offsetMs();
    return offset === null ? Number.NaN : Math.round(seconds * 1000 + offset);
  }
}
