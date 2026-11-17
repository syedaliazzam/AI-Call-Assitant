/**
 * File: apps/web/src/core/storage/accountScope.ts
 * Purpose: Knows which account is signed in on this page, so values kept in this browser profile's
 *          localStorage and sessionStorage never show one account's things to another account on a
 *          shared computer (privacy fix of 14 Nov 2026). It:
 *          - remembers the page's account (set by SyncScope while rendering, before any child);
 *          - remembers the last account signed in on this browser profile ('kite.lastAccount', an id
 *            only) and, when a different account signs in, removes the previous account's
 *            account-tied keys (ACCOUNT_TIED_KEYS, ACCOUNT_TIED_PREFIXES, ACCOUNT_TIED_SESSION_KEYS);
 *          - tells SyncScope when the page itself switched accounts without a reload (sign-out then
 *            sign-in is a client-side navigation), so the page reloads and no in-memory state of the
 *            previous account survives;
 *          - reports when another window of this profile signed in as a different account, so this
 *            window reloads too.
 *          Device settings (theme, zoom, overlay position and opacity, microphone, device id) are
 *          about the computer, not the account, and stay as they are.
 * Used by: src/features/sync/SyncScope.tsx; src/core/live/callTimings.ts (per-account timing log);
 *          src/core/sync/engine.ts (the account header); src/core/sync/client.ts (preferences
 *          re-read, the account's local database); src/core/drive/api.ts (the account header)
 * Depends on: localStorage and sessionStorage (missing or blocked: nothing is remembered or removed);
 *             src/core/storage/{answerPrefs,autoAnswer,companyPrefs,driveNoticePrefs,meetingsPrefs}.ts,
 *             src/core/live/callStart.ts (key names)
 * Architecture: ADR-0049 (account sync); docs/architecture/kite-architecture-v3.1.md §2 (privacy)
 *
 * Account ids are kept on the device only (localStorage) and are never logged.
 */
import { CALL_START_KEY } from '../live/callStart';
import { RECORD_CONSENT_KEY } from '../recording/handoff';
import { CHAT_TARGET_KEY_PREFIX, CODING_LANGUAGE_KEY } from './answerPrefs';
import { AUTO_ANSWER_KEY } from './autoAnswer';
import { COMPANY_SUGGESTIONS_KEY } from './companyPrefs';
import { RECONNECT_CLOSED_KEY } from './driveNoticePrefs';
import { MEETINGS_LAST_CALL_KEY } from './meetingsPrefs';

/** localStorage key: the id of the last account signed in on this browser profile. */
export const LAST_ACCOUNT_KEY = 'kite.lastAccount';

/**
 * localStorage key set when the synced account preferences were removed on an account switch; the
 * next account sync that starts reads the account's own values again (core/sync/client.ts), then
 * removes it.
 */
export const PREFS_RESET_KEY = 'kite.accountPrefsReset';

/**
 * localStorage keys that belong to the signed-in account and are removed when another account signs
 * in on this browser profile:
 * - the synced account preferences (core/sync/prefs.ts): they live in the account and are read again
 *   from it when its sync starts (PREFS_RESET_KEY);
 * - 'kite.drive.saves' (core/drive/queue.ts DRIVE_ENABLED_KEY): whether that account saves calls to
 *   Google Drive. Written here as text because queue.ts pulls in the Drive client; a unit test checks
 *   the two stay equal;
 * - the short-lived notes between the desktop app's windows: a call start (core/live/callStart.ts) and
 *   recording consent ('kite-record-consent', core/recording/handoff.ts RECORD_CONSENT_KEY, written as
 *   text here; removing a key that is not there does nothing). They name one of that account's sessions.
 * - ADR-0096: the Meetings library's last opened call (core/storage/meetingsPrefs.ts), one of that
 *   account's calls.
 */
export const ACCOUNT_TIED_KEYS: readonly string[] = [
  COMPANY_SUGGESTIONS_KEY,
  AUTO_ANSWER_KEY,
  CODING_LANGUAGE_KEY,
  'kite.drive.saves',
  CALL_START_KEY,
  RECORD_CONSENT_KEY,
  MEETINGS_LAST_CALL_KEY,
];

/**
 * localStorage key prefixes that belong to the signed-in account: each session's Ask chat target
 * ('kite.chatTarget.<sessionId>', core/storage/answerPrefs.ts).
 */
export const ACCOUNT_TIED_PREFIXES: readonly string[] = [CHAT_TARGET_KEY_PREFIX];

/**
 * sessionStorage keys that belong to the signed-in account: the closed Drive reconnect notice
 * (core/storage/driveNoticePrefs.ts) and the old one-time upload "Not now" flag (before 14 Nov 2026 it
 * was not per account).
 */
export const ACCOUNT_TIED_SESSION_KEYS: readonly string[] = [
  RECONNECT_CLOSED_KEY,
  'kite.legacyUpload.later',
];

/** The account signed in on this page (set by SyncScope), or null before that. */
let pageAccount: string | null = null;

/**
 * True once this page has shown a second, different account without a reload. Stays true: the page
 * must reload, and nothing may render for the new account before that.
 */
let switchedOnPage = false;

/** What enterAccount() found. */
export type AccountEntry =
  /** The first account of this page (a fresh load). */
  | 'first'
  /** The same account as before on this page (a re-render or a client-side navigation). */
  | 'same'
  /** A different account than before on this page: the page must reload before showing anything. */
  | 'switched';

/**
 * Runs a storage action, ignoring a missing or blocked storage.
 *
 * @param action The action.
 * @returns Its result, or null when the storage could not be used.
 */
function safely<T>(action: () => T): T | null {
  try {
    return action();
  } catch {
    return null;
  }
}

/**
 * Removes every account-tied key of the previous account from this browser profile. Also marks the
 * synced preferences for re-reading from the new account (PREFS_RESET_KEY).
 *
 * Called from: enterAccount() when the signed-in account differs from the last one
 */
function removeAccountTiedKeys(): void {
  safely(() => {
    for (const key of ACCOUNT_TIED_KEYS) localStorage.removeItem(key);
    // Collect first, then remove: removing while walking the indexes would skip keys.
    const prefixed: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && ACCOUNT_TIED_PREFIXES.some((prefix) => key.startsWith(prefix))) prefixed.push(key);
    }
    for (const key of prefixed) localStorage.removeItem(key);
    localStorage.setItem(PREFS_RESET_KEY, '1');
  });
  safely(() => {
    for (const key of ACCOUNT_TIED_SESSION_KEYS) sessionStorage.removeItem(key);
  });
}

/**
 * Records the signed-in account of this page. Must run before any child of the page reads stored
 * values (SyncScope calls it while rendering). When the last account signed in on this browser profile
 * was a different one, or is unknown (the first time this runs on a device, the keys could belong to
 * anyone), the account-tied keys are removed first.
 *
 * Does nothing on the server (no storage; module state there is shared by all requests).
 *
 * @param accountId The signed-in account's id.
 * @returns 'first', 'same', or 'switched' (this page showed another account before: reload it).
 * Called from: src/features/sync/SyncScope.tsx (while rendering); tests
 */
export function enterAccount(accountId: string): AccountEntry {
  if (typeof window === 'undefined') return 'first';
  if (switchedOnPage) return 'switched';
  const entry: AccountEntry =
    pageAccount === null ? 'first' : pageAccount === accountId ? 'same' : 'switched';
  if (entry === 'same') return entry;
  // A new account for this browser profile: nothing of the previous account may show.
  const last = safely(() => localStorage.getItem(LAST_ACCOUNT_KEY));
  if (last !== accountId) {
    removeAccountTiedKeys();
    safely(() => localStorage.setItem(LAST_ACCOUNT_KEY, accountId));
  }
  if (entry === 'switched') {
    // The page's memory still holds the previous account's data: it must reload. pageAccount keeps the
    // previous account until then, so nothing reads the new account's keys from this page.
    switchedOnPage = true;
    return entry;
  }
  pageAccount = accountId;
  return entry;
}

/**
 * The account signed in on this page.
 *
 * @returns Its id, or null outside a signed-in page (tests, harnesses, the server).
 * Called from: callTimings.ts, engine.ts, client.ts, drive/api.ts
 */
export function currentAccountId(): string | null {
  return pageAccount;
}

/**
 * Whether the synced preferences were removed on an account switch and are still to be read again
 * from the account.
 *
 * @returns True until clearAccountPrefsReset().
 * Called from: src/core/sync/client.ts (start of account sync)
 */
export function accountPrefsWereReset(): boolean {
  return safely(() => localStorage.getItem(PREFS_RESET_KEY)) === '1';
}

/**
 * Marks the synced preferences as read again from the account.
 *
 * Called from: src/core/sync/client.ts (after the preferences were read from the account)
 */
export function clearAccountPrefsReset(): void {
  safely(() => localStorage.removeItem(PREFS_RESET_KEY));
}

/**
 * Listens for another window of this browser profile signing in as a different account (it writes
 * LAST_ACCOUNT_KEY; the browser tells the other windows with a 'storage' event). Such a window still
 * shows the previous account and must reload.
 *
 * @param onOtherAccount Called once another account signed in.
 * @param target         The window (tests pass a stand-in).
 * @returns Stops listening.
 * Called from: src/features/sync/SyncScope.tsx (an effect)
 */
export function watchOtherAccountSignIn(
  onOtherAccount: () => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined = globalThis.window,
): () => void {
  if (!target) return () => undefined;
  const listener = (event: Event) => {
    const { key, newValue } = event as StorageEvent;
    // key null: the whole storage was cleared, which names no account.
    if (key !== LAST_ACCOUNT_KEY || !newValue) return;
    if (pageAccount !== null && newValue !== pageAccount) onOtherAccount();
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}

/**
 * Reloads the page, so it starts again for the account now signed in.
 *
 * Called from: src/features/sync/SyncScope.tsx (after an account switch)
 */
export function reloadForAccountSwitch(): void {
  globalThis.location?.reload();
}

/**
 * Forgets this page's account (tests only: each test starts like a fresh page).
 *
 * Called from: tests
 */
export function forgetPageAccount(): void {
  pageAccount = null;
  switchedOnPage = false;
}
