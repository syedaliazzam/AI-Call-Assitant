/**
 * File: apps/web/src/core/live/callLock.ts
 * Purpose: One call at a time on this device (v1.1.0, ADR-0041). Two pages in one call would compete
 *          for the microphone and the shortcuts, and the desktop app's side window can reach a live
 *          page during a call. A Web Lock, because the browser releases it by itself when the page
 *          holding it closes or crashes: it can never be left stuck.
 * Used by: src/features/live/LivePage.tsx; tests
 * Depends on: the browser's Web Locks API (injectable for tests)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 */

/** The lock's name, shared by every Kite page of this browser profile. */
export const CALL_LOCK_NAME = 'kite.live-call';

/** The part of the Web Locks API used here. */
export interface LockApi {
  /**
   * Asks for a lock without waiting.
   *
   * @param name     The lock's name.
   * @param options  ifAvailable: the callback gets null when another page holds it.
   * @param callback Runs with the lock; it is held until the returned promise settles.
   * @returns A promise for the callback's result.
   */
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Takes the call lock.
 *
 * @param locks The Web Locks API (default navigator.locks; absent means no check: a browser without it
 *              behaves as before).
 * @returns A function that releases the lock, or null when another page holds it.
 * Called from: LivePage.tsx (connect); tests
 */
export async function takeCallLock(
  locks: LockApi | undefined = (globalThis.navigator as Navigator | undefined)?.locks as
    LockApi | undefined,
): Promise<(() => void) | null> {
  if (!locks) return () => undefined;
  return new Promise((resolve) => {
    let release = () => undefined as void;
    const held = new Promise<void>((settle) => {
      release = settle;
    });
    locks
      .request(CALL_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        resolve(release);
        // Held until release() is called, or until this page goes away.
        return held;
      })
      .catch(() => resolve(() => undefined));
  });
}
