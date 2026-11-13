/**
 * Tests apps/web/src/core/answer/keepAlive.ts (Batch C, P1-2): one ping every 25 s (none at once), never
 * two at a time on a slow network, a failed ping is reported with its status only, and nothing after stop.
 */
import { describe, expect, it, vi } from 'vitest';
import { KEEP_ALIVE_MS, startKeepAlive } from '@/core/answer/keepAlive';

/**
 * A timer driven by hand.
 *
 * @returns The timer and a function that fires it once.
 */
function manualEvery() {
  let tick: () => void = () => undefined;
  let interval = 0;
  let cancelled = false;
  return {
    every: (callback: () => void, ms: number) => {
      tick = callback;
      interval = ms;
      return () => {
        cancelled = true;
      };
    },
    fire: () => tick(),
    interval: () => interval,
    cancelled: () => cancelled,
  };
}

describe('startKeepAlive', () => {
  it('pings every 25 s, never at once', async () => {
    const timer = manualEvery();
    const ping = vi.fn(async () => ({ ok: true, status: 204 }));
    startKeepAlive({ ping, every: timer.every });
    expect(timer.interval()).toBe(KEEP_ALIVE_MS);
    expect(ping).not.toHaveBeenCalled();
    timer.fire();
    await Promise.resolve();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('never stacks pings on a slow network', async () => {
    const timer = manualEvery();
    let finish: () => void = () => undefined;
    const ping = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          finish = () => resolve({ ok: true, status: 204 });
        }),
    );
    startKeepAlive({ ping, every: timer.every });
    timer.fire();
    timer.fire();
    expect(ping).toHaveBeenCalledTimes(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    timer.fire();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('reports a failed ping by its status, and stops', async () => {
    const timer = manualEvery();
    const onFailed = vi.fn();
    const stop = startKeepAlive({
      ping: async () => ({ ok: false, status: 401 }),
      every: timer.every,
      onFailed,
    });
    timer.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onFailed).toHaveBeenCalledWith(401);
    stop();
    expect(timer.cancelled()).toBe(true);
  });
});
