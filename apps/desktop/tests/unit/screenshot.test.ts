/**
 * Tests for apps/desktop/src/screenshot.ts, with desktopCapturer, screen and systemPreferences
 * faked: the thumbnail is requested already scaled to ≤ 1,568 px on the long side from the
 * display's physical size (never upscaled); the display under the Kite window is used (the
 * primary display without a window) and its source is matched by display id; macOS with Screen
 * Recording denied or restricted reports 'permission-denied' without capturing ('not-determined'
 * still captures); an empty thumbnail is 'no-screen' and a thrown error 'failed';
 * installScreenshot() answers only the Kite page's main frame and logs sizes and times only.
 */
import { describe, expect, it, vi } from 'vitest';
import { CAPTURE_SCREENSHOT_CHANNEL } from '../../src/channels';
import { captureScreenshot, installScreenshot } from '../../src/screenshot';

/** A requested thumbnail size. */
interface ThumbnailSize {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** The options the code passes to desktopCapturer.getSources(). */
interface SourceOptions {
  /** The thumbnail size asked for. */
  thumbnailSize: ThumbnailSize;
}

/** The Kite origin used in these tests. */
const ORIGIN = 'https://kite-call-assistant.vercel.app';

/**
 * A fake display.
 *
 * @param id     Display id.
 * @param width  Width in DIPs.
 * @param height Height in DIPs.
 * @param scale  Scale factor.
 * @returns The display.
 */
function display(id: number, width: number, height: number, scale = 1) {
  return { id, size: { width, height }, scaleFactor: scale };
}

/**
 * A fake desktopCapturer source whose thumbnail has the requested size.
 *
 * @param displayId The display id it shows.
 * @param empty     True for an empty image.
 * @returns A factory taking the requested size.
 */
function source(displayId: number, empty = false) {
  return (size: { width: number; height: number }) => ({
    display_id: String(displayId),
    thumbnail: {
      isEmpty: () => empty,
      getSize: () => size,
      toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    },
  });
}

/**
 * Fakes for captureScreenshot().
 *
 * @param fields Overrides.
 * @returns The deps and the getSources spy.
 */
function deps(fields: Record<string, unknown> = {}) {
  const displays = [display(1, 1920, 1080), display(2, 3840, 2160, 1)];
  const getSources = vi.fn(async (options: SourceOptions) => [
    source(1)(options.thumbnailSize),
    source(2)(options.thumbnailSize),
  ]);
  return {
    getSources,
    deps: {
      desktopCapturer: { getSources },
      screen: {
        getDisplayMatching: vi.fn(() => displays[1]!),
        getPrimaryDisplay: vi.fn(() => displays[0]!),
      },
      systemPreferences: { getMediaAccessStatus: vi.fn(() => 'granted') },
      platform: 'win32',
      window: { getBounds: () => ({ x: 4000, y: 0, width: 800, height: 600 }) },
      now: (() => {
        let t = 0;
        return () => (t += 40);
      })(),
      ...fields,
    } as never,
  };
}

describe('captureScreenshot', () => {
  it('captures the display under the window, already scaled to 1,568 px', async () => {
    const { deps: d, getSources } = deps();
    const result = await captureScreenshot(d);
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1568, height: 882 },
    });
    expect(result).toEqual({
      ok: true,
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
      width: 1568,
      height: 882,
      ms: 40,
    });
  });

  it('uses physical pixels, never upscales, and the primary display without a window', async () => {
    const small = display(1, 1280, 720, 1);
    const { deps: d, getSources } = deps({
      window: null,
      screen: { getDisplayMatching: vi.fn(), getPrimaryDisplay: () => small },
    });
    await captureScreenshot(d);
    expect(getSources.mock.calls[0]![0].thumbnailSize).toEqual({ width: 1280, height: 720 });
    const retina = display(2, 1440, 900, 2);
    const { deps: r, getSources: retinaSources } = deps({
      screen: { getDisplayMatching: () => retina, getPrimaryDisplay: vi.fn() },
    });
    await captureScreenshot(r);
    // 2880 × 1800 physical → 1568 × 980.
    expect(retinaSources.mock.calls[0]![0].thumbnailSize).toEqual({ width: 1568, height: 980 });
  });

  it('macOS: denied or restricted Screen Recording is reported without capturing', async () => {
    for (const status of ['denied', 'restricted']) {
      const { deps: d, getSources } = deps({
        platform: 'darwin',
        systemPreferences: { getMediaAccessStatus: () => status },
      });
      expect(await captureScreenshot(d)).toEqual({ ok: false, code: 'permission-denied' });
      expect(getSources).not.toHaveBeenCalled();
    }
    const { deps: d } = deps({
      platform: 'darwin',
      systemPreferences: { getMediaAccessStatus: () => 'not-determined' },
    });
    expect((await captureScreenshot(d)).ok).toBe(true);
  });

  it('reports an empty image as no-screen and a thrown error as failed', async () => {
    const empty = vi.fn(async (o: SourceOptions) => [source(2, true)(o.thumbnailSize)]);
    expect(await captureScreenshot(deps({ desktopCapturer: { getSources: empty } }).deps)).toEqual({
      ok: false,
      code: 'no-screen',
    });
    const broken = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await captureScreenshot(deps({ desktopCapturer: { getSources: broken } }).deps)).toEqual(
      {
        ok: false,
        code: 'failed',
      },
    );
  });
});

describe('installScreenshot', () => {
  it('answers the Kite page only and logs sizes and times only', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
    const { deps: d } = deps();
    installScreenshot({
      ...(d as object),
      ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) },
      getWindow: () => ({ getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }) }),
      allowedOrigin: ORIGIN,
    } as never);
    const handle = handlers.get(CAPTURE_SCREENSHOT_CHANNEL)!;
    const ok = (await handle({ senderFrame: { url: `${ORIGIN}/live/s1`, parent: null } })) as {
      ok: boolean;
    };
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(info.mock.calls)).toBe(
      JSON.stringify([['desktop: screenshot', { width: 1568, height: 882, bytes: 7, ms: 40 }]]),
    );
    await expect(
      handle({ senderFrame: { url: 'https://example.com/', parent: null } }),
    ).rejects.toThrow(/Kite page/);
  });
});
