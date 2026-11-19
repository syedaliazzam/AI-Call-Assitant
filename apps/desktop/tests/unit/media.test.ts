/**
 * Tests for apps/desktop/src/media.ts, with the `electron` module mocked:
 * - canCaptureSystemAudio(): Windows yes; macOS 14.2+ yes (1.8.0, ADR-0111), macOS 14.1 and older no; Linux no;
 * - decideDisplayMedia(): only the Kite origin is granted, only when it asks for video; audio is
 *   'loopback' where the OS supports it and left out otherwise (the page then reports
 *   "not supported"); other origins are denied;
 * - allowSystemAudioLoopback(): installs a handler (no system picker) that answers the Kite
 *   origin with the first screen + loopback, denies other origins with callback(null), and
 *   denies when no screen source exists or listing sources fails;
 * - pickScreenSource() (1.5.0, ADR-0068): a video-only request (the recording) gets the picked display
 *   while it is connected; the call's system audio always gets the first (main) one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() } }));

const { allowSystemAudioLoopback, canCaptureSystemAudio, decideDisplayMedia, pickScreenSource } =
  await import('../../src/media');

/** The Kite origin used in these tests. */
const ORIGIN = 'https://kite-call-assistant.vercel.app';

/** A request from the Kite page asking for video + audio (what the web app sends). */
const KITE_REQUEST = { securityOrigin: ORIGIN, videoRequested: true, audioRequested: true };

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('canCaptureSystemAudio', () => {
  it('is supported on Windows and on macOS 13 or newer only', () => {
    expect(canCaptureSystemAudio('win32', '10.0.26200')).toBe(true);
    expect(canCaptureSystemAudio('darwin', '14.2.1')).toBe(true);
    expect(canCaptureSystemAudio('darwin', '14.2')).toBe(true);
    expect(canCaptureSystemAudio('darwin', '15.1')).toBe(true);
    expect(canCaptureSystemAudio('darwin', '26.0')).toBe(true);
    // ADR-0111: 13.0 to 14.1 have no loopback Electron 44 can use.
    expect(canCaptureSystemAudio('darwin', '14.1.2')).toBe(false);
    expect(canCaptureSystemAudio('darwin', '14')).toBe(false);
    expect(canCaptureSystemAudio('darwin', '13.0')).toBe(false);
    expect(canCaptureSystemAudio('darwin', '12.7.6')).toBe(false);
    expect(canCaptureSystemAudio('darwin', 'garbage')).toBe(false);
    expect(canCaptureSystemAudio('linux', '6.8.0')).toBe(false);
  });
});

describe('decideDisplayMedia', () => {
  it('grants the Kite origin a screen with system audio on Windows and macOS 13+', () => {
    expect(decideDisplayMedia(KITE_REQUEST, ORIGIN, 'win32', '10.0.26200')).toEqual({
      kind: 'grant',
      audio: 'loopback',
    });
    expect(decideDisplayMedia(KITE_REQUEST, ORIGIN, 'darwin', '15.1')).toEqual({
      kind: 'grant',
      audio: 'loopback',
    });
  });

  it('leaves audio out where the OS cannot capture it (macOS 12)', () => {
    expect(decideDisplayMedia(KITE_REQUEST, ORIGIN, 'darwin', '12.7.6')).toEqual({
      kind: 'grant',
      audio: null,
    });
  });

  it('leaves audio out when the page did not ask for it', () => {
    expect(
      decideDisplayMedia({ ...KITE_REQUEST, audioRequested: false }, ORIGIN, 'win32', '10.0'),
    ).toEqual({ kind: 'grant', audio: null });
  });

  it('denies other origins, look-alike origins and requests without video', () => {
    for (const securityOrigin of [
      'https://evil.example.com',
      'https://kite-call-assistant.vercel.app.evil.example.com',
      'http://kite-call-assistant.vercel.app',
      'not a url',
    ]) {
      expect(
        decideDisplayMedia({ ...KITE_REQUEST, securityOrigin }, ORIGIN, 'win32', '10'),
      ).toEqual({ kind: 'deny', reason: 'other-origin' });
    }
    expect(
      decideDisplayMedia({ ...KITE_REQUEST, videoRequested: false }, ORIGIN, 'win32', '10'),
    ).toEqual({ kind: 'deny', reason: 'no-video' });
  });
});

describe('allowSystemAudioLoopback', () => {
  /**
   * Installs the display-media handler on a fake session.
   *
   * @param getSources Fake desktopCapturer.getSources (the screens the shell would see).
   * @param platform   Operating system to simulate (default 'win32').
   * @returns ask(): sends a capture request to the handler and resolves with its answer; and the
   *          spy that recorded how the handler was installed.
   */
  function install(getSources: ReturnType<typeof vi.fn>, platform: NodeJS.Platform = 'win32') {
    let handler: ((request: unknown, callback: (streams: unknown) => void) => void) | undefined;
    const setDisplayMediaRequestHandler = vi.fn((h: typeof handler, opts?: unknown) => {
      handler = h;
      return opts;
    });
    const session = { setDisplayMediaRequestHandler } as never;
    allowSystemAudioLoopback(session, ORIGIN, {
      getSources: getSources as never,
      platform,
      osVersion: platform === 'darwin' ? '14.2' : '10.0.26200',
    });
    const ask = (request: object) =>
      new Promise((resolve) => handler!({ frame: null, userGesture: true, ...request }, resolve));
    return { ask, setDisplayMediaRequestHandler };
  }

  const SCREEN = { id: 'screen:0:0', name: 'Entire screen' };

  it('installs the handler without the system picker', () => {
    const { setDisplayMediaRequestHandler } = install(vi.fn());
    expect(setDisplayMediaRequestHandler).toHaveBeenCalledTimes(1);
    expect(setDisplayMediaRequestHandler.mock.calls[0]![1]).toBeUndefined();
  });

  it('answers the Kite page with the first screen and loopback audio, without thumbnails', async () => {
    const getSources = vi.fn(async () => [SCREEN, { id: 'screen:1:0', name: 'Second' }]);
    const { ask } = install(getSources);
    await expect(ask(KITE_REQUEST)).resolves.toEqual({ video: SCREEN, audio: 'loopback' });
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
  });

  it('denies another origin with callback(null) and never lists screens', async () => {
    const getSources = vi.fn(async () => [SCREEN]);
    const { ask } = install(getSources);
    await expect(
      ask({ ...KITE_REQUEST, securityOrigin: 'https://evil.example.com' }),
    ).resolves.toBe(null);
    expect(getSources).not.toHaveBeenCalled();
  });

  it('denies when there is no screen source, or listing sources fails', async () => {
    await expect(install(vi.fn(async () => [])).ask(KITE_REQUEST)).resolves.toBe(null);
    await expect(
      install(
        vi.fn(async () => {
          throw new Error('screen recording not allowed');
        }),
      ).ask(KITE_REQUEST),
    ).resolves.toBe(null);
  });
});

describe('pickScreenSource (1.5.0, ADR-0068)', () => {
  const sources = [{ display_id: '1' }, { display_id: '2' }];
  it('gives a recording the picked display while it is connected', () => {
    expect(pickScreenSource(sources, false, '2')).toEqual({ display_id: '2' });
    expect(pickScreenSource(sources, false, 'gone')).toEqual({ display_id: '1' });
    expect(pickScreenSource(sources, false, null)).toEqual({ display_id: '1' });
  });
  it('gives the call’s system audio the main display', () => {
    expect(pickScreenSource(sources, true, '2')).toEqual({ display_id: '1' });
    expect(pickScreenSource([], false, '2')).toBeUndefined();
  });
});
