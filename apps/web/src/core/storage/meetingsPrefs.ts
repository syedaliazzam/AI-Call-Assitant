/**
 * File: apps/web/src/core/storage/meetingsPrefs.ts
 * Purpose: The Meetings library's remembered call (ADR-0096): the call opened last, so the page opens on it
 *          again. Kept in this browser's localStorage under the signed-in account only: the key is in
 *          accountScope.ts ACCOUNT_TIED_KEYS, so another account signing in on this browser removes it.
 * Used by: src/features/meetings/MeetingsPage.tsx; src/core/storage/accountScope.ts (the key)
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0096-meetings-library.md
 *
 * Holds a call id only; never call content.
 */

/** localStorage key: the id of the call opened last in Meetings. */
export const MEETINGS_LAST_CALL_KEY = 'kite.meetings.lastCall';

/** The longest id kept (call ids are UUIDs or "legacy-…" ids, far shorter). */
const MAX_ID_CHARS = 200;

/**
 * The call opened last.
 *
 * @returns Its id, or null when none was opened (or storage is unavailable, a private window).
 * Called from: MeetingsPage.tsx; tests
 */
export function getLastMeetingCall(): string | null {
  try {
    const value = localStorage.getItem(MEETINGS_LAST_CALL_KEY);
    return value && value.length <= MAX_ID_CHARS ? value : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the call opened last.
 *
 * @param callId The call's id.
 * Called from: MeetingsPage.tsx; tests
 */
export function setLastMeetingCall(callId: string): void {
  if (!callId || callId.length > MAX_ID_CHARS) return;
  try {
    localStorage.setItem(MEETINGS_LAST_CALL_KEY, callId);
  } catch {
    // Not kept: the page opens on the newest call next time.
  }
}
