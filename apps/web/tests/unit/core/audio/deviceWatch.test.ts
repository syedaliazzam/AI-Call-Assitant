/**
 * Tests apps/web/src/core/audio/deviceWatch.ts (1.5.1, ADR-0069): a burst of device changes is reported
 * once, after it settles, with the microphones; nothing after stopping; nothing where devices cannot be
 * watched. Batch C (P1-5): the default output's key comes with them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/media', () => ({
  listMicrophones: vi.fn(async () => [{ id: 'headset', label: 'Headset' }]),
  defaultOutputKey: vi.fn(async () => 'group-1|Headphones'),
}));

const { watchDeviceChanges } = await import('@/core/audio/deviceWatch');

/**
 * A fake navigator.mediaDevices that can fire 'devicechange'.
 *
 * @returns A function that fires one change.
 */
function fakeDevices() {
  const target = new EventTarget();
  vi.stubGlobal('navigator', { mediaDevices: target });
  return () => target.dispatchEvent(new Event('devicechange'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('watchDeviceChanges', () => {
  it('reports a burst once, after it settles, with the microphones', async () => {
    vi.useFakeTimers();
    const fire = fakeDevices();
    const seen: string[][] = [];
    const outputs: (string | null)[] = [];
    const stop = watchDeviceChanges((mics, output) => {
      seen.push(mics.map((mic) => mic.id));
      outputs.push(output);
    }, 1_000);
    fire();
    fire();
    await vi.advanceTimersByTimeAsync(500);
    fire();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen).toEqual([['headset']]);
    expect(outputs).toEqual(['group-1|Headphones']);
    stop();
    fire();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen).toHaveLength(1);
  });

  it('does nothing where devices cannot be watched', () => {
    vi.stubGlobal('navigator', {});
    const stop = watchDeviceChanges(() => undefined);
    expect(() => stop()).not.toThrow();
  });
});
