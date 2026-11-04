/**
 * File: apps/desktop/src/screenshot.ts
 * Purpose: Takes a screenshot for a screenshot answer (architecture §7.3): the display the Kite
 *          window is on (the primary display if there is no window), captured with
 *          desktopCapturer at a size already scaled so its longest side is at most 1,568 px
 *          (no full-resolution image crosses IPC; a 4K screen as PNG is 10–20 MB). Answers the
 *          Kite page only (`kite:capture-screenshot`, Kite origin main frame).
 * Used by: src/main.ts (installScreenshot)
 * Depends on: electron (desktopCapturer, screen, systemPreferences types, ipcMain),
 *             @kite/shared (fitWithin, DesktopScreenshot), src/channels.ts,
 *             src/hotkeys.ts (isKiteSender)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3, §7.3, §8 (screenshots are
 *               never stored); day-05-overlay-screenshots-notes.md Stage 1
 *
 * The image stays in memory: it is never written to disk and never logged (only its size and
 * the time taken). On macOS, desktopCapturer needs the Screen Recording permission; without it
 * macOS returns only the wallpaper, so a denied permission is reported instead of capturing.
 * Multiple monitors: only the display under the Kite window is captured (a known v1 limit); from
 * v1.1.0 that is the overlay's display during a call, because the main window sits minimised then.
 * v1.1.0 (ADR-0043): Kite's own windows are left out of the image for the moment it is taken, so the
 * answer is about what is behind them, not about Kite.
 */
import { fitWithin, type DesktopScreenshot } from '@kite/shared';
import type { BrowserWindow, DesktopCapturer, IpcMain, Screen, SystemPreferences } from 'electron';
import { CAPTURE_SCREENSHOT_CHANNEL } from './channels';
import { isKiteSender } from './hotkeys';

/** What captureScreenshot() needs from Electron (faked in tests). */
export interface ScreenshotDeps {
  /** Electron's desktopCapturer. */
  desktopCapturer: Pick<DesktopCapturer, 'getSources'>;
  /** Electron's screen module. */
  screen: Pick<Screen, 'getDisplayMatching' | 'getPrimaryDisplay'>;
  /** Electron's systemPreferences (macOS permission status). */
  systemPreferences: Pick<SystemPreferences, 'getMediaAccessStatus'>;
  /** process.platform. */
  platform: string;
  /** The Kite window, or null when it is closed. */
  window: Pick<BrowserWindow, 'getBounds'> | null;
  /** Clock in ms (default performance.now). */
  now?: () => number;
}

/**
 * Takes the screenshot.
 *
 * @param deps Electron objects, the platform and the Kite window.
 * @returns The PNG (scaled) with its size and the time taken, or a failure code.
 * Called from: installScreenshot(); tests
 */
export async function captureScreenshot(deps: ScreenshotDeps): Promise<DesktopScreenshot> {
  const now = deps.now ?? (() => performance.now());
  const startedAt = now();
  // macOS: 'not-determined' still captures (macOS asks the user); denied or restricted would
  // only give the wallpaper, so say so instead.
  if (deps.platform === 'darwin') {
    const status = deps.systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted')
      return { ok: false, code: 'permission-denied' };
  }
  try {
    const display = deps.window
      ? deps.screen.getDisplayMatching(deps.window.getBounds())
      : deps.screen.getPrimaryDisplay();
    // Physical pixels, then scaled down: desktopCapturer makes the thumbnail at this size.
    const size = fitWithin({
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    });
    const sources = await deps.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: size,
    });
    const source =
      sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return { ok: false, code: 'no-screen' };
    const actual = source.thumbnail.getSize();
    const png = new Uint8Array(source.thumbnail.toPNG());
    return {
      ok: true,
      png,
      width: actual.width,
      height: actual.height,
      ms: Math.round(now() - startedAt),
    };
  } catch {
    return { ok: false, code: 'failed' };
  }
}

/** What installScreenshot() needs. */
export interface ScreenshotInstallDeps extends Omit<ScreenshotDeps, 'window'> {
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle'>;
  /** The Kite window at the time of the request (null when closed). */
  getWindow: () => Pick<BrowserWindow, 'getBounds'> | null;
  /** The Kite origin. */
  allowedOrigin: string;
  /**
   * Leaves Kite's windows out of captures until the function it returns is called (v1.1.0). Optional
   * in tests.
   */
  hideOwnWindows?: () => Promise<() => void>;
}

/**
 * Answers the page's screenshot requests (Kite origin main frame only), logging only the size
 * and time.
 *
 * @param deps Electron objects, the window getter and the Kite origin.
 * Called from: start() in main.ts; tests
 */
export function installScreenshot(deps: ScreenshotInstallDeps): void {
  deps.ipcMain.handle(CAPTURE_SCREENSHOT_CHANNEL, async (event) => {
    if (!isKiteSender(event, deps.allowedOrigin)) {
      throw new Error('Screenshots can only be taken for the Kite page');
    }
    const restore = await deps.hideOwnWindows?.();
    const result = await captureScreenshot({ ...deps, window: deps.getWindow() }).finally(() =>
      restore?.(),
    );
    if (result.ok) {
      console.info('desktop: screenshot', {
        width: result.width,
        height: result.height,
        bytes: result.png.byteLength,
        ms: result.ms,
      });
    } else {
      console.warn('desktop: screenshot failed', { code: result.code });
    }
    return result;
  });
}
