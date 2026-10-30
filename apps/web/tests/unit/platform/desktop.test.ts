/**
 * Tests for apps/web/src/platform/desktop.ts:
 * createDesktopPlatform() reports the shell's version and OS from the bridge, skips the Choose
 * platform dialog (offersPlatformChoice false), and opens the
 * microphone like the browser does; getOtherSideStream() asks for audio + video, stops and
 * removes the video track at once, returns the audio as 'system-loopback', and turns the two
 * macOS failure modes into typed errors (no audio track → 'not-supported'; an audio track that
 * arrived already ended → 'permission-denied' with the privacy-settings path) and a refused
 * request into 'permission-denied'; onHotkey() listens for the in-page shortcuts with ⌘ on
 * macOS and Ctrl on Windows (Day 4) and, with a Day 4 shell, turns the global shortcuts on and
 * off, forwards each press once and reports shortcuts another app holds (acceleratorLabel);
 * captureScreenshot() returns the shell PNG and maps its failures (Day 5); every not-yet-built
 * method throws NotImplementedError.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  acceleratorLabel,
  createDesktopPlatform,
  DESKTOP_DISPLAY_OPTIONS,
} from '@/platform/desktop';
import { CaptureError, NotImplementedError } from '@/platform/errors';
import { domError, fakeStream, fakeTrack, stubDisplayMedia } from './fakeMedia';

/** Desktop platforms built from fake bridges, as the shell's preload script would expose them. */
const mac = createDesktopPlatform({ version: '1.2.3', os: 'mac' });
const windows = createDesktopPlatform({ version: '1.2.3', os: 'windows' });

describe('createDesktopPlatform', () => {
  it('reports kind, version and os from the bridge, and opens sessions directly', () => {
    expect(mac.kind).toBe('desktop');
    expect(mac.offersPlatformChoice).toBe(false);
    expect(mac.version).toBe('1.2.3');
    expect(mac.os).toBe('mac');
  });

  it('getMicStream opens the microphone with getUserMedia', async () => {
    const fakeMic = { id: 'mic' } as unknown as MediaStream;
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(fakeMic) },
    });
    await expect(mac.getMicStream()).resolves.toBe(fakeMic);
  });

  it.each([
    ['openCompactView', 5, () => mac.openCompactView('s1')],
    ['setShareProtection', 5, () => mac.setShareProtection(true)],
  ])('%s rejects with NotImplementedError (Day %i)', async (_name, day, call) => {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotImplementedError);
    expect((error as NotImplementedError).day).toBe(day);
  });

  it('onHotkey listens for the in-page shortcuts with the OS modifier', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const onMac = vi.fn();
    const onWindows = vi.fn();
    const stops = [mac.onHotkey(onMac), windows.onHotkey(onWindows)];
    target.dispatchEvent(
      Object.assign(new Event('keydown'), {
        key: 'ArrowLeft',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        repeat: false,
      }),
    );
    expect(onMac).not.toHaveBeenCalled();
    expect(onWindows).toHaveBeenCalledWith('prev');
    for (const stop of stops) stop();
  });
});

describe('desktop getOtherSideStream', () => {
  it('asks for audio + video, stops the video track at once, and returns system audio', async () => {
    const video = fakeTrack('video');
    const audio = fakeTrack('audio');
    const getDisplayMedia = stubDisplayMedia(async () => fakeStream([video, audio]));
    const result = await windows.getOtherSideStream();
    expect(getDisplayMedia).toHaveBeenCalledWith(DESKTOP_DISPLAY_OPTIONS);
    expect(video.stop).toHaveBeenCalled();
    expect(result.source).toBe('system-loopback');
    expect(result.stream.getVideoTracks()).toHaveLength(0);
    expect(result.stream.getAudioTracks()).toEqual([audio]);
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it('reports no audio track (macOS 12) as not-supported, pointing to the browser path', async () => {
    stubDisplayMedia(async () => fakeStream([fakeTrack('video')]));
    const error = await mac.getOtherSideStream().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect(error).toMatchObject({ code: 'not-supported' });
    expect((error as Error).message).toMatch(/macOS 13 or later.*Chrome/);
  });

  it('reports an audio track that arrived ended (macOS permission) as permission-denied', async () => {
    const audio = fakeTrack('audio', 'ended');
    stubDisplayMedia(async () => fakeStream([fakeTrack('video'), audio]));
    const error = await mac.getOtherSideStream().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'permission-denied' });
    expect((error as Error).message).toMatch(/Screen & System Audio Recording/);
  });

  it('reports a refused request (the shell said no) as permission-denied', async () => {
    stubDisplayMedia(async () => {
      throw domError('AbortError');
    });
    await expect(windows.getOtherSideStream()).rejects.toMatchObject({ code: 'permission-denied' });
    stubDisplayMedia(async () => {
      throw domError('NotAllowedError', 'Permission denied');
    });
    await expect(windows.getOtherSideStream()).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('desktop onHotkey with the Day 4 shell', () => {
  it('turns the global shortcuts on, forwards them once, reports taken ones, and releases them', async () => {
    vi.stubGlobal('window', new EventTarget());
    let forward: ((action: 'answer' | 'next') => void) | null = null;
    const stopBridge = vi.fn();
    const setHotkeysEnabled = vi.fn(async (on: boolean) =>
      on
        ? [
            { action: 'answer' as const, accelerator: 'CommandOrControl+Enter', registered: true },
            { action: 'prev' as const, accelerator: 'CommandOrControl+Left', registered: false },
          ]
        : [],
    );
    const platform = createDesktopPlatform({
      version: '1.2.3',
      os: 'windows',
      setHotkeysEnabled,
      onHotkey: (handler) => {
        forward = handler;
        return stopBridge;
      },
    });
    const handler = vi.fn();
    const onTaken = vi.fn();
    const stop = platform.onHotkey(handler, onTaken);
    expect(setHotkeysEnabled).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(onTaken).toHaveBeenCalledWith(['Ctrl+←']));
    forward!('answer');
    // The same key press also reaching the page counts once.
    (window as unknown as EventTarget).dispatchEvent(
      Object.assign(new Event('keydown'), {
        key: 'Enter',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        repeat: false,
      }),
    );
    forward!('next');
    expect(handler.mock.calls).toEqual([['answer'], ['next']]);
    stop();
    expect(stopBridge).toHaveBeenCalled();
    expect(setHotkeysEnabled).toHaveBeenLastCalledWith(false);
  });

  it('labels accelerators the way each OS shows them', () => {
    expect(acceleratorLabel('CommandOrControl+Enter', 'windows')).toBe('Ctrl+Enter');
    expect(acceleratorLabel('CommandOrControl+Shift+Enter', 'mac')).toBe('⌘⇧Enter');
    expect(acceleratorLabel('CommandOrControl+Right', 'mac')).toBe('⌘→');
  });
});

describe('desktop captureScreenshot', () => {
  it('returns the shell PNG as a Blob', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const platform = createDesktopPlatform({
      version: '1',
      os: 'windows',
      captureScreenshot: async () => ({ ok: true, png, width: 4, height: 1, ms: 5 }),
    });
    const blob = await platform.captureScreenshot();
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
  });

  it('maps the shell failures and an old shell to typed errors', async () => {
    const codes = async (bridge: Parameters<typeof createDesktopPlatform>[0]) =>
      (
        (await createDesktopPlatform(bridge)
          .captureScreenshot()
          .catch((e: unknown) => e)) as CaptureError
      ).code;
    expect(await codes({ version: '1', os: 'mac' })).toBe('not-supported');
    expect(
      await codes({
        version: '1',
        os: 'mac',
        captureScreenshot: async () => ({ ok: false, code: 'permission-denied' }),
      }),
    ).toBe('permission-denied');
    expect(
      await codes({
        version: '1',
        os: 'windows',
        captureScreenshot: async () => ({ ok: false, code: 'no-screen' }),
      }),
    ).toBe('failed');
  });
});
