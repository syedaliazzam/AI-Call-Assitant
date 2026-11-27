/**
 * Tests for apps/desktop/src/screenshot.ts, with desktopCapturer, screen and systemPreferences
 * faked: the thumbnail is requested already scaled to ≤ 1,568 px on the long side from the
 * display's physical size (never upscaled); the display under the Kite window is used (the
 * primary display without a window) and its source is matched by display id; macOS with Screen
 * Recording denied or restricted reports 'permission-denied' without capturing ('not-determined'
 * still captures); an empty thumbnail is 'no-screen' and a thrown error 'failed';
 * installScreenshot() answers only the Kite page's main frame and logs sizes and times only.
 * 1.8.0 (ADR-0111): hideByOpacity() makes the shown windows see-through for the moment, then puts back
 * each one's own opacity. Mac 1.8.1 / Windows 1.7.5: the display under the mouse pointer is captured (then the
 * focused Paramount AI window's, then the overlay's, then the main display), the result names the screen
 * (numbered from the left), "Wrong screen?" takes the next one, and only a display id of digits is accepted.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScreenshotScreen } from '@kite/shared';
import type { Display } from 'electron';
import { CAPTURE_SCREENSHOT_CHANNEL } from '../../src/channels';
import {
  captureScreenshot,
  hideByOpacity,
  installScreenshot,
  orderedDisplays,
  pickDisplay,
  toScreenshotRequest,
} from '../../src/screenshot';

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
 * @param x      Its left edge in the desktop (DIPs).
 * @param y      Its top edge in the desktop (DIPs).
 * @returns The display.
 */
function display(id: number, width: number, height: number, scale = 1, x = 0, y = 0) {
  return { id, size: { width, height }, scaleFactor: scale, bounds: { x, y, width, height } };
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
  // Screen 2 (id 2) is to the right of screen 1 (id 1); the pointer is on screen 2.
  const displays = [display(2, 3840, 2160, 1, 1920, 0), display(1, 1920, 1080)];
  const getSources = vi.fn(async (options: SourceOptions) => [
    source(1)(options.thumbnailSize),
    source(2)(options.thumbnailSize),
  ]);
  return {
    getSources,
    deps: {
      desktopCapturer: { getSources },
      screen: {
        getAllDisplays: () => displays,
        getCursorScreenPoint: () => ({ x: 2500, y: 300 }),
        getDisplayNearestPoint: vi.fn((point: { x: number }) =>
          point.x >= 1920 ? displays[0]! : displays[1]!,
        ),
        getDisplayMatching: vi.fn(() => displays[0]!),
        getPrimaryDisplay: vi.fn(() => displays[1]!),
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
  it('captures the display under the pointer, already scaled to 1,568 px, and names it', async () => {
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
      screen: { id: '2', number: 2, count: 2, picked: 'pointer' },
    });
  });

  it('uses physical pixels and never upscales', async () => {
    const small = display(1, 1280, 720, 1);
    const one = (only: ReturnType<typeof display>) => ({
      getAllDisplays: () => [only],
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => only,
      getDisplayMatching: () => only,
      getPrimaryDisplay: () => only,
    });
    const { deps: d, getSources } = deps({ screen: one(small) });
    expect(((await captureScreenshot(d)) as { screen?: unknown }).screen).toEqual({
      id: '1',
      number: 1,
      count: 1,
      picked: 'pointer',
    });
    expect(getSources.mock.calls[0]![0].thumbnailSize).toEqual({ width: 1280, height: 720 });
    const retina = display(2, 1440, 900, 2);
    const { deps: r, getSources: retinaSources } = deps({ screen: one(retina) });
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

describe('pickDisplay (Mac 1.8.1 / Windows 1.7.5)', () => {
  const left = display(10, 1920, 1080, 1, 0, 0);
  const right = display(20, 1920, 1080, 1, 1920, 0);
  const above = display(30, 1920, 1080, 1, 1920, -1080);
  /**
   * The screen module with three displays and a pointer.
   *
   * @param pointer Where the pointer is, or an error to throw.
   * @returns The fake.
   */
  const screen = (pointer: { x: number; y: number } | Error) => ({
    getAllDisplays: () => [right, above, left],
    getCursorScreenPoint: () => {
      if (pointer instanceof Error) throw pointer;
      return pointer;
    },
    getDisplayNearestPoint: (point: { x: number; y: number }) =>
      point.x < 1920 ? left : point.y < 0 ? above : right,
    getDisplayMatching: (bounds: { x: number }) => (bounds.x < 1920 ? left : right),
    getPrimaryDisplay: () => left,
  });
  const at = (x: number) => ({ getBounds: () => ({ x, y: 0, width: 10, height: 10 }) });

  it('numbers the screens from the left, then from the top', () => {
    expect(
      orderedDisplays([right, above, left] as unknown as Display[]).map((one) => one.id),
    ).toEqual([10, 30, 20]);
  });

  it('takes the screen under the pointer, whichever window has the keyboard', () => {
    const picked = pickDisplay({
      screen: screen({ x: 2000, y: -500 }) as never,
      window: at(0),
      focusedWindow: at(0),
    });
    expect(picked.screen).toEqual({ id: '30', number: 2, count: 3, picked: 'pointer' });
  });

  it('without the pointer: the focused Paramount AI window, then the overlay, then the main display', () => {
    const noPointer = screen(new Error('no pointer')) as never;
    expect(
      pickDisplay({ screen: noPointer, window: at(0), focusedWindow: at(3000) }).screen,
    ).toEqual({ id: '20', number: 3, count: 3, picked: 'window' });
    expect(
      pickDisplay({ screen: noPointer, window: at(3000), focusedWindow: null }).screen,
    ).toEqual({
      id: '20',
      number: 3,
      count: 3,
      picked: 'overlay',
    });
    expect(pickDisplay({ screen: noPointer, window: null }).screen.id).toBe('10');
  });

  it('"Wrong screen?": the next screen after the one named, back to the first after the last', () => {
    const s = screen({ x: 10, y: 10 }) as never;
    const next = (notDisplayId: string) =>
      pickDisplay({ screen: s, window: null, request: { notDisplayId } }).screen;
    expect(next('10')).toEqual({ id: '30', number: 2, count: 3, picked: 'other' });
    expect(next('30').id).toBe('20');
    expect(next('20').id).toBe('10');
    // A screen no longer connected: the pointer's.
    expect(next('99')).toMatchObject({ id: '10', picked: 'pointer' });
  });

  it('accepts only a display id of digits from the page', () => {
    expect(toScreenshotRequest(undefined)).toEqual({});
    expect(toScreenshotRequest({ notDisplayId: '2779098405' })).toEqual({
      notDisplayId: '2779098405',
    });
    expect(toScreenshotRequest({ notDisplayId: '../x' })).toEqual({});
    expect(toScreenshotRequest({ notDisplayId: 5 })).toEqual({});
    expect(toScreenshotRequest({ notDisplayId: '1'.repeat(21) })).toEqual({});
  });
});

describe('installScreenshot', () => {
  it('answers the Kite page only and logs sizes and times only', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const handlers = new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>();
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
      JSON.stringify([
        [
          'desktop: screenshot',
          { width: 1568, height: 882, bytes: 7, ms: 40, screen: '2/2', picked: 'pointer' },
        ],
      ]),
    );
    // "Wrong screen?": the page's request reaches the choice.
    const other = (await handle(
      { senderFrame: { url: `${ORIGIN}/live/s1`, parent: null } },
      { notDisplayId: '2' },
    )) as { screen?: Pick<ScreenshotScreen, 'id' | 'picked'> };
    expect(other.screen).toMatchObject({ id: '1', picked: 'other' });
    await expect(
      handle({ senderFrame: { url: 'https://example.com/', parent: null } }),
    ).rejects.toThrow(/Kite page/);
  });
});

describe('hideByOpacity (ADR-0111)', () => {
  /**
   * A fake window with an opacity.
   *
   * @param opacity Its opacity.
   * @param visible Whether it is shown.
   * @returns The fake.
   */
  const fakeWindow = (opacity: number, visible = true) => {
    let current = opacity;
    return {
      getOpacity: () => current,
      setOpacity: vi.fn((value: number) => {
        current = value;
      }),
      isVisible: () => visible,
      isDestroyed: () => false,
    };
  };

  it('makes the shown windows see-through while it waits, then puts back each one\u2019s own opacity', async () => {
    const overlay = fakeWindow(0.7);
    const panel = fakeWindow(1);
    const hidden = fakeWindow(1, false);
    const wait = vi.fn(async () => {
      expect(overlay.getOpacity()).toBe(0);
      expect(panel.getOpacity()).toBe(0);
    });
    const restore = await hideByOpacity([overlay, panel, hidden], wait, 120);
    expect(wait).toHaveBeenCalledWith(120);
    expect(hidden.setOpacity).not.toHaveBeenCalled();
    restore();
    expect(overlay.getOpacity()).toBe(0.7);
    expect(panel.getOpacity()).toBe(1);
  });
});
