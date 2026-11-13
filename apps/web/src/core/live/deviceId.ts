/**
 * File: apps/web/src/core/live/deviceId.ts
 * Purpose: A random id for this browser profile (the desktop app's windows share one; each browser has
 *          its own), kept in local storage (ADR-0077). A call record carries the id of the device that ran
 *          it, so only that device writes the call's notes and uploads it to Drive (its recordings and its
 *          in-memory lines are there). Not a fingerprint: it is random and says nothing about the machine.
 * Used by: src/features/live/LivePage.tsx, src/core/live/afterCall.ts, src/core/drive/earlierCalls.ts
 * Depends on: the browser's localStorage and crypto
 * Architecture: ADR-0077
 */

/** Where the id is kept. */
export const DEVICE_ID_KEY = 'kite.deviceId';

/** The id when local storage is blocked: the same for this page's life. */
let fallback: string | null = null;

/**
 * This device's id, made on first use.
 *
 * @param storage Where it is kept (tests pass a fake); default the page's localStorage.
 * @returns The id (a UUID).
 * Called from: LivePage.tsx (Connect), afterCall.ts, earlierCalls.ts; tests
 */
export function thisDeviceId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): string {
  try {
    const known = storage?.getItem(DEVICE_ID_KEY);
    if (known) return known;
    const made = crypto.randomUUID();
    storage?.setItem(DEVICE_ID_KEY, made);
    if (storage) return made;
  } catch {
    // Storage blocked: one id for this page's life (its calls still finish while it is open).
  }
  fallback ??= crypto.randomUUID();
  return fallback;
}

/**
 * The page's localStorage, or null where there is none (server rendering) or it is blocked.
 *
 * @returns The storage, or null.
 */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
