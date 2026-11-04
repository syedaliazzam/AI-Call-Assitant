/**
 * File: apps/web/src/features/live/callClock.ts
 * Purpose: A call's running time as the timers show it (shared by the call window's top bar and the
 *          overlay's timer pill).
 * Used by: src/features/live/TopBar.tsx, src/features/live/overlay/ControlBar.tsx
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0040
 */

/**
 * Writes a call time as m:ss, or h:mm:ss from one hour.
 *
 * @param seconds Whole seconds.
 * @returns For example "4:07".
 * Called from: TopBar.tsx, ControlBar.tsx; tests
 */
export function callClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
