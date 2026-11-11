/**
 * File: apps/web/src/core/transcript/refineQueue.ts
 * Purpose: Decides which finished lines the desktop's Accurate engine rewrites during a call (1.5.1,
 *          ADR-0069). Before 1.5.1 every "Them" line went to the engine's queue, which grew without bound
 *          when the computer was busy (measured 11 Nov 2026: rewrites 11–22 s late at p95) and took CPU
 *          from the live engine. Now: one rewrite runs and at most one waits (a newer line replaces the
 *          waiting one, which keeps its live words); a line whose rewrite would start more than
 *          MAX_REFINE_AGE_MS after it became final is skipped; and nothing starts while the live engine
 *          is behind (canRun false). A skipped line keeps the live engine's words (and gets punctuation).
 *          1.5.2 (ADR-0070): the user's own lines are rewritten during the call too, but only when the engine
 *          has nothing else to do (offerIdle): on the real call of 11 Nov 2026 the live words of the user's
 *          lines were 56% wrong and the accurate engine's 33%. Under load they wait for the pass after the
 *          call, as before.
 * Used by: src/features/live/LivePage.tsx (onFinal)
 * Depends on: nothing (the caller passes the work and the clock)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1; ADR-0034, ADR-0066, ADR-0069
 */

/** A line waiting for its rewrite. */
export interface RefineJob {
  /** The final line's id. */
  lineId: string;
  /** When the line became final (the queue's clock, ms). */
  finalAt: number;
}

/** Why a line was not rewritten. */
export type RefineSkip = 'busy' | 'replaced' | 'stale';

/** The oldest a line may be (ms after it became final) when its rewrite starts. */
export const MAX_REFINE_AGE_MS = 3_000;

/** What createRefineQueue() needs. */
export interface RefineQueueOptions<J extends RefineJob> {
  /** Rewrites one line; resolves when the engine has answered (or failed). */
  run: (job: J) => Promise<void>;
  /** A line that will not be rewritten (it keeps the live words). */
  onSkip: (job: J, why: RefineSkip) => void;
  /** Whether a rewrite may start now (false while the live engine is behind). */
  canRun: () => boolean;
  /** The clock, ms (default Date.now). */
  now?: () => number;
  /** The oldest a line may be when its rewrite starts, ms (default MAX_REFINE_AGE_MS). */
  maxAgeMs?: number;
}

/** What createRefineQueue() returns. */
export interface RefineQueue<J extends RefineJob> {
  /**
   * Offers a line for a rewrite.
   *
   * @param job The line.
   */
  push: (job: J) => void;
  /**
   * 1.5.2: starts a low-priority rewrite (a "You" line) only when nothing runs or waits and the live engine
   * keeps up; otherwise does nothing (the line keeps its live words until the pass after the call).
   *
   * @param job The line.
   * @returns True when its rewrite started.
   */
  offerIdle: (job: J) => boolean;
  /** Skips the waiting line (End). */
  clear: () => void;
  /** Whether a rewrite is running. */
  busy: () => boolean;
}

/**
 * Creates the queue.
 *
 * @param options See RefineQueueOptions.
 * @returns The queue.
 * Called from: LivePage.tsx; tests
 */
export function createRefineQueue<J extends RefineJob>(
  options: RefineQueueOptions<J>,
): RefineQueue<J> {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? MAX_REFINE_AGE_MS;
  let running = false;
  let waiting: J | null = null;

  /**
   * Starts a line's rewrite, or skips it when it is too old or the engine may not run now.
   *
   * @param job The line.
   */
  const start = (job: J) => {
    if (!options.canRun()) {
      options.onSkip(job, 'busy');
      return;
    }
    if (now() - job.finalAt > maxAgeMs) {
      options.onSkip(job, 'stale');
      return;
    }
    running = true;
    void options
      .run(job)
      .catch(() => undefined)
      .finally(() => {
        running = false;
        const next = waiting;
        waiting = null;
        if (next) start(next);
      });
  };

  return {
    push(job) {
      if (!running) {
        start(job);
        return;
      }
      if (waiting) options.onSkip(waiting, 'replaced');
      waiting = job;
    },
    offerIdle(job) {
      if (running || waiting || !options.canRun() || now() - job.finalAt > maxAgeMs) return false;
      start(job);
      return true;
    },
    clear() {
      if (waiting) options.onSkip(waiting, 'replaced');
      waiting = null;
    },
    busy: () => running,
  };
}
