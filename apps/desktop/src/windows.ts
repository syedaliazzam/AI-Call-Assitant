/**
 * File: apps/desktop/src/windows.ts
 * Purpose: The overlay, the compact live window (architecture §7.3; ADR-0029): frameless, always
 *          on top, resizable, shown without taking focus from the meeting (showInactive), at its
 *          last position and size; loads /compact/[id] from the Kite origin only; screen-share
 *          protection applied (protection.ts). Opened and closed by the Kite page over IPC
 *          (`kite:open-compact`, `kite:close-compact`), and closed with the main window. The page
 *          sets its opacity and collapses it; global shortcuts show, hide and move it. Closing
 *          it brings back the main window, which a call may have minimised.
 * Used by: src/main.ts
 * Depends on: electron (BrowserWindow, Screen, IpcMain types), src/security.ts
 *             (secureWebPreferences), src/protection.ts, src/store.ts, src/channels.ts,
 *             src/hotkeys.ts (isKiteSender)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §7.3 (windows.ts);
 *               day-05-overlay-screenshots-notes.md Stage 3
 *
 * Focus: the window appears and updates without taking focus (showInactive; the page's updates
 * never call focus()), so the meeting keeps the keyboard. Clicking into it focuses it like any
 * window, so its chat box takes typing. It stays in the taskbar and Alt+Tab.
 */
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  Rectangle,
  Screen,
} from 'electron';
import type { GlobalHotkey } from '@kite/shared';
import {
  CLOSE_COMPACT_CHANNEL,
  MINIMIZE_MAIN_CHANNEL,
  OPEN_COMPACT_CHANNEL,
  OVERLAY_COLLAPSE_CHANNEL,
  OVERLAY_OPACITY_CHANNEL,
} from './channels';
import { isKiteSender } from './hotkeys';
import type { Protection } from './protection';
import { secureWebPreferences } from './security';
import type { Bounds, ShellStore } from './store';

/** The overlay's default size, in DIPs: three bars with readable 16–18 px text. */
export const COMPACT_DEFAULT_SIZE = { width: 720, height: 520 };

/** The overlay's smallest size, in DIPs. */
export const COMPACT_MIN_SIZE = { width: 460, height: 260 };

/** The overlay's height when collapsed to its controls bar, in DIPs. */
export const COMPACT_COLLAPSED_HEIGHT = 60;

/** The overlay's opacity range: below this the text is no longer readable. */
export const OVERLAY_OPACITY_RANGE = { min: 0.35, max: 1 };

/** How far a move shortcut moves the overlay, in DIPs (with Shift: the big step). */
export const OVERLAY_STEP = { small: 20, big: 100 };

/** Distance from the screen edge when the window is placed by default, in DIPs. */
const EDGE_MARGIN = 24;

/** How long after the last move or resize the position is saved, in ms. */
const SAVE_DELAY_MS = 500;

/**
 * The compact view's URL for a session, or null when the id is not a plain id (so nothing but
 * the Kite page's own route can ever be loaded).
 *
 * @param kiteUrl   The Kite URL (config).
 * @param sessionId The session id from the page.
 * @returns The URL, for example https://…/compact/abc.
 * Called from: createCompactWindows(); tests
 */
export function compactUrl(kiteUrl: string, sessionId: unknown): string | null {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return null;
  return new URL(`/compact/${sessionId}`, kiteUrl).toString();
}

/**
 * Where to open the window: the saved bounds if they still overlap a screen's work area by at
 * least 80 × 40 DIPs (a monitor may have been unplugged), otherwise the default size at the
 * bottom right of the primary screen.
 *
 * @param saved     The saved bounds, if any.
 * @param workAreas Every display's work area.
 * @param primary   The primary display's work area.
 * @returns The bounds.
 * Called from: createCompactWindows(); tests
 */
export function restoreBounds(
  saved: Bounds | undefined,
  workAreas: readonly Rectangle[],
  primary: Rectangle,
): Bounds {
  if (saved) {
    const visible = workAreas.some((area) => {
      const width =
        Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
      const height =
        Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y);
      return width >= 80 && height >= 40;
    });
    if (visible) return saved;
  }
  return {
    width: COMPACT_DEFAULT_SIZE.width,
    height: COMPACT_DEFAULT_SIZE.height,
    x: primary.x + primary.width - COMPACT_DEFAULT_SIZE.width - EDGE_MARGIN,
    y: primary.y + primary.height - COMPACT_DEFAULT_SIZE.height - EDGE_MARGIN,
  };
}

/**
 * The compact window's options.
 *
 * @param bounds      Where to open it.
 * @param preloadPath The preload script (window.kiteDesktop).
 * @param appVersion  The shell version (for the bridge).
 * @returns BrowserWindow options: frameless, always on top, resizable, hidden until shown
 *          without focus, with the same secure web preferences as the main window.
 * Called from: createCompactWindows(); tests
 */
export function compactWindowOptions(
  bounds: Bounds,
  preloadPath: string,
  appVersion: string,
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    minWidth: COMPACT_MIN_SIZE.width,
    minHeight: COMPACT_MIN_SIZE.height,
    title: 'Kite (overlay)',
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    // Visible in the taskbar and Alt+Tab like any window (never hidden: CLAUDE.md).
    skipTaskbar: false,
    show: false,
    // Kite's dark navy, so opening the overlay never flashes white over the meeting.
    backgroundColor: '#0b1630',
    webPreferences: secureWebPreferences(preloadPath, appVersion),
  };
}

/** What createCompactWindows() needs. */
export interface CompactDeps {
  /** Creates a window (new BrowserWindow in the app; a fake in tests). */
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  /** Electron's screen module. */
  screen: Pick<Screen, 'getAllDisplays' | 'getPrimaryDisplay'>;
  /** The Kite URL. */
  kiteUrl: string;
  /** The preload script path. */
  preloadPath: string;
  /** The shell version. */
  appVersion: string;
  /** Remembered position and size. */
  store: ShellStore;
  /** Screen-share protection. */
  protection: Protection;
  /** Called when the overlay has closed (brings back the main window). Optional in tests. */
  onClosed?: () => void;
}

/** The compact window. */
export interface CompactWindows {
  /**
   * Opens the window for a session (or shows the open one, switching session if needed),
   * without taking focus.
   *
   * @param sessionId The session id.
   * @returns False when the id is not a plain id.
   */
  open(sessionId: unknown): boolean;
  /** Closes it, if open. */
  close(): void;
  /** The open window, or null. */
  window(): BrowserWindow | null;
  /** Hides the overlay if it is showing; shows it again, without taking focus, if hidden. */
  toggle(): void;
  /**
   * Moves the overlay.
   *
   * @param dx Pixels to the right (negative: left).
   * @param dy Pixels down (negative: up).
   */
  move(dx: number, dy: number): void;
  /**
   * Sets the overlay's opacity, kept to a readable range.
   *
   * @param value What the page asked for.
   */
  setOpacity(value: unknown): void;
  /**
   * Collapses the overlay to its controls bar, or opens it to the size it had.
   *
   * @param collapsed True to collapse.
   */
  setCollapsed(collapsed: boolean): void;
}

/**
 * The overlay's movement for a shortcut, or null when it is not a move.
 *
 * @param action The global shortcut.
 * @returns The pixels to move by.
 * Called from: overlayShortcut(); tests
 */
export function overlayMove(action: GlobalHotkey): { dx: number; dy: number } | null {
  const match = /^overlay-(up|down|left|right)(-big)?$/.exec(action);
  if (!match) return null;
  const step = match[2] ? OVERLAY_STEP.big : OVERLAY_STEP.small;
  if (match[1] === 'up') return { dx: 0, dy: -step };
  if (match[1] === 'down') return { dx: 0, dy: step };
  if (match[1] === 'left') return { dx: -step, dy: 0 };
  return { dx: step, dy: 0 };
}

/**
 * Carries out an overlay shortcut.
 *
 * @param compact The controller.
 * @param action  The shortcut.
 * Called from: start() in main.ts (installHotkeys' overlayAction); tests
 */
export function overlayShortcut(compact: CompactWindows, action: GlobalHotkey): void {
  if (action === 'overlay-toggle') {
    compact.toggle();
    return;
  }
  const move = overlayMove(action);
  if (move) compact.move(move.dx, move.dy);
}

/**
 * Creates the compact window controller.
 *
 * @param deps Window factory, screen, URL, preload, store and protection.
 * @returns The controller.
 * Called from: start() in main.ts; tests
 */
export function createCompactWindows(deps: CompactDeps): CompactWindows {
  let current: BrowserWindow | null = null;
  let loadedUrl = '';
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The height to go back to when the overlay opens again; null while it is open. */
  let heightBeforeCollapse: number | null = null;

  /** Saves the window's position and size (the open size, also while collapsed). */
  const save = () => {
    if (!current || current.isDestroyed()) return;
    const bounds = current.getBounds();
    deps.store.write({
      compactBounds:
        heightBeforeCollapse === null ? bounds : { ...bounds, height: heightBeforeCollapse },
    });
  };

  return {
    open(sessionId) {
      const url = compactUrl(deps.kiteUrl, sessionId);
      if (!url) return false;
      if (current && !current.isDestroyed()) {
        if (url !== loadedUrl) {
          loadedUrl = url;
          void current.loadURL(url);
        }
        current.showInactive();
        return true;
      }
      const displays = deps.screen.getAllDisplays();
      const bounds = restoreBounds(
        deps.store.read().compactBounds,
        displays.map((display) => display.workArea),
        deps.screen.getPrimaryDisplay().workArea,
      );
      const window = deps.createWindow(
        compactWindowOptions(bounds, deps.preloadPath, deps.appVersion),
      );
      current = window;
      loadedUrl = url;
      // Above normal windows, including a maximised meeting window.
      window.setAlwaysOnTop(true, 'floating');
      deps.protection.attach(window);
      // Shown without focus: the meeting keeps the keyboard.
      window.once('ready-to-show', () => window.showInactive());
      const later = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(save, SAVE_DELAY_MS);
      };
      window.on('moved', later);
      window.on('resized', later);
      window.on('close', save);
      window.on('closed', () => {
        if (saveTimer) clearTimeout(saveTimer);
        if (current === window) current = null;
        heightBeforeCollapse = null;
        deps.onClosed?.();
      });
      void window.loadURL(url);
      return true;
    },
    close() {
      if (current && !current.isDestroyed()) current.close();
    },
    window: () => (current && !current.isDestroyed() ? current : null),
    toggle() {
      if (!current || current.isDestroyed()) return;
      if (current.isVisible()) current.hide();
      else current.showInactive();
    },
    move(dx, dy) {
      if (!current || current.isDestroyed()) return;
      const [x = 0, y = 0] = current.getPosition();
      current.setPosition(x + dx, y + dy);
    },
    setOpacity(value) {
      if (!current || current.isDestroyed() || typeof value !== 'number' || Number.isNaN(value)) {
        return;
      }
      const { min, max } = OVERLAY_OPACITY_RANGE;
      current.setOpacity(Math.min(max, Math.max(min, value)));
    },
    setCollapsed(collapsed) {
      if (!current || current.isDestroyed()) return;
      const bounds = current.getBounds();
      if (collapsed && heightBeforeCollapse === null) {
        heightBeforeCollapse = bounds.height;
        current.setMinimumSize(COMPACT_MIN_SIZE.width, COMPACT_COLLAPSED_HEIGHT);
        current.setBounds({ ...bounds, height: COMPACT_COLLAPSED_HEIGHT });
      } else if (!collapsed && heightBeforeCollapse !== null) {
        const height = heightBeforeCollapse;
        heightBeforeCollapse = null;
        current.setBounds({ ...bounds, height });
        current.setMinimumSize(COMPACT_MIN_SIZE.width, COMPACT_MIN_SIZE.height);
      }
    },
  };
}

/**
 * Answers the Kite page's compact-window requests (Kite origin main frames only).
 *
 * @param ipcMain       Electron's ipcMain.
 * @param compact       The controller.
 * @param allowedOrigin The Kite origin.
 * @param minimizeMain  Minimises the main window (a call starting in the overlay).
 * Called from: start() in main.ts; tests
 */
export function installCompactWindows(
  ipcMain: Pick<IpcMain, 'handle'>,
  compact: CompactWindows,
  allowedOrigin: string,
  minimizeMain: () => void = () => undefined,
): void {
  ipcMain.handle(OPEN_COMPACT_CHANNEL, (event, sessionId: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can open it');
    if (!compact.open(sessionId)) throw new Error('Not a session id');
  });
  ipcMain.handle(CLOSE_COMPACT_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can close it');
    compact.close();
  });
  ipcMain.handle(OVERLAY_OPACITY_CHANNEL, (event, opacity: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    compact.setOpacity(opacity);
  });
  ipcMain.handle(OVERLAY_COLLAPSE_CHANNEL, (event, collapsed: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    compact.setCollapsed(collapsed === true);
  });
  ipcMain.handle(MINIMIZE_MAIN_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can do this');
    // Only with the overlay open: never leave the user with no Kite window in view.
    if (compact.window()) minimizeMain();
  });
}
