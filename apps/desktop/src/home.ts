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
import { APP_NAME } from './config';
import { secureWebPreferences } from './security';
import type { Bounds, ShellStore } from './store';

/** The panel's default size, in DIPs. */
export const HOME_DEFAULT_SIZE = { width: 400, height: 560 };

/** The panel's smallest size, in DIPs: the session cards and the bottom buttons still fit. */
export const HOME_MIN_SIZE = { width: 360, height: 420 };

/** The largest size the page may ask for (ADR-0055: the cards are drawn for about 560 × 720). */
export const HOME_MAX_SIZE = { width: 720, height: 900 };

/** Distance from the screen's edge when the panel is placed by default, in DIPs. */
const HOME_MARGIN = 24;

/** How long after the last move or resize the place is saved, in ms. */
const SAVE_DELAY_MS = 500;

/**
 * The pages the panel can show. Anything else (the dashboard, after signing in) goes back to /home:
 * those pages are built for a large window, and open in the main window from here. /desktop/link
 * (v1.3.0, ADR-0052) signs the app in with a link's one-time code, then goes to /home.
 */
const HOME_PATHS: readonly string[] = ['/home', '/login', '/change-password', '/desktop/link'];

/** How long a link's one-time code is kept for the page, in ms: the server accepts it for 60 s. */
export const LINK_CODE_KEEP_MS = 60_000;

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
 * The panel's bounds for a size the page asked for (ADR-0055): the size kept between the smallest and
 * largest allowed and inside the screen's work area; the right edge and the vertical centre stay where
 * they were (the panel sits at the right of the screen), then the whole window is kept on the screen.
 *
 * @param current The panel's bounds now.
 * @param size    The size asked for.
 * @param area    The work area of the screen the panel is on.
 * @returns The new bounds, in whole DIPs.
 * Called from: createHomeWindow() (resize); tests
 */
export function panelSizeBounds(
  current: Bounds,
  size: { width: number; height: number },
  area: Rectangle,
): Bounds {
  const clamp = (value: number, min: number, max: number) =>
    Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
  const width = Math.min(clamp(size.width, HOME_MIN_SIZE.width, HOME_MAX_SIZE.width), area.width);
  const height = Math.min(
    clamp(size.height, HOME_MIN_SIZE.height, HOME_MAX_SIZE.height),
    area.height - 2 * HOME_MARGIN > HOME_MIN_SIZE.height
      ? area.height - 2 * HOME_MARGIN
      : area.height,
  );
  const right = current.x + current.width;
  const middle = current.y + current.height / 2;
  const x = clamp(right - width, area.x, area.x + area.width - width);
  const y = clamp(middle - height / 2, area.y, area.y + area.height - height);
  return { x, y, width, height };
}

/**
 * Whether a value from the page is a size (two finite positive numbers).
 *
 * @param value What arrived over IPC.
 * @returns True for { width, height }.
 * Called from: main.ts; tests
 */
export function isPanelSize(value: unknown): value is { width: number; height: number } {
  if (typeof value !== 'object' || value === null) return false;
  const { width, height } = value as Record<string, unknown>;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
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
    title: APP_NAME,
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
  /** The clock, in ms (tests pass one; default Date.now). */
  now?: () => number;
}

/** The home panel. */
export interface HomeWindow {
  /** Opens the panel if needed and brings it forward with focus. */
  open(): void;
  /**
   * Opens the panel on a session's start card (a paramountai:// link, v1.2.0). It only shows a card:
   * nothing starts until the person presses on. If they must sign in first, the card follows. With a
   * one-time code (v1.3.0, ADR-0052) it opens /desktop/link instead, which signs in with the code
   * (kept here, never in the address) and then shows the card.
   */
  openSession(sessionId: string, code?: string): void;
  /**
   * Gives the link's one-time code to the page, once, within LINK_CODE_KEEP_MS (ADR-0052).
   *
   * @returns The code, or null.
   */
  takeLinkCode(): string | null;
  /** Shows the panel again without taking focus (a call ended, behind the call's review). */
  showInactive(): void;
  /** Hides the panel (a call started: it stays out of the way until the call ends). */
  hide(): void;
  /**
   * Resizes the panel to a size its page asked for (ADR-0055), inside its screen, and remembers it.
   *
   * @param size The size, in DIPs.
   */
  resize(size: { width: number; height: number }): void;
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
  // A session a link asked for, until the panel has arrived at it (signing in can come first).
  let pendingSession: string | null = null;
  // A link's one-time code and when it arrived (v1.3.0, ADR-0052); in memory only, given out once.
  let linkCode: { code: string; at: number } | null = null;

  /**
   * The address of a session's start card.
   *
   * @param sessionId The session's id, already checked to be a UUID.
   * @returns The address.
   */
  const sessionUrl = (sessionId: string) => {
    const url = new URL(homeUrl);
    url.searchParams.set('session', sessionId);
    return url.toString();
  };

  /**
   * Keeps the panel on its own pages, and reports a web app that has no /home.
   *
   * @param window The panel's window.
   * @param url    The page it arrived at.
   * @param status The HTTP status (absent for a navigation inside the page).
   */
  const onArrived = (window: BrowserWindow, url: string, status?: number) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/home' && status === 404) {
      deps.onUnavailable();
      window.destroy();
      return;
    }
    if (!homeAllowsPath(pathname)) {
      void window.loadURL(pendingSession ? sessionUrl(pendingSession) : homeUrl);
      return;
    }
    if (pathname === '/home') {
      if (pendingSession && searchParams.get('session') !== pendingSession) {
        void window.loadURL(sessionUrl(pendingSession));
      } else {
        pendingSession = null;
      }
    }
  };

  /**
   * Creates the window.
   *
   * @param start The page to open.
   * @returns The window.
   */
  const create = (start: string = homeUrl): BrowserWindow => {
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
    void window.loadURL(start);
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
    openSession(sessionId, code) {
      let start = sessionUrl(sessionId);
      if (code) {
        // The link page signs in with the code and goes to the card itself; it may also stay on the
        // plain panel (a different account kept), so nothing here pulls it back to the card.
        linkCode = { code, at: deps.now?.() ?? Date.now() };
        pendingSession = null;
        const url = new URL('/desktop/link', deps.kiteUrl);
        url.searchParams.set('session', sessionId);
        start = url.toString();
      } else {
        pendingSession = sessionId;
      }
      if (!current || current.isDestroyed()) {
        create(start);
        return;
      }
      void current.loadURL(start);
      if (current.isMinimized()) current.restore();
      current.show();
      current.focus();
    },
    takeLinkCode() {
      const held = linkCode;
      linkCode = null;
      if (!held || (deps.now?.() ?? Date.now()) - held.at > LINK_CODE_KEEP_MS) return null;
      return held.code;
    },
    showInactive() {
      if (current && !current.isDestroyed()) current.showInactive();
    },
    hide() {
      if (current && !current.isDestroyed()) current.hide();
    },
    resize(size) {
      if (!current || current.isDestroyed()) return;
      const bounds = current.getBounds();
      const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      // The screen the panel is on (its centre), or the primary one.
      const area =
        deps.screen
          .getAllDisplays()
          .map((display) => display.workArea)
          .find(
            (work) =>
              centre.x >= work.x &&
              centre.x < work.x + work.width &&
              centre.y >= work.y &&
              centre.y < work.y + work.height,
          ) ?? deps.screen.getPrimaryDisplay().workArea;
      const next = panelSizeBounds(bounds, size, area);
      if (
        next.x === bounds.x &&
        next.y === bounds.y &&
        next.width === bounds.width &&
        next.height === bounds.height
      ) {
        return;
      }
      current.setBounds(next);
      deps.store.write({ homeBounds: next });
    },
    window: () => (current && !current.isDestroyed() ? current : null),
  };
}
