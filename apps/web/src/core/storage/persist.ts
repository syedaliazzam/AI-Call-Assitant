/**
 * File: apps/web/src/core/storage/persist.ts
 * Purpose: Asks the browser to keep Kite's local data (navigator.storage.persist()), so
 *          sessions and documents are not cleared when the disk runs short of space, and
 *          reports the result.
 * Used by: the dashboard / Create session (Day 3 Stage 3: asked once, when the first session
 *          is saved)
 * Depends on: the browser's StorageManager (navigator.storage)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.1; day-03-sessions.md Stage 1;
 *               ADR-0024
 *
 * Why this is not in src/platform/: the code is the same in the browser and the desktop app.
 * Electron routes persist() through the shell's permission handler as 'persistent-storage'
 * (Electron session docs, checked 2026-10-28); apps/desktop/src/security.ts grants it for the
 * Kite origin only. Chrome decides by itself (for example from how much the site is used), so
 * in the browser the answer may be false; the data is then kept as long as there is space.
 */

/** The outcome of requestPersistentStorage(). */
export type PersistResult =
  /** Already persistent, or the browser just granted it. */
  | 'persisted'
  /** The browser declined; data stays unless the disk runs short of space. */
  | 'not-persisted'
  /** No StorageManager (very old browser, or not in a browser at all). */
  | 'unsupported';

/** The part of navigator.storage this module uses (injectable for tests). */
export interface StorageManagerLike {
  /** Resolves true when this site's storage is already persistent. */
  persisted(): Promise<boolean>;
  /** Asks for persistent storage; resolves true when granted. */
  persist(): Promise<boolean>;
}

/**
 * Asks for persistent storage, unless it is already granted.
 *
 * @param storage The StorageManager (default: navigator.storage when it exists).
 * @returns 'persisted', 'not-persisted' or 'unsupported'. Never throws: a failing call counts
 *          as 'not-persisted', since Kite works either way.
 * Called from: Create session (Day 3 Stage 3), once the first session is saved; tests
 */
export async function requestPersistentStorage(
  storage: StorageManagerLike | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.storage,
): Promise<PersistResult> {
  if (!storage?.persist || !storage.persisted) return 'unsupported';
  try {
    if (await storage.persisted()) return 'persisted';
    return (await storage.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'not-persisted';
  }
}
