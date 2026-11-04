/**
 * Tests for apps/web/src/platform/media.ts (the shared capture helpers):
 * toCaptureError() maps getDisplayMedia failures to typed CaptureErrors per platform (a closed
 * picker in a browser is 'user-cancelled'; an OS or shell refusal is 'permission-denied', with
 * macOS privacy instructions on a Mac; anything else is 'not-supported') and passes a
 * CaptureError through unchanged; stopAllTracks() stops every track; the microphone keeps echo
 * cancellation on.
 */
import { describe, expect, it, vi } from 'vitest';
import { CaptureError } from '@/platform/errors';
import {
  listMicrophones,
  MIC_CONSTRAINTS,
  stopAllTracks,
  toCaptureError,
  watchBatteryState,
} from '@/platform/media';
import { domError, fakeStream, fakeTrack } from './fakeMedia';

describe('toCaptureError', () => {
  it('treats a closed picker in the browser as user-cancelled', () => {
    expect(toCaptureError(domError('NotAllowedError', 'Permission denied'), 'browser').code).toBe(
      'user-cancelled',
    );
  });

  it('treats OS and shell refusals as permission-denied, with macOS instructions on a Mac', () => {
    const bySystem = toCaptureError(
      domError('NotAllowedError', 'Permission denied by system'),
      'browser',
    );
    expect(bySystem.code).toBe('permission-denied');
    const shell = toCaptureError(domError('AbortError'), 'desktop', 'mac');
    expect(shell.code).toBe('permission-denied');
    expect(shell.message).toMatch(/Privacy & Security/);
    expect(toCaptureError(domError('NotAllowedError'), 'desktop', 'windows').code).toBe(
      'permission-denied',
    );
  });

  it('treats anything else as not-supported, and keeps a CaptureError as it is', () => {
    expect(toCaptureError(domError('NotSupportedError'), 'browser').code).toBe('not-supported');
    expect(toCaptureError('weird', 'browser').code).toBe('not-supported');
    const original = new CaptureError('no-audio-track', 'x');
    expect(toCaptureError(original, 'browser')).toBe(original);
  });
});

describe('stopAllTracks', () => {
  it('stops every track of a stream', () => {
    const tracks = [fakeTrack('audio'), fakeTrack('video')];
    stopAllTracks(fakeStream(tracks));
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });
});

describe('MIC_CONSTRAINTS', () => {
  it('keeps echo cancellation on (speakers leak into the microphone)', () => {
    expect(MIC_CONSTRAINTS.audio).toMatchObject({ echoCancellation: true });
  });
});

describe('listMicrophones (v1.1.0)', () => {
  it('lists the microphones, with a name for one that has none', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'audioinput', deviceId: 'a', label: 'Headset' },
          { kind: 'audiooutput', deviceId: 'b', label: 'Speakers' },
          { kind: 'audioinput', deviceId: 'c', label: '' },
          { kind: 'audioinput', deviceId: '', label: 'No id' },
          { kind: 'videoinput', deviceId: 'd', label: 'Camera' },
        ],
      },
    });
    await expect(listMicrophones()).resolves.toEqual([
      { id: 'a', label: 'Headset' },
      { id: 'c', label: 'Microphone 2' },
    ]);
    vi.unstubAllGlobals();
  });

  it('gives none where the browser cannot list them', async () => {
    vi.stubGlobal('navigator', {});
    await expect(listMicrophones()).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('watchBatteryState (v1.1.0, ADR-0044)', () => {
  /**
   * A fake battery.
   *
   * @param charging Whether it is charging.
   * @returns The battery.
   */
  const fakeBattery = (charging: boolean) =>
    Object.assign(new EventTarget(), { charging }) as EventTarget & { charging: boolean };

  it('reports now and on each change, until stopped', async () => {
    const battery = fakeBattery(true);
    vi.stubGlobal('navigator', { getBattery: async () => battery });
    const seen: (boolean | null)[] = [];
    const stop = watchBatteryState((onBattery) => seen.push(onBattery));
    await vi.waitFor(() => expect(seen).toEqual([false]));
    battery.charging = false;
    battery.dispatchEvent(new Event('chargingchange'));
    expect(seen).toEqual([false, true]);
    stop();
    battery.charging = true;
    battery.dispatchEvent(new Event('chargingchange'));
    expect(seen).toEqual([false, true]);
    vi.unstubAllGlobals();
  });

  it('says it cannot tell in a browser without the API, or when it fails', async () => {
    vi.stubGlobal('navigator', {});
    const seen: (boolean | null)[] = [];
    watchBatteryState((onBattery) => seen.push(onBattery));
    expect(seen).toEqual([null]);
    vi.stubGlobal('navigator', { getBattery: () => Promise.reject(new Error('blocked')) });
    watchBatteryState((onBattery) => seen.push(onBattery));
    await vi.waitFor(() => expect(seen).toEqual([null, null]));
    vi.unstubAllGlobals();
  });

  it('reports nothing when stopped before the battery is known', async () => {
    const battery = fakeBattery(false);
    vi.stubGlobal('navigator', { getBattery: async () => battery });
    const seen: (boolean | null)[] = [];
    watchBatteryState((onBattery) => seen.push(onBattery))();
    await new Promise((resolve) => setTimeout(resolve));
    expect(seen).toEqual([]);
    vi.unstubAllGlobals();
  });
});
