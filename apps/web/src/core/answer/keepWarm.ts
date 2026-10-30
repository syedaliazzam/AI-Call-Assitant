/**
 * File: apps/web/src/core/answer/keepWarm.ts
 * Purpose: The idle re-warm (Day 4 decision): while a call is connected, if no warm-up or answer
 *          has been sent for IDLE_REWARM_MS (4.5 minutes, just under the cache's 5-minute life),
 *          sends one more warm-up that includes the conversation chunks sent so far, so the next
 *          answer after a long quiet stretch still reads the cache. Stopped on End.
 * Used by: src/features/live/LivePage.tsx (started on Connect, stopped on End)
 * Depends on: nothing (the warm-up itself is passed in)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (cache lifetime);
 *               day-04-answers.md Stage 3; ADR-0025
 *
 * Why only when idle: every answer and warm-up already refreshes the cache entry (reading it
 * renews its 5 minutes), so a re-warm during an active call would only cost money. The official
 * prompt-caching guidance says the same: re-warm just under the TTL only when traffic has gaps.
 * Logs only timings (the warm-up logs its own token counts in warm.ts).
 */

/** Idle time after which the cache is re-warmed, in ms (4.5 minutes; the cache lives 5). */
export const IDLE_REWARM_MS = 270_000;

/** How often the idle time is checked, in ms. */
export const IDLE_CHECK_MS = 15_000;

/** Options for startKeepWarm(). */
export interface KeepWarmOptions {
  /**
   * Sends the warm-up (with the conversation chunks sent so far). Must not throw; its result is
   * ignored (warmSession() resolves null on failure).
   */
  warm: () => Promise<unknown>;
  /** Unix ms clock (tests pass a fake one). Default Date.now. */
  now?: () => number;
  /** Repeating timer (tests pass a fake one). Default setInterval/clearInterval. */
  every?: (callback: () => void, ms: number) => () => void;
}

/** A running keep-warm timer. */
export interface KeepWarm {
  /** Records that a warm-up or answer was just sent (resets the idle time). */
  noteActivity(): void;
  /** Stops the timer (End). */
  stop(): void;
}

/**
 * Starts the idle re-warm. The idle time starts now (the caller has just warmed on Connect).
 *
 * @param options The warm-up to send, and test clocks.
 * @returns The timer: noteActivity() on every warm-up or answer, stop() on End.
 * Called from: connect() in LivePage.tsx; tests
 */
export function startKeepWarm(options: KeepWarmOptions): KeepWarm {
  const now = options.now ?? Date.now;
  const every =
    options.every ??
    ((callback: () => void, ms: number) => {
      const timer = setInterval(callback, ms);
      return () => clearInterval(timer);
    });
  let lastActivity = now();
  let stopped = false;
  /** True while a re-warm is in flight, so a slow one is never sent twice. */
  let warming = false;

  const cancel = every(() => {
    const idleMs = now() - lastActivity;
    if (stopped || warming || idleMs < IDLE_REWARM_MS) return;
    warming = true;
    lastActivity = now();
    console.info('keep-warm: re-warming after idle', { idleMs });
    void options.warm().finally(() => {
      warming = false;
    });
  }, IDLE_CHECK_MS);

  return {
    noteActivity: () => {
      lastActivity = now();
    },
    stop: () => {
      stopped = true;
      cancel();
    },
  };
}
