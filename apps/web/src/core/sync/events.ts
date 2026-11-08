/**
 * File: apps/web/src/core/sync/events.ts
 * Purpose: Tells screens that account sync changed this device's cache (ADR-0049): a pull applied
 *          records, or a push met another device's change or delete. Screens that load their data once
 *          (the dashboard) reload on it; screens built on live queries update by themselves. Without
 *          account sync it never fires.
 * Used by: src/core/sync/engine.ts (fires), src/features/dashboard/Dashboard.tsx (listens)
 * Depends on: nothing
 * Architecture: ADR-0049
 */

/** The listeners. */
const listeners = new Set<() => void>();

/**
 * Listens for changes sync made to the cache.
 *
 * @param listener Called after each pull or push that changed records here.
 * @returns Stops listening.
 * Called from: Dashboard.tsx
 */
export function onSyncApplied(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tells the listeners that sync changed the cache.
 *
 * Called from: engine.ts (pullAll, pushOnce)
 */
export function notifySyncApplied(): void {
  for (const listener of [...listeners]) listener();
}
