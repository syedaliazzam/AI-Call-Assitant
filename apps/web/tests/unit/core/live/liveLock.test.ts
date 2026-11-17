/**
 * Tests for apps/web/src/core/live/liveLock.ts (ADR-0098): a start is 'held' on 200, 'elsewhere' only on a 409
 * live_elsewhere, and 'unknown' with no answer (the call then starts); each request names the page's account
 * and the device, and a start carries the take-over choice; End releases with keepalive; the heartbeat
 * runs every 15 s, ignores no answer, and on 'moved' stops and reports once; the "Take over" note is taken
 * once, for its own session, within its time; "moved" reaches the other windows.
 */
import {
  ACCOUNT_HEADER,
  LIVE_ELSEWHERE_CODE,
  LIVE_LOCK_HEARTBEAT_MS,
  type LiveLockRequest,
} from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  TAKE_OVER_TTL_MS,
  announceCallMoved,
  endLiveLock,
  keepLiveLock,
  leaveTakeOver,
  startLiveLock,
  takeTakeOver,
  watchCallMoved,
  type LiveLockDeps,
} from '@/core/live/liveLock';

/** A request the fake fetch saw. */
interface Seen {
  /** Its body. */
  body: LiveLockRequest;
  /** Its options. */
  init: RequestInit;
}

/**
 * Fake dependencies: a fetch answering from a list, storage, a channel, a clock and a manual timer.
 *
 * @param replies What the fetch answers, in order (a Response, or 'offline' to throw).
 * @returns The dependencies, what was sent, the clock and a function that runs the timer once.
 */
function fakes(replies: (Response | 'offline')[] = []) {
  const seen: Seen[] = [];
  const store = new Map<string, string>();
  const listeners = new Set<(event: Event) => void>();
  const clock = { now: 5_000_000 };
  let tick: (() => void) | null = null;
  let timerCleared = false;
  const deps: LiveLockDeps = {
    fetch: async (_input, init = {}) => {
      seen.push({ body: JSON.parse(String(init.body)) as LiveLockRequest, init });
      const next = replies.shift() ?? Response.json({ state: 'held' });
      if (next === 'offline') throw new TypeError('Failed to fetch');
      return next;
    },
    deviceId: () => 'device-1',
    accountId: () => 'account-1',
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
    openChannel: () => {
      const own = new Set<(event: Event) => void>();
      return {
        postMessage: (data: unknown) => {
          for (const listener of listeners) listener({ data } as unknown as Event);
        },
        close: () => {
          for (const listener of own) listeners.delete(listener);
        },
        addEventListener: (_type: string, listener: (event: Event) => void) => {
          own.add(listener);
          listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: (event: Event) => void) => {
          own.delete(listener);
          listeners.delete(listener);
        },
      } as unknown as BroadcastChannel;
    },
    now: () => clock.now,
    setInterval: (run, ms) => {
      expect(ms).toBe(LIVE_LOCK_HEARTBEAT_MS);
      tick = run;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      timerCleared = true;
    },
  };
  return {
    deps,
    seen,
    clock,
    /** Runs the heartbeat once and lets it finish. */
    async beat() {
      tick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    cleared: () => timerCleared,
  };
}

describe('startLiveLock', () => {
  it('is held on 200 and sends the call, the device, the take-over and the account', async () => {
    const f = fakes([Response.json({ state: 'held' })]);
    expect(await startLiveLock('s1', 'c1', true, f.deps)).toBe('held');
    expect(f.seen[0]?.body).toEqual({
      action: 'start',
      sessionId: 's1',
      callId: 'c1',
      deviceId: 'device-1',
      takeOver: true,
    });
    expect((f.seen[0]?.init.headers as Record<string, string>)[ACCOUNT_HEADER]).toBe('account-1');
  });

  it('is elsewhere only on a 409 live_elsewhere', async () => {
    const refused = fakes([Response.json({ code: LIVE_ELSEWHERE_CODE }, { status: 409 })]);
    expect(await startLiveLock('s1', 'c1', false, refused.deps)).toBe('elsewhere');
    const otherAccount = fakes([Response.json({ code: 'account_changed' }, { status: 409 })]);
    expect(await startLiveLock('s1', 'c1', false, otherAccount.deps)).toBe('unknown');
  });

  it('is unknown with no answer or a server error (the call still starts)', async () => {
    expect(await startLiveLock('s1', 'c1', false, fakes(['offline']).deps)).toBe('unknown');
    const broken = fakes([Response.json({}, { status: 500 })]);
    expect(await startLiveLock('s1', 'c1', false, broken.deps)).toBe('unknown');
  });
});

describe('endLiveLock', () => {
  it('releases with keepalive, so it finishes when the window closes', async () => {
    const f = fakes();
    endLiveLock('s1', 'c1', f.deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.seen[0]?.body).toEqual({ action: 'end', sessionId: 's1', callId: 'c1' });
    expect(f.seen[0]?.init.keepalive).toBe(true);
  });
});

describe('keepLiveLock', () => {
  it('beats every 15 s, ignores no answer, and on moved stops and reports once', async () => {
    const f = fakes([
      Response.json({ state: 'held' }),
      'offline',
      Response.json({ state: 'moved' }),
    ]);
    const onMoved = vi.fn();
    keepLiveLock('s1', 'c1', onMoved, f.deps);
    await f.beat();
    await f.beat();
    expect(onMoved).not.toHaveBeenCalled();
    await f.beat();
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(f.cleared()).toBe(true);
    expect(f.seen.map((one) => one.body.action)).toEqual(['beat', 'beat', 'beat']);
  });

  it('sends nothing after stop', async () => {
    const f = fakes();
    const keeper = keepLiveLock('s1', 'c1', () => undefined, f.deps);
    keeper.stop();
    await f.beat();
    expect(f.seen).toEqual([]);
  });
});

describe('the take-over note', () => {
  it('is taken once, for its own session, within its time', () => {
    const f = fakes();
    leaveTakeOver('s1', f.deps);
    expect(takeTakeOver('s2', f.deps)).toBe(false);
    expect(takeTakeOver('s1', f.deps)).toBe(true);
    expect(takeTakeOver('s1', f.deps)).toBe(false);
    leaveTakeOver('s1', f.deps);
    f.clock.now += TAKE_OVER_TTL_MS + 1;
    expect(takeTakeOver('s1', f.deps)).toBe(false);
  });
});

describe('moved', () => {
  it('reaches a window that listens, until it stops', () => {
    const f = fakes();
    const onMoved = vi.fn();
    const stop = watchCallMoved(onMoved, f.deps);
    announceCallMoved(f.deps);
    stop();
    announceCallMoved(f.deps);
    expect(onMoved).toHaveBeenCalledTimes(1);
  });
});
