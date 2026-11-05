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
 * captureScreenshot() returns the shell PNG and maps its failures; the compact view and share
 * protection go through the Day 5 bridge, and a shell from before Day 5 reports them unsupported.
 * v1.0.2 (ADR-0035): overlay placement, resizing and modes go through a 1.0.2 shell; an older
 * shell reports no placement and its modes fall back to collapsing.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  acceleratorLabel,
  createDesktopPlatform,
  DESKTOP_DISPLAY_OPTIONS,
} from '@/platform/desktop';
import { CaptureError } from '@/platform/errors';
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

  it('compact view and protection go through the Day 5 bridge; an older shell is unsupported', async () => {
    const openCompactView = vi.fn(async () => undefined);
    const closeCompactView = vi.fn(async () => undefined);
    const setShareProtection = vi.fn(async (on: boolean) => ({ on, supported: true }));
    const getShareProtection = vi.fn(async () => ({ on: true, supported: true }));
    const platform = createDesktopPlatform({
      version: '1',
      os: 'windows',
      openCompactView,
      closeCompactView,
      setShareProtection,
      getShareProtection,
    });
    await platform.openCompactView('s1');
    await platform.closeCompactView();
    expect(openCompactView).toHaveBeenCalledWith('s1');
    expect(closeCompactView).toHaveBeenCalled();
    expect(await platform.setShareProtection(false)).toEqual({ on: false, supported: true });
    expect(await platform.getShareProtection()).toEqual({ on: true, supported: true });
    // A desktop app from before Day 5.
    const error = (await mac.openCompactView('s1').catch((e: unknown) => e)) as CaptureError;
    expect(error.code).toBe('not-supported');
    await expect(mac.closeCompactView()).resolves.toBeUndefined();
    expect(await mac.getShareProtection()).toEqual({ on: false, supported: false });
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

describe('createDesktopPlatform: the full call window (v1.0.4, ADR-0040)', () => {
  it('asks the shell, which brings it forward and hides the overlay', async () => {
    const showCallWindow = vi.fn(async () => undefined);
    const closeCompactView = vi.fn(async () => undefined);
    const platform = createDesktopPlatform({
      version: '1.0.4',
      os: 'windows',
      showCallWindow,
      closeCompactView,
    });
    await platform.showCallWindow();
    expect(showCallWindow).toHaveBeenCalledOnce();
    expect(closeCompactView).not.toHaveBeenCalled();
  });

  it('on an older shell, closes the overlay: that brings the main window back', async () => {
    const closeCompactView = vi.fn(async () => undefined);
    const platform = createDesktopPlatform({ version: '1.0.3', os: 'windows', closeCompactView });
    await platform.showCallWindow();
    expect(closeCompactView).toHaveBeenCalledOnce();
  });

  it('on a shell with neither, does nothing', async () => {
    const platform = createDesktopPlatform({ version: '0.1.0', os: 'windows' });
    await expect(platform.showCallWindow()).resolves.toBeUndefined();
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
            {
              action: 'overlay-left' as const,
              accelerator: 'CommandOrControl+Alt+Left',
              registered: false,
            },
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
    await vi.waitFor(() => expect(onTaken).toHaveBeenCalledWith(['Ctrl+Alt+←']));
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

describe('createDesktopPlatform: accurate transcription (v1.0.1, ADR-0034)', () => {
  it('has no accurate engine in a desktop app without the four methods', () => {
    expect(windows.accurate).toBeNull();
  });

  it('passes calls to the shell, and turns a failed transcription into "engine"', async () => {
    const status = { state: 'ready' as const, receivedBytes: 1, totalBytes: 1 };
    const platform = createDesktopPlatform({
      version: '1.0.1',
      os: 'windows',
      accurateStatus: vi.fn(async () => status),
      accurateDownload: vi.fn(async () => status),
      accurateRemove: vi.fn(async () => status),
      accurateTranscribe: vi.fn(async () => {
        throw new Error('ipc closed');
      }),
    });
    expect(await platform.accurate?.status()).toEqual(status);
    expect(await platform.accurate?.transcribe(new Float32Array(16_000))).toEqual({
      ok: false,
      code: 'engine',
    });
  });
});

describe('createDesktopPlatform: overlay placement, resizing and modes (v1.0.2, ADR-0035)', () => {
  it('a shell without the methods: no placement, no preset, and modes fall back to collapse', async () => {
    const setOverlayCollapsed = vi.fn(async () => undefined);
    const platform = createDesktopPlatform({
      version: '1.0.1',
      os: 'windows',
      setOverlayCollapsed,
    });
    expect(platform.overlayPlacement()).toBe(false);
    expect(await platform.getOverlayPreset()).toBeNull();
    platform.placeOverlay('top-right');
    platform.resizeOverlay({ phase: 'start', edge: 'e', dx: 0, dy: 0 });
    platform.setOverlayMode('collapsed');
    platform.setOverlayMode('script');
    platform.setOverlayMode('full');
    expect(setOverlayCollapsed.mock.calls).toEqual([[true], [false]]);
  });

  it('a 1.0.2 shell: passes each call through, and a failed one stays quiet', async () => {
    const bridge = {
      version: '1.0.2',
      os: 'windows' as const,
      placeOverlay: vi.fn(async () => undefined),
      getOverlayPreset: vi.fn(async () => 'bottom-center' as const),
      resizeOverlay: vi.fn(async () => {
        throw new Error('ipc closed');
      }),
      setOverlayMode: vi.fn(async () => undefined),
      setOverlayCollapsed: vi.fn(async () => undefined),
    };
    const platform = createDesktopPlatform(bridge);
    expect(platform.overlayPlacement()).toBe(true);
    platform.placeOverlay('top-right');
    expect(await platform.getOverlayPreset()).toBe('bottom-center');
    platform.resizeOverlay({ phase: 'move', edge: 'se', dx: 3, dy: 4 });
    platform.setOverlayMode('script-input');
    await Promise.resolve();
    expect(bridge.placeOverlay).toHaveBeenCalledWith('top-right');
    expect(bridge.resizeOverlay).toHaveBeenCalledWith({ phase: 'move', edge: 'se', dx: 3, dy: 4 });
    expect(bridge.setOverlayMode).toHaveBeenCalledWith('script-input');
    expect(bridge.setOverlayCollapsed).not.toHaveBeenCalled();
  });
});

describe('createDesktopPlatform: the icon and the chat shortcut (spec S13, S14)', () => {
  it('a 1.1.0 shell has neither: compact collapses, and the calls do nothing', () => {
    const platform = createDesktopPlatform({ version: '1.1.0', os: 'windows' });
    expect(platform.overlayIconMode()).toBe(false);
    expect(() => platform.moveOverlay(1, 2)).not.toThrow();
    expect(() => platform.setChatHotkey(true)).not.toThrow();
  });

  it('a 1.2.0 shell gets both, and a failed call stays quiet', () => {
    const bridge = {
      version: '1.2.0',
      os: 'windows' as const,
      moveOverlay: vi.fn(async () => {
        throw new Error('ipc closed');
      }),
      setChatHotkey: vi.fn(async () => undefined),
    };
    const platform = createDesktopPlatform(bridge);
    expect(platform.overlayIconMode()).toBe(true);
    platform.moveOverlay(3, 4);
    expect(bridge.moveOverlay).toHaveBeenCalledWith(3, 4);
    platform.setChatHotkey(true);
    expect(bridge.setChatHotkey).toHaveBeenCalledWith(true);
  });
});

describe('createDesktopPlatform: the session file (spec S9)', () => {
  it('an older shell has neither call: nothing is picked or deleted', async () => {
    const platform = createDesktopPlatform({ version: '1.1.0', os: 'windows' });
    expect(await platform.pickHandoffFile()).toBeNull();
    expect(await platform.deleteHandoffFile()).toBe(false);
  });

  it('passes both calls through, and a failed delete stays quiet', async () => {
    const picked = { name: 'a.json', text: '{}' };
    const bridge = {
      version: '1.2.0',
      os: 'windows' as const,
      pickHandoffFile: vi.fn(async () => picked),
      deleteHandoffFile: vi.fn(async () => true),
    };
    const platform = createDesktopPlatform(bridge);
    expect(await platform.pickHandoffFile()).toBe(picked);
    expect(await platform.deleteHandoffFile()).toBe(true);
    bridge.deleteHandoffFile.mockRejectedValueOnce(new Error('ipc closed'));
    expect(await platform.deleteHandoffFile()).toBe(false);
  });
});

describe('createDesktopPlatform: home panel and stacked overlay (v1.1.0, ADR-0041)', () => {
  it('a shell before 1.1.0: no home panel, no panels, and every call does nothing', () => {
    const platform = createDesktopPlatform({ version: '1.0.4', os: 'windows' });
    expect(platform.hasHomePanel()).toBe(false);
    expect(platform.overlayFitsPanels()).toBe(false);
    // In this window, as an older shell expects: it has no other window to use.
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    platform.openPagesWindow('/settings');
    expect(assign).toHaveBeenCalledWith('/settings');
    vi.unstubAllGlobals();
    expect(() => platform.windowControl('close')).not.toThrow();
    expect(() =>
      platform.setOverlayLayout({ transcript: true, answer: false, popupHeight: 0 }),
    ).not.toThrow();
    expect(() => platform.onSnapZone(() => undefined)()).not.toThrow();
  });

  it('a 1.1.0 shell: passes each call through, and a failed one stays quiet', async () => {
    const bridge = {
      version: '1.1.0',
      os: 'windows' as const,
      openPagesWindow: vi.fn(async () => undefined),
      windowControl: vi.fn(async () => {
        throw new Error('ipc closed');
      }),
      setOverlayLayout: vi.fn(async () => undefined),
      onSnapZone: vi.fn(() => () => undefined),
    };
    const platform = createDesktopPlatform(bridge);
    expect(platform.hasHomePanel()).toBe(true);
    expect(platform.overlayFitsPanels()).toBe(true);
    platform.openPagesWindow('/settings');
    expect(bridge.openPagesWindow).toHaveBeenCalledWith('/settings');
    platform.windowControl('minimize');
    expect(bridge.windowControl).toHaveBeenCalledWith('minimize');
    const layout = { transcript: true, answer: true, popupHeight: 200, scale: 1.1 };
    platform.setOverlayLayout(layout);
    expect(bridge.setOverlayLayout).toHaveBeenCalledWith(layout);
    const handler = () => undefined;
    platform.onSnapZone(handler);
    expect(bridge.onSnapZone).toHaveBeenCalledWith(handler);
    // The rejected call above must not surface as an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve));
  });
});
