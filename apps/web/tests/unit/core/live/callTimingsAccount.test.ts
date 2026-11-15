/**
 * Tests apps/web/src/core/live/callTimings.ts, the per-account timing log (privacy fix of 14 Nov 2026):
 * with the default localStorage store, each account's calls are saved under its own key
 * ('kite.callTimings.<id>') and another account signed in later on the same computer sees none of them;
 * the old unscoped log ('kite.callTimings', no owner recorded) is never read and never deleted; outside
 * a signed-in page nothing is read or written. Invented ids only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_TIMINGS_KEY, callTimingsKey, createCallTimings } from '@/core/live/callTimings';
import { enterAccount, forgetPageAccount } from '@/core/storage/accountScope';

const START = {
  sessionId: 's1',
  platform: 'desktop',
  accurate: true,
  recording: 'off',
  documentChars: 0,
};

let local: Map<string, string>;

beforeEach(() => {
  local = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return local.size;
    },
    key: (index: number) => [...local.keys()][index] ?? null,
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
    removeItem: (key: string) => void local.delete(key),
  });
  vi.stubGlobal('sessionStorage', { removeItem: () => undefined });
  vi.stubGlobal('window', {});
  forgetPageAccount();
});

afterEach(() => {
  forgetPageAccount();
});

/**
 * Records and ends one call for the page's account, through the default localStorage store.
 *
 * @param sessionId The call's session.
 */
function oneCall(sessionId: string): void {
  const timings = createCallTimings(undefined, () => 0);
  timings.start({ ...START, sessionId, startedAt: 1_000 });
  timings.end(2_000);
}

describe('the per-account timing log', () => {
  it("keeps each account's calls under its own key; another account sees none of them", () => {
    enterAccount('account-a');
    oneCall('session-of-a');
    expect(local.has(callTimingsKey('account-a'))).toBe(true);
    expect(
      createCallTimings()
        .saved()
        .map((call) => call.sessionId),
    ).toEqual(['session-of-a']);

    // B signs in on the same computer (a new page).
    forgetPageAccount();
    enterAccount('account-b');
    expect(createCallTimings().saved()).toEqual([]);
    oneCall('session-of-b');
    expect(
      createCallTimings()
        .saved()
        .map((call) => call.sessionId),
    ).toEqual(['session-of-b']);
    // A's log is untouched, under A's key.
    expect(local.get(callTimingsKey('account-a'))).toContain('session-of-a');
  });

  it('never reads or deletes the old unscoped log', () => {
    local.set(CALL_TIMINGS_KEY, JSON.stringify([{ sessionId: 'ownerless' }]));
    enterAccount('account-a');
    expect(createCallTimings().saved()).toEqual([]);
    oneCall('session-of-a');
    expect(local.get(CALL_TIMINGS_KEY)).toContain('ownerless');
  });

  it('reads and writes nothing outside a signed-in page', () => {
    oneCall('no-account');
    expect(local.size).toBe(0);
    expect(createCallTimings().saved()).toEqual([]);
  });
});
