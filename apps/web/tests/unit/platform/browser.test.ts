/**
 * Tests for apps/web/src/platform/browser.ts (and the shared microphone code in media.ts):
 * kind 'browser' with the Choose platform dialog (offersPlatformChoice);
 * getMicStream() calls getUserMedia with the microphone settings and fails clearly without the
 * MediaDevices API; getOtherSideStream() asks for a tab with its audio using Chrome's options,
 * returns the stream with its source ('tab-audio' / 'screen-audio'), keeps the video track,
 * stops the share and throws CaptureError('no-audio-track') when "Also share tab audio" was not
 * ticked, and maps a cancelled picker, an OS refusal and a missing API to typed errors;
 * onHotkey() listens for the in-page shortcuts with the Mac modifier on a Mac (Day 4);
 * captureScreenshot() needs an active share (Day 5); share protection is never supported; and
 * openCompactView() says clearly when the browser has no Document Picture-in-Picture (Day 5);
 * the overlay cannot be placed, resized or switched in a browser (v1.0.2, ADR-0035).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_DISPLAY_OPTIONS,
  browserPlatform,
  NO_PIP_MESSAGE,
  NO_SHARE_MESSAGE,
  NO_TAB_AUDIO_MESSAGE,
} from '@/platform/browser';
import { CaptureError } from '@/platform/errors';
import { MIC_CONSTRAINTS } from '@/platform/media';
import { domError, fakeStream, fakeTrack, stubDisplayMedia } from './fakeMedia';

describe('browserPlatform', () => {
  it('reports kind "browser" and shows the Choose platform dialog', () => {
    expect(browserPlatform.kind).toBe('browser');
    expect(browserPlatform.offersPlatformChoice).toBe(true);
  });

  it('getMicStream opens the microphone with getUserMedia', async () => {
    const fakeMic = { id: 'mic' } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(fakeMic);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    await expect(browserPlatform.getMicStream()).resolves.toBe(fakeMic);
    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
  });

  it('getMicStream fails with a clear error when MediaDevices is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(browserPlatform.getMicStream()).rejects.toThrow(/Microphone access/);
  });

  it('openCompactView: a browser without Document Picture-in-Picture gets a clear message', async () => {
    const error = (await browserPlatform
      .openCompactView('s1', () => () => undefined)
      .catch((e: unknown) => e)) as CaptureError;
    expect(error).toBeInstanceOf(CaptureError);
    expect(error.code).toBe('not-supported');
    expect(error.message).toBe(NO_PIP_MESSAGE);
    await expect(browserPlatform.closeCompactView()).resolves.toBeUndefined();
  });

  it('showCallWindow: the call is in this tab, so it asks the browser to bring it forward', async () => {
    const focus = vi.fn();
    vi.stubGlobal('window', { focus });
    await expect(browserPlatform.showCallWindow()).resolves.toBeUndefined();
    expect(focus).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('cannot place, resize or switch a picture-in-picture window (v1.0.2, ADR-0035)', async () => {
    expect(browserPlatform.overlayPlacement()).toBe(false);
    await expect(browserPlatform.getOverlayPreset()).resolves.toBeNull();
    expect(() => {
      browserPlatform.placeOverlay('top-right');
      browserPlatform.resizeOverlay({ phase: 'start', edge: 'e', dx: 0, dy: 0 });
      browserPlatform.setOverlayMode('script');
    }).not.toThrow();
  });

  it('onHotkey listens for the in-page shortcuts (⌘ on a Mac, Ctrl elsewhere)', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    const handler = vi.fn();
    const stop = browserPlatform.onHotkey(handler);
    const key = (fields: object) =>
      target.dispatchEvent(
        Object.assign(new Event('keydown'), {
          key: 'Enter',
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          repeat: false,
          ...fields,
        }),
      );
    key({ ctrlKey: true });
    key({ metaKey: true });
    expect(handler.mock.calls).toEqual([['answer']]);
    stop();
  });
});

describe('browserPlatform.getOtherSideStream', () => {
  it('asks for a tab with audio, keeping the user able to hear it and excluding Kite', async () => {
    const getDisplayMedia = stubDisplayMedia(async () =>
      fakeStream([fakeTrack('video', 'live', 'browser'), fakeTrack('audio')]),
    );
    await browserPlatform.getOtherSideStream();
    expect(getDisplayMedia).toHaveBeenCalledWith(BROWSER_DISPLAY_OPTIONS);
    expect(BROWSER_DISPLAY_OPTIONS).toMatchObject({
      video: { displaySurface: 'browser' },
      audio: { suppressLocalAudioPlayback: false },
      selfBrowserSurface: 'exclude',
      preferCurrentTab: false,
    });
  });

  it('returns a shared tab as "tab-audio" and keeps its video track (Day 5)', async () => {
    const video = fakeTrack('video', 'live', 'browser');
    stubDisplayMedia(async () => fakeStream([video, fakeTrack('audio')]));
    const result = await browserPlatform.getOtherSideStream();
    expect(result.source).toBe('tab-audio');
    expect(result.stream.getAudioTracks()).toHaveLength(1);
    expect(result.stream.getVideoTracks()).toHaveLength(1);
    expect(video.stop).not.toHaveBeenCalled();
  });

  it('returns a shared screen or window as "screen-audio"', async () => {
    stubDisplayMedia(async () =>
      fakeStream([fakeTrack('video', 'live', 'monitor'), fakeTrack('audio')]),
    );
    await expect(browserPlatform.getOtherSideStream()).resolves.toMatchObject({
      source: 'screen-audio',
    });
  });

  it('stops the share and throws no-audio-track when tab audio was not shared', async () => {
    const video = fakeTrack('video', 'live', 'browser');
    stubDisplayMedia(async () => fakeStream([video]));
    const error = await browserPlatform.getOtherSideStream().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect(error).toMatchObject({ code: 'no-audio-track', message: NO_TAB_AUDIO_MESSAGE });
    expect(NO_TAB_AUDIO_MESSAGE).toMatch(/Also share tab audio/);
    expect(video.stop).toHaveBeenCalled();
  });

  it('reports a closed picker as user-cancelled and an OS refusal as permission-denied', async () => {
    stubDisplayMedia(async () => {
      throw domError('NotAllowedError', 'Permission denied');
    });
    await expect(browserPlatform.getOtherSideStream()).rejects.toMatchObject({
      code: 'user-cancelled',
    });
    stubDisplayMedia(async () => {
      throw domError('NotAllowedError', 'Permission denied by system');
    });
    await expect(browserPlatform.getOtherSideStream()).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('reports a browser without getDisplayMedia as not-supported', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });
    await expect(browserPlatform.getOtherSideStream()).rejects.toMatchObject({
      code: 'not-supported',
    });
  });
});

describe('browser share protection', () => {
  it('is never supported in a browser', async () => {
    expect(await browserPlatform.setShareProtection(true)).toEqual({ on: false, supported: false });
    expect(await browserPlatform.getShareProtection()).toEqual({ on: false, supported: false });
  });
});

describe('browser captureScreenshot', () => {
  it('reports no-share when the share has ended, and failed when no frame can be read', async () => {
    const video = fakeTrack('video', 'live', 'browser');
    stubDisplayMedia(async () => fakeStream([fakeTrack('audio'), video]));
    await browserPlatform.getOtherSideStream();
    // A live share, but this test environment has no ImageCapture or document to read it.
    const failed = (await browserPlatform
      .captureScreenshot()
      .catch((e: unknown) => e)) as CaptureError;
    expect(failed).toBeInstanceOf(CaptureError);
    expect(failed.code).toBe('failed');
    // The user stopped sharing.
    video.readyState = 'ended';
    const noShare = (await browserPlatform
      .captureScreenshot()
      .catch((e: unknown) => e)) as CaptureError;
    expect(noShare.code).toBe('no-share');
    expect(noShare.message).toBe(NO_SHARE_MESSAGE);
  });
});
