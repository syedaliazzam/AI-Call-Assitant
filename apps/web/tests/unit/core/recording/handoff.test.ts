/**
 * Tests for apps/web/src/core/recording/handoff.ts (desktop 1.5.0, ADR-0068; ADR-0082): the Connect card's
 * consent note is taken once, only by its session, only while fresh and well formed; unticked clears it; an
 * old 'record from the start' note is ignored; blocked storage
 * throws nothing; "recording saved" reaches a listener on the channel and stops after unsubscribing.
 */
import { describe, expect, it } from 'vitest';
import {
  announceRecordingSaved,
  leaveRecordConsent,
  RECORD_CONSENT_KEY,
  RECORD_CONSENT_TTL_MS,
  takeRecordConsent,
  watchRecordingSaved,
  type HandoffDeps,
} from '@/core/recording/handoff';

/**
 * In-memory storage and a shared channel, with a clock.
 * @param now The clock.
 * @returns The dependencies.
 */
function fakes(now: { value: number }): HandoffDeps {
  const values = new Map<string, string>();
  const listeners = new Set<(event: Event) => void>();
  return {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
    },
    openChannel: () =>
      ({
        postMessage: (data: unknown) => {
          for (const listener of listeners) listener({ data } as MessageEvent);
        },
        close: () => undefined,
        addEventListener: (_type: string, listener: (event: Event) => void) =>
          void listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: Event) => void) =>
          void listeners.delete(listener),
      }) as unknown as BroadcastChannel,
    now: () => now.value,
  };
}

/** Storage that throws on every call (a privacy setting). */
const BLOCKED: NonNullable<HandoffDeps['storage']> = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('record consent note (ADR-0082)', () => {
  it('is taken once, by its own session, and says yes only when ticked', () => {
    const deps = fakes({ value: 1_000 });
    leaveRecordConsent('s1', true, deps);
    expect(takeRecordConsent('other', deps)).toBe(false);
    expect(takeRecordConsent('s1', deps)).toBe(true);
    expect(takeRecordConsent('s1', deps)).toBe(false);
  });

  it('is ignored once stale, and cleared when unticked', () => {
    const now = { value: 1_000 };
    const deps = fakes(now);
    leaveRecordConsent('s1', true, deps);
    now.value += RECORD_CONSENT_TTL_MS + 1;
    expect(takeRecordConsent('s1', deps)).toBe(false);
    leaveRecordConsent('s1', true, deps);
    leaveRecordConsent('s1', false, deps);
    expect(takeRecordConsent('s1', deps)).toBe(false);
  });

  it('ignores a 1.6.3 "record from the start" note and a malformed note, and survives blocked storage', () => {
    const deps = fakes({ value: 1_000 });
    // 1.5.0 to 1.6.3 left this; a call must never start recording by itself now.
    deps.storage!.setItem(
      'kite-record-start',
      JSON.stringify({ sessionId: 's1', kind: 'screen', displayId: null, at: 1_000 }),
    );
    expect(takeRecordConsent('s1', deps)).toBe(false);
    deps.storage!.setItem(RECORD_CONSENT_KEY, '{not json');
    expect(takeRecordConsent('s1', deps)).toBe(false);
    const blocked: HandoffDeps = { ...deps, storage: BLOCKED };
    expect(() => leaveRecordConsent('s1', true, blocked)).not.toThrow();
    expect(takeRecordConsent('s1', blocked)).toBe(false);
  });
});

describe('recording saved', () => {
  it('reaches a listener until it stops', () => {
    const deps = fakes({ value: 0 });
    let count = 0;
    const stop = watchRecordingSaved(() => (count += 1), deps);
    announceRecordingSaved(deps);
    stop();
    announceRecordingSaved(deps);
    expect(count).toBe(1);
  });
});
