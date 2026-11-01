/**
 * File: apps/web/src/core/net/online.ts
 * Purpose: Whether this computer is online, from the browser's online/offline events (Day 6
 *          Stage 4e): live answers pause while offline and a banner says so; the transcript keeps
 *          going, because speech-to-text runs on this computer.
 * Used by: src/features/live/useLiveAnswers.ts, src/features/live/LiveAnswers.tsx
 * Depends on: nothing (navigator.onLine, window events)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); day-06 Stage 4
 *
 * navigator.onLine is false only when the computer has no network at all; a network that is up
 * but cannot reach Kite shows up as a failed answer instead ("No connection", unavailable.ts).
 */

/**
 * Whether the browser reports a network connection.
 *
 * @returns True when online (and on the server, where there is no navigator).
 * Called from: useLiveAnswers.ts (before an answer), LiveAnswers.tsx (useSyncExternalStore)
 */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/**
 * Calls back whenever the connection goes or comes back.
 *
 * @param onChange Called after each change.
 * @returns A function that stops listening.
 * Called from: LiveAnswers.tsx (useSyncExternalStore)
 */
export function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
