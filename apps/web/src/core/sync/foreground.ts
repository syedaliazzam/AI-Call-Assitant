/**
 * File: apps/web/src/core/sync/foreground.ts
 * Purpose: Keeps sync out of the way of answers (ADR-0049): while an answer streams, the sync engine
 *          holds its pushes, and sends them once no answer is streaming. Holds are counted, so two
 *          overlapping answers both have to finish. No storage, no network: a counter and listeners.
 * Used by: src/core/answer/answerClient.ts (hold while streaming), src/core/sync/client.ts (waits)
 * Depends on: nothing
 * Architecture: ADR-0049 ("answer speed is unaffected")
 */

/** Answers streaming now. */
let holds = 0;

/** Called when the last hold ends. */
const idleListeners = new Set<() => void>();

/**
 * Holds sync while an answer streams.
 *
 * @returns Releases the hold (safe to call more than once).
 * Called from: streamAnswer() in core/answer/answerClient.ts
 */
export function holdSyncForAnswer(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) for (const listener of [...idleListeners]) listener();
  };
}

/**
 * Whether an answer is streaming now.
 *
 * @returns True while any hold is active.
 * Called from: client.ts; tests
 */
export function answerStreaming(): boolean {
  return holds > 0;
}

/**
 * Calls back once no answer is streaming (at once when none is).
 *
 * @param listener The callback.
 * @returns Cancels the wait.
 * Called from: client.ts
 */
export function whenNoAnswerStreams(listener: () => void): () => void {
  if (holds === 0) {
    listener();
    return () => undefined;
  }
  const once = () => {
    idleListeners.delete(once);
    listener();
  };
  idleListeners.add(once);
  return () => idleListeners.delete(once);
}
