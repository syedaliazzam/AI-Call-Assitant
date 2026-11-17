/**
 * Tests for apps/web/src/core/live/liveSessions.ts (ADR-0098): the store asks the server when the first card
 * listens, names the device and the account, keeps only sessions live on another device ("here" ones are
 * this device's own call), polls only while the page is visible and focused, asks at once on wake, keeps
 * what it knew when an ask fails, tells listeners only on a change, and stops asking with the last listener.
 */
import { ACCOUNT_HEADER, DEVICE_HEADER } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { POLL_MS, createLiveSessionsStore, type LiveSessionsDeps } from '@/core/live/liveSessions';

/**
 * Fake dependencies.
 *
 * @param replies What the server answers, in order ('offline' throws); the last one repeats.
 * @returns The dependencies, the request headers seen, and controls for the timer, wake and focus.
 */
function fakes(replies: (Response | 'offline')[]) {
  const headers: Record<string, string>[] = [];
  let tick: (() => void) | null = null;
  let wake: (() => void) | null = null;
  const state = { looking: true, stopped: false };
  const deps: LiveSessionsDeps = {
    fetch: async (_input, init = {}) => {
      headers.push(init.headers as Record<string, string>);
      const next = replies.length > 1 ? replies.shift()! : replies[0]!;
      if (next === 'offline') throw new TypeError('Failed to fetch');
      return next.clone();
    },
    deviceId: () => 'device-1',
    accountId: () => 'account-1',
    looking: () => state.looking,
    onWake: (run) => {
      wake = run;
      return () => {
        wake = null;
      };
    },
    setInterval: (run, ms) => {
      expect(ms).toBe(POLL_MS);
      tick = run;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      state.stopped = true;
    },
  };
  /**
   * Lets the pending ask finish.
   * @returns A promise settled after the current tasks.
   */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    deps,
    headers,
    state,
    settle,
    tick: async () => {
      tick?.();
      await settle();
    },
    wake: async () => {
      wake?.();
      await settle();
    },
  };
}

/**
 * A server reply.
 * @param live The entries.
 * @returns The response.
 */
function reply(live: { sessionId: string; here: boolean }[]): Response {
  return Response.json({ live });
}

describe('createLiveSessionsStore', () => {
  it('asks on the first listener, with the device and the account, and keeps only other devices', async () => {
    const f = fakes([
      reply([
        { sessionId: 's1', here: false },
        { sessionId: 's2', here: true },
      ]),
    ]);
    const store = createLiveSessionsStore(f.deps);
    const listener = vi.fn();
    store.subscribe(listener);
    await f.settle();
    expect([...store.snapshot()]).toEqual(['s1']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(f.headers[0]?.[DEVICE_HEADER]).toBe('device-1');
    expect(f.headers[0]?.[ACCOUNT_HEADER]).toBe('account-1');
  });

  it('polls only while the page is visible and focused, and asks at once on wake', async () => {
    const f = fakes([reply([])]);
    const store = createLiveSessionsStore(f.deps);
    store.subscribe(() => undefined);
    await f.settle();
    await f.tick();
    expect(f.headers).toHaveLength(2);
    f.state.looking = false;
    await f.tick();
    expect(f.headers).toHaveLength(2);
    await f.wake();
    expect(f.headers).toHaveLength(3);
  });

  it('keeps what it knew when an ask fails, and tells listeners only on a change', async () => {
    const f = fakes([
      reply([{ sessionId: 's1', here: false }]),
      'offline',
      Response.json({}, { status: 500 }),
      reply([{ sessionId: 's1', here: false }]),
      reply([]),
    ]);
    const store = createLiveSessionsStore(f.deps);
    const listener = vi.fn();
    store.subscribe(listener);
    await f.settle();
    const first = store.snapshot();
    await f.tick();
    await f.tick();
    await f.tick();
    expect(store.snapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    await f.tick();
    expect(store.snapshot().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops asking when the last listener goes', async () => {
    const f = fakes([reply([])]);
    const store = createLiveSessionsStore(f.deps);
    const stopOne = store.subscribe(() => undefined);
    const stopTwo = store.subscribe(() => undefined);
    await f.settle();
    stopOne();
    expect(f.state.stopped).toBe(false);
    stopTwo();
    expect(f.state.stopped).toBe(true);
  });
});
