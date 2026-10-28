/**
 * Tests for apps/web/src/platform/desktop.ts:
 * createDesktopPlatform() reports the shell's version and OS from the bridge, skips the Choose
 * platform dialog (offersPlatformChoice false), and opens the
 * microphone like the browser does; getOtherSideStream() asks for audio + video, stops and
 * removes the video track at once, returns the audio as 'system-loopback', and turns the two
 * macOS failure modes into typed errors (no audio track → 'not-supported'; an audio track that
 * arrived already ended → 'permission-denied' with the privacy-settings path) and a refused
 * request into 'permission-denied'; every not-yet-built method throws NotImplementedError.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDesktopPlatform, DESKTOP_DISPLAY_OPTIONS } from '@/platform/desktop';
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
    ['captureScreenshot', 5, () => mac.captureScreenshot()],
    ['openCompactView', 5, () => mac.openCompactView('s1')],
    ['setShareProtection', 5, () => mac.setShareProtection(true)],
  ])('%s rejects with NotImplementedError (Day %i)', async (_name, day, call) => {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotImplementedError);
    expect((error as NotImplementedError).day).toBe(day);
  });

  it('onHotkey throws NotImplementedError (Day 4)', () => {
    expect(() => mac.onHotkey(() => {})).toThrow(/desktop\.onHotkey.*Day 4/);
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
