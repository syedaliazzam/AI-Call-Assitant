/**
 * File: apps/web/src/core/session/callLength.ts
 * Purpose: A call's length in words for the home panel's session card (v1.1.0, ADR-0041).
 * Used by: src/features/home/HomeCard.tsx
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 */

/**
 * Writes a call's length: "6s", "2m 27s" or "1h 4m".
 *
 * @param ms The length in ms.
 * @returns The length in words, or null when there is none to show.
 * Called from: HomeCard.tsx; tests
 */
export function callLength(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return null;
  const seconds = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
