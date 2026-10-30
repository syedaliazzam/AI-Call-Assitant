/**
 * Tests for apps/web/src/core/answer/keepWarm.ts with a fake clock and timer: no re-warm while
 * answers or warm-ups keep arriving; one re-warm after 4.5 idle minutes, which resets the idle
 * time; a slow re-warm is never sent twice; nothing after stop(); the log holds timings only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_CHECK_MS, IDLE_REWARM_MS, startKeepWarm } from '@/core/answer/keepWarm';

/**
 * A fake clock and repeating timer.
 *
 * @returns now(), every(), and advance(ms) which moves the clock and fires due ticks.
 */
function fakeTime() {
  let time = 0;
  let tick: (() => void) | null = null;
  let period = 0;
  let nextAt = 0;
  return {
    now: () => time,
    every: (callback: () => void, ms: number) => {
      tick = callback;
      period = ms;
      nextAt = time + ms;
      return () => {
        tick = null;
      };
    },
    advance(ms: number) {
      const end = time + ms;
      while (tick && nextAt <= end) {
        time = nextAt;
        nextAt += period;
        tick();
      }
      time = end;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startKeepWarm', () => {
  it('re-warms once after 4.5 idle minutes, then waits again', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const clock = fakeTime();
    const warm = vi.fn(async () => null);
    startKeepWarm({ warm, now: clock.now, every: clock.every });
    clock.advance(IDLE_REWARM_MS - IDLE_CHECK_MS);
    expect(warm).not.toHaveBeenCalled();
    clock.advance(IDLE_CHECK_MS);
    expect(warm).toHaveBeenCalledTimes(1);
    clock.advance(IDLE_REWARM_MS - IDLE_CHECK_MS);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(info.mock.calls)).toContain('"idleMs":270000');
  });

  it('never re-warms while answers keep the cache fresh', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const clock = fakeTime();
    const warm = vi.fn(async () => null);
    const keep = startKeepWarm({ warm, now: clock.now, every: clock.every });
    for (let minute = 0; minute < 20; minute += 1) {
      clock.advance(60_000);
      keep.noteActivity();
    }
    expect(warm).not.toHaveBeenCalled();
  });

  it('does not send a second re-warm while one is still in flight', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const clock = fakeTime();
    const warm = vi.fn(() => new Promise<null>(() => undefined));
    startKeepWarm({ warm, now: clock.now, every: clock.every });
    clock.advance(3 * IDLE_REWARM_MS);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('stops on End', () => {
    const clock = fakeTime();
    const warm = vi.fn(async () => null);
    const keep = startKeepWarm({ warm, now: clock.now, every: clock.every });
    keep.stop();
    clock.advance(2 * IDLE_REWARM_MS);
    expect(warm).not.toHaveBeenCalled();
  });
});
