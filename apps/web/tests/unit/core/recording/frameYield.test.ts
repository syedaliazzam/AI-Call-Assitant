/**
 * Tests apps/web/src/core/recording/frameYield.ts and pressure.ts (Batch C, P1-6): the recording's frame
 * rate drops to 5 under CPU pressure ('serious' or 'critical') or while speech is transcribed on this
 * computer, once (not again on every reading); 'fair' neither lowers it nor counts as calm; it comes back
 * to the quality's own rate after 30 s of calm (nominal or unknown pressure, no local load), and any load in
 * between starts the 30 s again. The pressure watcher passes the states on, and does nothing without the API.
 */
import { describe, expect, it, vi } from 'vitest';
import { FrameRateGovernor, RESTORE_AFTER_MS, YIELD_FPS } from '@/core/recording/frameYield';
import { watchCpuPressure } from '@/core/recording/pressure';

const CALM = { pressure: 'nominal' as const, localLoad: false };

describe('FrameRateGovernor', () => {
  it('yields to 5 fps under serious or critical pressure, once', () => {
    const governor = new FrameRateGovernor(15);
    expect(governor.update(CALM, 0)).toBeNull();
    expect(governor.update({ pressure: 'serious', localLoad: false }, 1_000)).toEqual({
      fps: YIELD_FPS,
      reason: 'pressure',
    });
    expect(governor.update({ pressure: 'critical', localLoad: false }, 2_000)).toBeNull();
    expect(governor.isYielding()).toBe(true);
  });

  it('yields while speech is transcribed on this computer (local fallback, or the engine behind)', () => {
    const governor = new FrameRateGovernor(15);
    expect(governor.update({ pressure: null, localLoad: true }, 0)).toEqual({
      fps: YIELD_FPS,
      reason: 'local',
    });
  });

  it('does not yield at fair pressure', () => {
    const governor = new FrameRateGovernor(15);
    expect(governor.update({ pressure: 'fair', localLoad: false }, 0)).toBeNull();
    expect(governor.isYielding()).toBe(false);
  });

  it('restores the full rate after 30 s of calm, and never sooner', () => {
    const governor = new FrameRateGovernor(15);
    governor.update({ pressure: 'serious', localLoad: false }, 0);
    expect(governor.update(CALM, 1_000)).toBeNull();
    expect(governor.update(CALM, 1_000 + RESTORE_AFTER_MS - 1)).toBeNull();
    expect(governor.update(CALM, 1_000 + RESTORE_AFTER_MS)).toEqual({ fps: 15, reason: 'calm' });
    expect(governor.isYielding()).toBe(false);
  });

  it('starts the 30 s again after any load, and does not count fair as calm', () => {
    const governor = new FrameRateGovernor(15);
    governor.update({ pressure: 'critical', localLoad: false }, 0);
    governor.update(CALM, 1_000);
    governor.update({ pressure: 'nominal', localLoad: true }, 20_000);
    expect(governor.update(CALM, 21_000 + RESTORE_AFTER_MS - 1)).toBeNull();
    governor.update({ pressure: 'fair', localLoad: false }, 40_000);
    expect(governor.update(CALM, 41_000)).toBeNull();
    expect(governor.update(CALM, 41_000 + RESTORE_AFTER_MS - 1)).toBeNull();
    expect(governor.update(CALM, 41_000 + RESTORE_AFTER_MS)).toEqual({ fps: 15, reason: 'calm' });
  });

  it('counts unknown pressure (no API) as calm once the local load is gone', () => {
    const governor = new FrameRateGovernor(15);
    governor.update({ pressure: null, localLoad: true }, 0);
    governor.update({ pressure: null, localLoad: false }, 1_000);
    expect(governor.update({ pressure: null, localLoad: false }, 1_000 + RESTORE_AFTER_MS)).toEqual(
      { fps: 15, reason: 'calm' },
    );
  });
});

describe('watchCpuPressure', () => {
  it('passes the CPU states on and stops on request', async () => {
    let callback: (records: { state: string }[]) => void = () => undefined;
    const disconnect = vi.fn();
    const observe = vi.fn(async () => undefined);
    class FakeObserver {
      constructor(cb: (records: { state: string }[]) => void) {
        callback = cb;
      }
      observe = observe;
      disconnect = disconnect;
    }
    const states: string[] = [];
    const stop = watchCpuPressure((state) => states.push(state), FakeObserver);
    expect(observe).toHaveBeenCalledWith('cpu', { sampleInterval: 1_000 });
    callback([{ state: 'fair' }, { state: 'serious' }]);
    callback([{ state: 'bogus' }]);
    expect(states).toEqual(['serious']);
    stop();
    expect(disconnect).toHaveBeenCalled();
  });

  it('does nothing without the API, or when observing is refused', async () => {
    const stop = watchCpuPressure(() => undefined, undefined);
    expect(() => stop()).not.toThrow();
    class Refused {
      observe = async () => {
        throw new Error('NotAllowedError');
      };
      disconnect = () => undefined;
    }
    const stopRefused = watchCpuPressure(() => undefined, Refused);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => stopRefused()).not.toThrow();
  });
});
