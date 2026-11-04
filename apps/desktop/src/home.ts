/**
 * File: apps/desktop/src/home.ts
 * Purpose: The home panel, the desktop app's default window between calls (v1.1.0, ADR-0041): a small
 *          frameless window on /home with the session list. It remembers its place, keeps itself on
 *          the pages it can show (sign-in returns here, never to the dashboard at 400 px wide), and
 *          reports when the web app has no /home (the web app was rolled back to a version before
 *          1.1.0): the app then opens the main window, as a 1.0.x shell does.
 * Used by: src/main.ts
 * Depends on: electron (BrowserWindow, Screen types), src/security.ts (secureWebPreferences),
 *             src/store.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.3; ADR-0041
 *
 * It stays in the taskbar and Alt+Tab like any window (never hidden: CLAUDE.md).
 */
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, Screen } from 'electron';
import { secureWebPreferences } from './security';
import type { Bounds, ShellStore } from './store';

/** The panel's default size, in DIPs. */
export const HOME_DEFAULT_SIZE = { width: 400, height: 560 };

/** The panel's smallest size, in DIPs: the session cards and the bottom buttons still fit. */
export const HOME_MIN_SIZE = { width: 360, height: 420 };

/** Distance from the screen's edge when the panel is placed by default, in DIPs. */
const HOME_MARGIN = 24;

/** How long after the last move or resize the place is saved, in ms. */
const SAVE_DELAY_MS = 500;

/**
 * The pages the panel can show. Anything else (the dashboard, after signing in) goes back to /home:
 * those pages are built for a large window, and open in the main window from here.
 */
const HOME_PATHS: readonly string[] = ['/home', '/login', '/change-password'];

/**
 * Whether the panel may stay on a page.
 *
 * @param pathname A page's path.
 * @returns True for /home and the sign-in pages.
 * Called from: createHomeWindow(); tests
 */
export function homeAllowsPath(pathname: string): boolean {
  return HOME_PATHS.includes(pathname);
}

/**
 * The panel's default place: at the right of the work area, centred from top to bottom, out of the
 * way of a meeting window (shrunk to fit a small screen).
 *
 * @param area The primary display's work area.
 * @returns The bounds, in whole DIPs.
 * Called from: createHomeWindow(); tests
 */
export function homeDefaultBounds(area: Rectangle): Bounds {
  const width = Math.min(HOME_DEFAULT_SIZE.width, area.width);
  const height = Math.min(HOME_DEFAULT_SIZE.height, area.height);
  return {
    x: area.x + Math.max(0, area.width - width - HOME_MARGIN),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

/**
 * The panel's saved place if it is still on a screen (a monitor may have been unplugged), otherwise
 * its default place.
 *
 * @param saved     The saved bounds, if any.
 * @param workAreas Every display's work area.
 * @param primary   The primary display's work area.
 * @returns The bounds.
 * Called from: createHomeWindow(); tests
 */
export function homeBounds(
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
  return homeDefaultBounds(primary);
}

/**
 * The panel's window options: frameless (the page draws its own header and buttons), resizable, not
 * maximisable, hidden until painted, with the same secure web preferences as every Kite window.
 *
 * @param bounds      Where to open it.
 * @param preloadPath The preload script (window.kiteDesktop).
 * @param appVersion  The shell version (for the bridge).
 * @returns BrowserWindow options.
 * Called from: createHomeWindow(); tests
 */
export function homeWindowOptions(
  bounds: Bounds,
  preloadPath: string,
  appVersion: string,
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    minWidth: HOME_MIN_SIZE.width,
    minHeight: HOME_MIN_SIZE.height,
    title: 'Kite',
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    // Visible in the taskbar and Alt+Tab like any window (never hidden: CLAUDE.md).
    skipTaskbar: false,
    show: false,
    webPreferences: secureWebPreferences(preloadPath, appVersion),
  };
}

/** What createHomeWindow() needs. */
export interface HomeDeps {
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
  /** Remembers the panel's place. */
  store: ShellStore;
  /** The web app has no /home (it was rolled back): the app opens the main window instead. */
  onUnavailable: () => void;
  /** The panel has closed for good (the app is quitting, or it was unavailable). */
  onClosed?: () => void;
}

/** The home panel. */
export interface HomeWindow {
  /** Opens the panel if needed and brings it forward with focus. */
  open(): void;
  /** Shows the panel again without taking focus (a call ended, behind the call's review). */
  showInactive(): void;
  /** Hides the panel (a call started: it stays out of the way until the call ends). */
  hide(): void;
  /** The open window, or null. */
  window(): BrowserWindow | null;
}

/**
 * Creates the home panel's controller.
 *
 * @param deps See HomeDeps.
 * @returns The controller.
 * Called from: start() in main.ts; tests
 */
export function createHomeWindow(deps: HomeDeps): HomeWindow {
  let current: BrowserWindow | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const homeUrl = new URL('/home', deps.kiteUrl).toString();

  /**
   * Keeps the panel on its own pages, and reports a web app that has no /home.
   *
   * @param window The panel's window.
   * @param url    The page it arrived at.
   * @param status The HTTP status (absent for a navigation inside the page).
   */
  const onArrived = (window: BrowserWindow, url: string, status?: number) => {
    const { pathname } = new URL(url);
    if (pathname === '/home' && status === 404) {
      deps.onUnavailable();
      window.destroy();
      return;
    }
    if (!homeAllowsPath(pathname)) void window.loadURL(homeUrl);
  };

  /**
   * Creates the window.
   *
   * @returns The window.
   */
  const create = (): BrowserWindow => {
    const settings = deps.store.read();
    const window = deps.createWindow(
      homeWindowOptions(
        homeBounds(
          settings.homeBounds,
          deps.screen.getAllDisplays().map((display) => display.workArea),
          deps.screen.getPrimaryDisplay().workArea,
        ),
        deps.preloadPath,
        deps.appVersion,
      ),
    );
    current = window;
    window.once('ready-to-show', () => window.show());
    const later = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!window.isDestroyed()) deps.store.write({ homeBounds: window.getBounds() });
      }, SAVE_DELAY_MS);
    };
    window.on('moved', later);
    window.on('resized', later);
    window.on('closed', () => {
      if (saveTimer) clearTimeout(saveTimer);
      if (current === window) current = null;
      deps.onClosed?.();
    });
    window.webContents.on('did-navigate', (_event, url, status) => onArrived(window, url, status));
    window.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) onArrived(window, url);
    });
    void window.loadURL(homeUrl);
    return window;
  };

  return {
    open() {
      if (!current || current.isDestroyed()) {
        create();
        return;
      }
      if (current.isMinimized()) current.restore();
      current.show();
      current.focus();
    },
    showInactive() {
      if (current && !current.isDestroyed()) current.showInactive();
    },
    hide() {
      if (current && !current.isDestroyed()) current.hide();
    },
    window: () => (current && !current.isDestroyed() ? current : null),
  };
}
