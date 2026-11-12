/**
 * File: apps/web/src/core/storage/driveNoticePrefs.ts
 * Purpose: Remembers that the person closed the "Google Drive needs to be reconnected" notice (1.6.1,
 *          ADR-0072), so it stays closed for the rest of this app run: each session card's own
 *          "Reconnect Google Drive · Settings" line is enough after that. Kept in sessionStorage, which
 *          lives as long as the window: the desktop panel keeps one window for the whole app run (its
 *          close button hides it or quits), and the page reloads a session link causes keep it too; a
 *          browser tab forgets it when closed. With storage blocked, the notice shows again on the next
 *          page load, which is the safe way to fail for something the person should act on.
 * Used by: src/features/drive/DriveNotices.tsx
 * Depends on: sessionStorage
 * Architecture: ADR-0072
 */

/** The sessionStorage key of the closed reconnect notice. */
const RECONNECT_CLOSED_KEY = 'kite.drive.reconnectNoticeClosed';

/**
 * Whether the reconnect notice was closed in this window's run.
 *
 * @returns True once closed; false when not, or when storage is blocked.
 * Called from: DriveNotices.tsx; tests
 */
export function reconnectNoticeClosed(): boolean {
  try {
    return sessionStorage.getItem(RECONNECT_CLOSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Remembers that the reconnect notice was closed, for the rest of this window's run.
 *
 * @returns Nothing.
 * Called from: DriveNotices.tsx (Close); tests
 */
export function closeReconnectNotice(): void {
  try {
    sessionStorage.setItem(RECONNECT_CLOSED_KEY, '1');
  } catch {
    // Storage blocked: it stays closed until the page loads again.
  }
}
