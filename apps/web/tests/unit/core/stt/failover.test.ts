/**
 * Tests for apps/web/src/core/stt/failover.ts (ADR-0076, investigation C9): when a channel moves from
 * Deepgram to the on-device engine (a stall: no message for 3 s while it has speech) and back (a new socket
 * healthy for 30 s, at a pause), and the background retry delays (1, 2, 5, 10, 30 s).
 */
import { describe, expect, it } from 'vitest';
import { ChannelFailover, HEALTHY_MS, RETRY_DELAYS_MS, STALL_MS } from '@/core/stt/failover';

describe('ChannelFailover', () => {
  it('calls a socket stalled only after 3 s of speech with no message', () => {
    const failover = new ChannelFailover();
    failover.opened(0);
    // Silence: no messages is fine.
    expect(failover.stalled(60_000)).toBe(false);
    failover.sound(60_000);
    expect(failover.stalled(60_000 + STALL_MS - 1)).toBe(false);
    expect(failover.stalled(60_000 + STALL_MS)).toBe(true);
  });

  it('a message resets the stall clock', () => {
    const failover = new ChannelFailover();
    failover.opened(0);
    failover.sound(1_000);
    failover.message(2_500);
    expect(failover.stalled(5_000)).toBe(false);
    failover.sound(5_000);
    expect(failover.stalled(8_000)).toBe(true);
  });

  it('retries after 1, 2, 5, 10 and then every 30 s', () => {
    const failover = new ChannelFailover();
    let now = 0;
    failover.failed(now);
    expect(failover.engine).toBe('local');
    const waits: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let due = now;
      while (!failover.retryDue(due)) due += 500;
      waits.push(due - now);
      now = due;
      // The probe fails again.
      failover.failed(now);
    }
    expect(waits).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 30_000]);
    expect(RETRY_DELAYS_MS.at(-1)).toBe(30_000);
  });

  it('switches back only after 30 s healthy and at a pause', () => {
    const failover = new ChannelFailover();
    failover.failed(0);
    expect(failover.retryDue(1_000)).toBe(true);
    failover.opened(1_500);
    expect(failover.canReturn(1_500 + HEALTHY_MS - 1, true)).toBe(false);
    // Healthy long enough, but mid-line: wait.
    expect(failover.canReturn(1_500 + HEALTHY_MS, false)).toBe(false);
    expect(failover.canReturn(1_500 + HEALTHY_MS, true)).toBe(true);
    failover.returned(40_000);
    expect(failover.engine).toBe('deepgram');
    // Never stalled straight after the switch back.
    expect(failover.stalled(40_001)).toBe(false);
  });

  it('is never stalled or retrying in the wrong state', () => {
    const failover = new ChannelFailover();
    expect(failover.retryDue(10_000)).toBe(false);
    failover.failed(0);
    failover.sound(0);
    expect(failover.stalled(10_000)).toBe(false);
  });
});
