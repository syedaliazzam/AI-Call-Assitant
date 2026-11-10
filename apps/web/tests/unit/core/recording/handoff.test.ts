/**
 * Tests for apps/web/src/core/recording/handoff.ts (desktop 1.5.0, ADR-0068): the Connect card's note is
 * taken once, only by its session, only while fresh and well formed; Off clears it; blocked storage
 * throws nothing; "recording saved" reaches a listener on the channel and stops after unsubscribing.
 */
import { describe, expect, it } from 'vitest';
import {
  announceRecordingSaved,
  leaveRecordStart,
  RECORD_START_KEY,
  RECORD_START_TTL_MS,
  takeRecordStart,
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

describe('record start note', () => {
  it('is taken once, by its own session', () => {
    const deps = fakes({ value: 1_000 });
    leaveRecordStart('s1', { kind: 'screen', displayId: '2' }, deps);
    expect(takeRecordStart('other', deps)).toBeNull();
    expect(takeRecordStart('s1', deps)).toEqual({ kind: 'screen', displayId: '2' });
    expect(takeRecordStart('s1', deps)).toBeNull();
  });

  it('is ignored once stale, and cleared by Off', () => {
    const now = { value: 1_000 };
    const deps = fakes(now);
    leaveRecordStart('s1', { kind: 'audio', displayId: null }, deps);
    now.value += RECORD_START_TTL_MS + 1;
    expect(takeRecordStart('s1', deps)).toBeNull();
    leaveRecordStart('s1', { kind: 'audio', displayId: null }, deps);
    leaveRecordStart('s1', null, deps);
    expect(takeRecordStart('s1', deps)).toBeNull();
  });

  it('refuses a malformed note, and survives blocked storage', () => {
    const deps = fakes({ value: 1_000 });
    deps.storage!.setItem(
      RECORD_START_KEY,
      JSON.stringify({ sessionId: 's1', kind: 'video', at: 1_000 }),
    );
    expect(takeRecordStart('s1', deps)).toBeNull();
    const blocked: HandoffDeps = { ...deps, storage: BLOCKED };
    expect(() =>
      leaveRecordStart('s1', { kind: 'screen', displayId: null }, blocked),
    ).not.toThrow();
    expect(takeRecordStart('s1', blocked)).toBeNull();
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
