/**
 * Tests for apps/web/src/platform/recording.ts (desktop 1.5.0, ADR-0068): the host exists only when the
 * shell has every recording method; openScreen() picks the display first, then asks for video only at
 * the quality's size (no audio, no picker), applies the limits when Chromium did not, and turns a missing
 * or ended track into a CaptureError; the other calls go straight to the bridge.
 */
import type { KiteDesktopApi } from '@kite/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureError } from '@/platform';
import { desktopRecordingHost, openRecordingScreen } from '@/platform/recording';

afterEach(() => vi.unstubAllGlobals());

/** The Standard quality. */
const STANDARD = { width: 1280, height: 720, frameRate: 15, videoBitsPerSecond: 1_500_000 };

/**
 * A bridge with every recording method.
 * @returns The bridge and its calls.
 */
function bridge() {
  const calls: string[] = [];
  const api: KiteDesktopApi = {
    version: '1.5.0',
    os: 'windows',
    recordingOpen: async () => ({ ok: true, fileName: 'a.mkv', freeBytes: 1 }),
    recordingWrite: async () => ({ ok: true, disk: 'ok', freeBytes: 1 }),
    recordingClose: async () => ({ ok: true, recording: null }),
    recordingList: async () => [],
    recordingPlay: async (id) => (calls.push(`play ${id}`), true),
    recordingSaveAs: async () => 'saved',
    recordingShowInFolder: async () => true,
    recordingDelete: async (id) => (calls.push(`delete ${id}`), true),
    listDisplays: async () => [],
    setRecordingDisplay: async (id) => void calls.push(`display ${id}`),
    deviceIdentity: async () => ({ id: 'd1', name: 'Laptop' }),
    renameDevice: async (name) => ({ id: 'd1', name }),
  };
  return { api, calls };
}

/**
 * A fake display stream.
 * @param settings  The video track's settings.
 * @param readyState Its state.
 * @returns The stream and the track's applyConstraints spy.
 */
function displayStream(settings: MediaTrackSettings, readyState = 'live') {
  const applyConstraints = vi.fn(async () => undefined);
  const track = { readyState, getSettings: () => settings, applyConstraints, stop: vi.fn() };
  return {
    stream: {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream,
    applyConstraints,
    track,
  };
}

describe('desktopRecordingHost', () => {
  it('is null for a shell without the recording methods', () => {
    expect(desktopRecordingHost({ version: '1.4.0', os: 'windows' })).toBeNull();
    const { api } = bridge();
    expect(desktopRecordingHost({ ...api, renameDevice: undefined })).toBeNull();
  });

  it('passes the calls to the bridge, and picks the display before the screen', async () => {
    const { api, calls } = bridge();
    const host = desktopRecordingHost(api)!;
    expect(await host.play('r1')).toBe(true);
    expect(await host.remove('r1')).toBe(true);
    expect(await host.renameDevice('Desk')).toEqual({ id: 'd1', name: 'Desk' });
    const display = displayStream({ width: 1280, height: 720, frameRate: 15 });
    const getDisplayMedia = vi.fn(async () => display.stream);
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    await host.openScreen(STANDARD, '2');
    expect(calls).toEqual(['play r1', 'delete r1', 'display 2']);
    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } },
      audio: false,
    });
  });
});

describe('openRecordingScreen', () => {
  it('applies the limits when Chromium did not', async () => {
    const display = displayStream({ width: 1920, height: 1080, frameRate: 30 });
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => display.stream } });
    await openRecordingScreen(STANDARD);
    expect(display.applyConstraints).toHaveBeenCalledOnce();
  });

  it('refuses an ended track, releasing it', async () => {
    const display = displayStream({}, 'ended');
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => display.stream } });
    await expect(openRecordingScreen(STANDARD)).rejects.toBeInstanceOf(CaptureError);
    expect(display.track.stop).toHaveBeenCalled();
  });

  it('turns a refusal into a CaptureError', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: async () => {
          throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
        },
      },
    });
    await expect(openRecordingScreen(STANDARD, 'windows')).rejects.toBeInstanceOf(CaptureError);
  });
});
