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
 * Multiple monitors: until 1.8.1 only the display under the Kite window was captured (from v1.1.0 the overlay's
 * during a call). Mac 1.8.1 / Windows 1.7.5: the display under the mouse pointer (pickDisplay()), then the display of
 * the Paramount AI window with the keyboard, then the overlay's. Electron cannot see other apps' windows, so "the
 * active window" here is Paramount AI's own. The result names the screen (number, count), and the page may ask
 * for the next screen instead ("Wrong screen?", ScreenshotRequest.notDisplayId).
 * v1.1.0 (ADR-0043): Kite's own windows are left out of the image for the moment it is taken, so the
 * answer is about what is behind them, not about Kite.
 */
import {
  fitWithin,
  type DesktopScreenshot,
  type ScreenshotPick,
  type ScreenshotRequest,
  type ScreenshotScreen,
} from '@kite/shared';
import type {
  BrowserWindow,
  DesktopCapturer,
  Display,
  IpcMain,
  Screen,
  SystemPreferences,
} from 'electron';
import { CAPTURE_SCREENSHOT_CHANNEL } from './channels';
import { isKiteSender } from './hotkeys';

/** What captureScreenshot() needs from Electron (faked in tests). */
export interface ScreenshotDeps {
  /** Electron's desktopCapturer. */
  desktopCapturer: Pick<DesktopCapturer, 'getSources'>;
  /** Electron's screen module. */
  screen: Pick<
    Screen,
    | 'getDisplayMatching'
    | 'getPrimaryDisplay'
    | 'getAllDisplays'
    | 'getCursorScreenPoint'
    | 'getDisplayNearestPoint'
  >;
  /** Electron's systemPreferences (macOS permission status). */
  systemPreferences: Pick<SystemPreferences, 'getMediaAccessStatus'>;
  /** process.platform. */
  platform: string;
  /** The Kite window (the overlay during a call), or null when it is closed. */
  window: Pick<BrowserWindow, 'getBounds'> | null;
  /** Mac 1.8.1 / Windows 1.7.5: the Paramount AI window with the keyboard, if any (a fallback). */
  focusedWindow?: Pick<BrowserWindow, 'getBounds'> | null;
  /** Mac 1.8.1 / Windows 1.7.5: what the page asked for (absent: the screen under the pointer). */
  request?: ScreenshotRequest;
  /** Clock in ms (default performance.now). */
  now?: () => number;
}

/**
 * The displays in the order the page numbers them: from the left, then from the top (Mac 1.8.1 / Windows 1.7.5).
 * Windows' own Display settings number screens differently; "Screen 2" here always means the second from the left.
 *
 * @param displays Electron's displays.
 * @returns A sorted copy.
 * Called from: pickDisplay(); tests
 */
export function orderedDisplays(displays: readonly Display[]): Display[] {
  return [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

/**
 * Which display to capture (Mac 1.8.1 / Windows 1.7.5).
 * 1. "Wrong screen?" (request.notDisplayId): the next display after that one, in orderedDisplays() order (back to
 *    the first after the last). An id no longer connected falls through to the rules below.
 * 2. The display under the mouse pointer: the user is looking at, or just clicked on, that screen.
 * 3. The display of the Paramount AI window with the keyboard (Electron cannot see other apps' windows).
 * 4. The display of the overlay or the main window, as before 1.8.1; then the main display.
 *
 * @param deps The screen module, the windows and the request.
 * @returns The display, how it was chosen, and its place among the screens.
 * Called from: captureScreenshot(); tests
 */
export function pickDisplay(
  deps: Pick<ScreenshotDeps, 'screen' | 'window' | 'focusedWindow' | 'request'>,
): { display: Display; screen: ScreenshotScreen } {
  const all = orderedDisplays(deps.screen.getAllDisplays());
  /**
   * The result for a display chosen one way.
   *
   * @param display The display.
   * @param picked  How it was chosen.
   * @returns The display with its place among the screens.
   */
  const result = (display: Display, picked: ScreenshotPick) => {
    const at = all.findIndex((candidate) => candidate.id === display.id);
    return {
      display,
      screen: {
        id: String(display.id),
        number: at === -1 ? 1 : at + 1,
        count: Math.max(1, all.length),
        picked,
      },
    };
  };
  const skip = deps.request?.notDisplayId;
  if (skip !== undefined && all.length > 1) {
    const at = all.findIndex((candidate) => String(candidate.id) === skip);
    if (at !== -1) return result(all[(at + 1) % all.length]!, 'other');
  }
  try {
    const point = deps.screen.getCursorScreenPoint();
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return result(deps.screen.getDisplayNearestPoint(point), 'pointer');
    }
  } catch {
    // Some systems cannot report the pointer (for example Linux under Wayland): the window rules below.
  }
  if (deps.focusedWindow) {
    return result(deps.screen.getDisplayMatching(deps.focusedWindow.getBounds()), 'window');
  }
  return result(
    deps.window
      ? deps.screen.getDisplayMatching(deps.window.getBounds())
      : deps.screen.getPrimaryDisplay(),
    'overlay',
  );
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
    const { display, screen } = pickDisplay(deps);
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
      screen,
    };
  } catch {
    return { ok: false, code: 'failed' };
  }
}

/** A window hideByOpacity() can make see-through for a moment. */
export type OpacityWindow = Pick<
  BrowserWindow,
  'getOpacity' | 'setOpacity' | 'isVisible' | 'isDestroyed'
>;

/**
 * 1.8.0 (ADR-0111): leaves Kite's windows out of a screenshot on a Mac by making them fully see-through
 * for the moment it is taken, then putting back each one's own opacity (the overlay's slider sets it).
 * Windows uses setContentProtection for this (v1.1.0, ADR-0043), but on recent macOS the screen capture
 * Electron uses (ScreenCaptureKit) ignores it (Electron docs), so the answer would describe Kite itself.
 * Nothing is hidden from the Dock, the taskbar or the window list (CLAUDE.md): only the pixels, briefly.
 *
 * @param windows Every Kite window.
 * @param wait    Waits so many ms (the window server draws the change first).
 * @param settleMs How long to wait.
 * @returns The function that puts the windows back.
 * Called from: start() in main.ts (installScreenshot's hideOwnWindows, on macOS); tests
 */
export async function hideByOpacity(
  windows: readonly OpacityWindow[],
  wait: (ms: number) => Promise<void>,
  settleMs: number,
): Promise<() => void> {
  const shown = windows.filter((window) => !window.isDestroyed() && window.isVisible());
  const before = shown.map((window) => window.getOpacity());
  for (const window of shown) window.setOpacity(0);
  await wait(settleMs);
  return () => {
    shown.forEach((window, index) => {
      if (!window.isDestroyed()) window.setOpacity(before[index] ?? 1);
    });
  };
}

/** What installScreenshot() needs. */
export interface ScreenshotInstallDeps extends Omit<ScreenshotDeps, 'window'> {
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle'>;
  /** The Kite window at the time of the request (null when closed). */
  getWindow: () => Pick<BrowserWindow, 'getBounds'> | null;
  /** Mac 1.8.1 / Windows 1.7.5: the Paramount AI window with the keyboard, if any. Optional in tests. */
  getFocusedWindow?: () => Pick<BrowserWindow, 'getBounds'> | null;
  /** The Kite origin. */
  allowedOrigin: string;
  /**
   * Leaves Kite's windows out of captures until the function it returns is called (v1.1.0). Optional
   * in tests.
   */
  hideOwnWindows?: () => Promise<() => void>;
}

/**
 * Mac 1.8.1 / Windows 1.7.5: the page's request, checked: only a display id made of digits is kept.
 *
 * @param value What arrived over IPC (undefined from a page that asks nothing).
 * @returns The request (empty when there is nothing valid).
 * Called from: installScreenshot(); tests
 */
export function toScreenshotRequest(value: unknown): ScreenshotRequest {
  const id = (value as { notDisplayId?: unknown } | null | undefined)?.notDisplayId;
  return typeof id === 'string' && /^[0-9]{1,20}$/.test(id) ? { notDisplayId: id } : {};
}

/**
 * Answers the page's screenshot requests (Kite origin main frame only), logging only the size
 * and time.
 *
 * @param deps Electron objects, the window getter and the Kite origin.
 * Called from: start() in main.ts; tests
 */
export function installScreenshot(deps: ScreenshotInstallDeps): void {
  deps.ipcMain.handle(CAPTURE_SCREENSHOT_CHANNEL, async (event, value: unknown) => {
    if (!isKiteSender(event, deps.allowedOrigin)) {
      throw new Error('Screenshots can only be taken for the Kite page');
    }
    // The focused window is read before Kite's windows are hidden (hiding can move the keyboard).
    const request = toScreenshotRequest(value);
    const focusedWindow = deps.getFocusedWindow?.() ?? null;
    const restore = await deps.hideOwnWindows?.();
    const result = await captureScreenshot({
      ...deps,
      window: deps.getWindow(),
      focusedWindow,
      request,
    }).finally(() => restore?.());
    if (result.ok) {
      console.info('desktop: screenshot', {
        width: result.width,
        height: result.height,
        bytes: result.png.byteLength,
        ms: result.ms,
        // Which screen (its number and how it was chosen), never what is on it.
        screen: result.screen ? `${result.screen.number}/${result.screen.count}` : null,
        picked: result.screen?.picked ?? null,
      });
    } else {
      console.warn('desktop: screenshot failed', { code: result.code });
    }
    return result;
  });
}
