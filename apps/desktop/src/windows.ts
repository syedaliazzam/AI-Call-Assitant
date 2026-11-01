/**
 * File: apps/desktop/src/windows.ts
 * Purpose: The compact live window (architecture §7.3): frameless, always on top, resizable,
 *          shown without taking focus from the meeting (showInactive), at its last position and
 *          size; loads /compact/[id] from the Kite origin only; screen-share
 *          protection applied (protection.ts). Opened and closed by the Kite page over IPC
 *          (`kite:open-compact`, `kite:close-compact`), and closed with the main window.
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
import { CLOSE_COMPACT_CHANNEL, OPEN_COMPACT_CHANNEL } from './channels';
import { isKiteSender } from './hotkeys';
import type { Protection } from './protection';
import { secureWebPreferences } from './security';
import type { Bounds, ShellStore } from './store';

/** The compact window's default size, in DIPs. */
export const COMPACT_DEFAULT_SIZE = { width: 380, height: 320 };

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
    minWidth: 280,
    minHeight: 180,
    title: 'Kite (compact)',
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    // Visible in the taskbar and Alt+Tab like any window (never hidden: CLAUDE.md).
    skipTaskbar: false,
    show: false,
    backgroundColor: '#ffffff',
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

  /** Saves the window's position and size. */
  const save = () => {
    if (current && !current.isDestroyed()) deps.store.write({ compactBounds: current.getBounds() });
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
      });
      void window.loadURL(url);
      return true;
    },
    close() {
      if (current && !current.isDestroyed()) current.close();
    },
    window: () => (current && !current.isDestroyed() ? current : null),
  };
}

/**
 * Answers the Kite page's compact-window requests (Kite origin main frames only).
 *
 * @param ipcMain       Electron's ipcMain.
 * @param compact       The controller.
 * @param allowedOrigin The Kite origin.
 * Called from: start() in main.ts; tests
 */
export function installCompactWindows(
  ipcMain: Pick<IpcMain, 'handle'>,
  compact: CompactWindows,
  allowedOrigin: string,
): void {
  ipcMain.handle(OPEN_COMPACT_CHANNEL, (event, sessionId: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can open it');
    if (!compact.open(sessionId)) throw new Error('Not a session id');
  });
  ipcMain.handle(CLOSE_COMPACT_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can close it');
    compact.close();
  });
}
