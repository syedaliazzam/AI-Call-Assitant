/**
 * Tests for apps/web/src/core/storage/accountScope.ts (privacy fix of 14 Nov 2026): the page's account;
 * when a different account (or an unknown one) signs in on this browser profile, the previous account's
 * account-tied keys are removed (synced preferences, Drive saves, Ask chat targets, the desktop windows'
 * short-lived call-start and recording-consent notes, the Drive reconnect notice, the old one-time upload
 * "Not now" flag) while device settings stay; the synced preferences are
 * marked for re-reading; a second account on the same page is reported as a switch (reload) and stays
 * one; another window's sign-in as someone else is noticed; the key list matches the modules that own
 * the keys. Invented ids only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_ENABLED_KEY } from '@/core/drive/queue';
import { CALL_START_KEY } from '@/core/live/callStart';
import {
  ACCOUNT_TIED_KEYS,
  ACCOUNT_TIED_SESSION_KEYS,
  LAST_ACCOUNT_KEY,
  PREFS_RESET_KEY,
  accountPrefsWereReset,
  clearAccountPrefsReset,
  currentAccountId,
  enterAccount,
  forgetPageAccount,
  watchOtherAccountSignIn,
} from '@/core/storage/accountScope';
import { CHAT_TARGET_KEY_PREFIX, CODING_LANGUAGE_KEY } from '@/core/storage/answerPrefs';
import { AUTO_ANSWER_KEY } from '@/core/storage/autoAnswer';
import { COMPANY_SUGGESTIONS_KEY } from '@/core/storage/companyPrefs';
import { RECONNECT_CLOSED_KEY } from '@/core/storage/driveNoticePrefs';

/**
 * A Storage stand-in backed by a Map (key() and length too, for the prefix walk).
 *
 * @returns The storage and its map.
 */
function fakeStorage(): { storage: Storage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  } as Storage;
  return { storage, map };
}

let local: Map<string, string>;
let session: Map<string, string>;

/** Fills the stores as account A left them, with device settings beside. */
function accountALeftThings(): void {
  local.set(COMPANY_SUGGESTIONS_KEY, 'off');
  local.set(AUTO_ANSWER_KEY, 'on');
  local.set(CODING_LANGUAGE_KEY, 'rust');
  local.set(DRIVE_ENABLED_KEY, '1');
  local.set(`${CHAT_TARGET_KEY_PREFIX}session-a1`, 'them');
  local.set(`${CHAT_TARGET_KEY_PREFIX}session-a2`, 'you');
  // Device settings: about the computer, not the account.
  local.set('kite.theme', 'dark');
  local.set('kite.uiZoom', '1.1');
  local.set('kite.overlayOpacity', '0.8');
  local.set('kite.micDevice', 'device-1');
  local.set('kite.deviceId', 'device-id-1');
  session.set(RECONNECT_CLOSED_KEY, '1');
  session.set('kite.legacyUpload.later', '1');
}

beforeEach(() => {
  const l = fakeStorage();
  const s = fakeStorage();
  local = l.map;
  session = s.map;
  vi.stubGlobal('localStorage', l.storage);
  vi.stubGlobal('sessionStorage', s.storage);
  // A browser page (enterAccount does nothing on the server).
  vi.stubGlobal('window', {});
  forgetPageAccount();
});

afterEach(() => {
  forgetPageAccount();
});

describe('enterAccount', () => {
  it("removes the previous account's keys when another account signs in, keeping device settings", () => {
    local.set(LAST_ACCOUNT_KEY, 'account-a');
    accountALeftThings();
    expect(enterAccount('account-b')).toBe('first');
    expect(currentAccountId()).toBe('account-b');
    for (const key of [
      COMPANY_SUGGESTIONS_KEY,
      AUTO_ANSWER_KEY,
      CODING_LANGUAGE_KEY,
      DRIVE_ENABLED_KEY,
      `${CHAT_TARGET_KEY_PREFIX}session-a1`,
      `${CHAT_TARGET_KEY_PREFIX}session-a2`,
    ]) {
      expect(local.has(key)).toBe(false);
    }
    expect(session.size).toBe(0);
    expect(local.get('kite.theme')).toBe('dark');
    expect(local.get('kite.uiZoom')).toBe('1.1');
    expect(local.get('kite.overlayOpacity')).toBe('0.8');
    expect(local.get('kite.micDevice')).toBe('device-1');
    expect(local.get('kite.deviceId')).toBe('device-id-1');
    expect(local.get(LAST_ACCOUNT_KEY)).toBe('account-b');
    expect(accountPrefsWereReset()).toBe(true);
  });

  it('treats an unknown last account (first run on a device) as someone else', () => {
    accountALeftThings();
    enterAccount('account-b');
    expect(local.has(AUTO_ANSWER_KEY)).toBe(false);
    expect(local.get(LAST_ACCOUNT_KEY)).toBe('account-b');
  });

  it('keeps everything when the same account signs in again', () => {
    local.set(LAST_ACCOUNT_KEY, 'account-a');
    accountALeftThings();
    expect(enterAccount('account-a')).toBe('first');
    expect(local.get(AUTO_ANSWER_KEY)).toBe('on');
    expect(local.get(`${CHAT_TARGET_KEY_PREFIX}session-a1`)).toBe('them');
    expect(session.get(RECONNECT_CLOSED_KEY)).toBe('1');
    expect(accountPrefsWereReset()).toBe(false);
    expect(enterAccount('account-a')).toBe('same');
  });

  it('reports a second account on the same page as a switch, and keeps saying so until the reload', () => {
    expect(enterAccount('account-a')).toBe('first');
    accountALeftThings();
    expect(enterAccount('account-b')).toBe('switched');
    // The previous account's keys are gone already; the page still names the previous account.
    expect(local.has(DRIVE_ENABLED_KEY)).toBe(false);
    expect(currentAccountId()).toBe('account-a');
    expect(enterAccount('account-b')).toBe('switched');
    expect(enterAccount('account-a')).toBe('switched');
  });

  it('does nothing on the server', () => {
    vi.stubGlobal('window', undefined);
    local.set(LAST_ACCOUNT_KEY, 'account-a');
    accountALeftThings();
    expect(enterAccount('account-b')).toBe('first');
    expect(currentAccountId()).toBeNull();
    expect(local.get(AUTO_ANSWER_KEY)).toBe('on');
  });

  it('works with storage blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(enterAccount('account-a')).toBe('first');
    expect(currentAccountId()).toBe('account-a');
  });
});

describe('preferences re-read marker', () => {
  it('is cleared once the preferences were read again', () => {
    local.set(PREFS_RESET_KEY, '1');
    expect(accountPrefsWereReset()).toBe(true);
    clearAccountPrefsReset();
    expect(accountPrefsWereReset()).toBe(false);
  });
});

describe('watchOtherAccountSignIn', () => {
  /**
   * A window stand-in that keeps its 'storage' listener.
   *
   * @returns The target and a way to send a storage event.
   */
  function fakeTarget() {
    let listener: ((event: Event) => void) | null = null;
    const target = {
      addEventListener: (_type: string, handler: (event: Event) => void) => {
        listener = handler;
      },
      removeEventListener: () => {
        listener = null;
      },
    } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    const send = (key: string | null, newValue: string | null) =>
      listener?.({ key, newValue } as unknown as Event);
    return { target, send };
  }

  it("reloads when another window signs in as someone else, not for this account's own windows", () => {
    enterAccount('account-a');
    const { target, send } = fakeTarget();
    const reload = vi.fn();
    const stop = watchOtherAccountSignIn(reload, target);
    send(LAST_ACCOUNT_KEY, 'account-a');
    send('kite.theme', 'light');
    send(null, null);
    expect(reload).not.toHaveBeenCalled();
    send(LAST_ACCOUNT_KEY, 'account-b');
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
    send(LAST_ACCOUNT_KEY, 'account-c');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('the key lists', () => {
  it('name the keys the owning modules use', () => {
    expect(ACCOUNT_TIED_KEYS).toEqual([
      COMPANY_SUGGESTIONS_KEY,
      AUTO_ANSWER_KEY,
      CODING_LANGUAGE_KEY,
      DRIVE_ENABLED_KEY,
      CALL_START_KEY,
      // core/recording/handoff.ts RECORD_CONSENT_KEY.
      'kite-record-consent',
    ]);
    expect(ACCOUNT_TIED_SESSION_KEYS).toContain(RECONNECT_CLOSED_KEY);
  });
});
