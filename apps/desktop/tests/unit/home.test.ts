/**
 * Tests for apps/desktop/src/home.ts (v1.1.0, ADR-0041), with Electron faked: the panel's default place
 * and size; a saved place still on a screen is kept; the window is frameless, in the taskbar, and has the
 * secure web preferences; it keeps to its own pages, and a web app with no /home (rolled back) makes the
 * app open the main window instead; it remembers its place; a call hides it and its end shows it without
 * taking focus.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LINK_CODE_KEEP_MS,
  createHomeWindow,
  HOME_DEFAULT_SIZE,
  HOME_MIN_SIZE,
  homeAllowsPath,
  homeBounds,
  homeDefaultBounds,
  homeWindowOptions,
  HOME_MAX_SIZE,
  isPanelSize,
  panelSizeBounds,
} from '../../src/home';

/** A primary display's work area. */
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

/** A fake window: records calls and lets the test fire its events. */
class FakeWindow {
  listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  contents = new Map<string, ((...args: unknown[]) => void)[]>();
  destroyed = false;
  minimized = false;
  bounds = { x: 1, y: 2, width: 400, height: 560 };
  show = vi.fn();
  showInactive = vi.fn();
  hide = vi.fn();
  focus = vi.fn();
  restore = vi.fn();
  loadURL = vi.fn(async () => undefined);
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  getBounds = () => this.bounds;
  setBounds = (next: typeof this.bounds) => {
    this.bounds = next;
  };
  on(event: string, handler: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
    return this;
  }
  once(event: string, handler: (...args: unknown[]) => void) {
    return this.on(event, handler);
  }
  emit(event: string, ...args: unknown[]) {
    for (const handler of this.listeners.get(event) ?? []) handler(...args);
  }
  webContents = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      this.contents.set(event, [...(this.contents.get(event) ?? []), handler]);
    },
  };
  /**
   * Fires a web contents event.
   *
   * @param event The event.
   * @param args  Its arguments after the event object.
   */
  navigate(event: string, ...args: unknown[]) {
    for (const handler of this.contents.get(event) ?? []) handler({}, ...args);
  }
}

/**
 * The panel with faked parts.
 *
 * @param settings The stored settings.
 * @returns The panel and what it was given.
 */
function setup(settings: { homeBounds?: typeof AREA } = {}) {
  let stored = { ...settings };
  const windows: FakeWindow[] = [];
  const options: BrowserWindowConstructorOptions[] = [];
  const onUnavailable = vi.fn();
  const onClosed = vi.fn();
  const home = createHomeWindow({
    createWindow: (next) => {
      options.push(next);
      const window = new FakeWindow();
      windows.push(window);
      return window as unknown as BrowserWindow;
    },
    screen: {
      getAllDisplays: () => [{ workArea: AREA }],
      getPrimaryDisplay: () => ({ workArea: AREA }),
    } as never,
    kiteUrl: 'https://kite.example/',
    preloadPath: '/preload.js',
    appVersion: '1.1.0',
    store: {
      read: () => stored,
      write: (changes: object) => {
        stored = { ...stored, ...changes };
      },
    } as never,
    onUnavailable,
    onClosed,
  });
  return { home, windows, options, onUnavailable, onClosed, stored: () => stored };
}

afterEach(() => vi.useRealTimers());

describe('where it opens', () => {
  it('opens 400 × 560 at the right, centred from top to bottom', () => {
    expect(HOME_DEFAULT_SIZE).toEqual({ width: 400, height: 560 });
    expect(homeDefaultBounds(AREA)).toEqual({ x: 1496, y: 240, width: 400, height: 560 });
  });

  it('shrinks to fit a small screen', () => {
    expect(homeDefaultBounds({ x: 100, y: 0, width: 380, height: 500 })).toEqual({
      x: 100,
      y: 0,
      width: 380,
      height: 500,
    });
  });

  it('keeps a saved place still on a screen, and forgets one that is not', () => {
    const saved = { x: 100, y: 100, width: 420, height: 600 };
    expect(homeBounds(saved, [AREA], AREA)).toEqual(saved);
    const gone = { x: 5000, y: 100, width: 420, height: 600 };
    expect(homeBounds(gone, [AREA], AREA)).toEqual(homeDefaultBounds(AREA));
    expect(homeBounds(undefined, [AREA], AREA)).toEqual(homeDefaultBounds(AREA));
  });
});

describe('homeWindowOptions', () => {
  it('is frameless and resizable, in the taskbar, with the secure preferences', () => {
    const options = homeWindowOptions({ x: 1, y: 2, width: 400, height: 560 }, '/p.js', '1.1.0');
    expect(options).toMatchObject({
      x: 1,
      y: 2,
      width: 400,
      height: 560,
      minWidth: HOME_MIN_SIZE.width,
      minHeight: HOME_MIN_SIZE.height,
      frame: false,
      resizable: true,
      skipTaskbar: false,
      show: false,
    });
    expect(options.webPreferences).toMatchObject({
      preload: '/p.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });
});

describe('which pages it shows', () => {
  it('allows /home and the sign-in pages only', () => {
    expect(homeAllowsPath('/home')).toBe(true);
    expect(homeAllowsPath('/login')).toBe(true);
    expect(homeAllowsPath('/change-password')).toBe(true);
    expect(homeAllowsPath('/')).toBe(false);
    expect(homeAllowsPath('/settings')).toBe(false);
  });

  it('opens on /home and goes back there from anywhere else', () => {
    const { home, windows } = setup();
    home.open();
    const window = windows[0]!;
    expect(window.loadURL).toHaveBeenLastCalledWith('https://kite.example/home');
    window.navigate('did-navigate', 'https://kite.example/login', 200);
    expect(window.loadURL).toHaveBeenCalledTimes(1);
    window.navigate('did-navigate', 'https://kite.example/', 200);
    expect(window.loadURL).toHaveBeenCalledTimes(2);
    window.navigate('did-navigate-in-page', 'https://kite.example/settings', true);
    expect(window.loadURL).toHaveBeenCalledTimes(3);
    // A frame inside a page does not move the panel.
    window.navigate('did-navigate-in-page', 'https://kite.example/settings', false);
    expect(window.loadURL).toHaveBeenCalledTimes(3);
  });

  it('reports a web app with no /home, and goes away', () => {
    const { home, windows, onUnavailable } = setup();
    home.open();
    windows[0]!.navigate('did-navigate', 'https://kite.example/home', 404);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(windows[0]!.destroy).toHaveBeenCalled();
    expect(home.window()).toBeNull();
  });
});

describe('a session link (spec S9)', () => {
  /** A session's id. */
  const ID = '86495cda-fbd1-4cea-8387-cd29f5c1381b';
  /** Its start card's address. */
  const CARD = `https://kite.example/home?session=${ID}`;

  it('opens the window on the session’s start card', () => {
    const { home, windows } = setup();
    home.openSession(ID);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.loadURL).toHaveBeenCalledExactlyOnceWith(CARD);
  });

  it('brings an open window to the start card, restoring it if minimised', () => {
    const { home, windows } = setup();
    home.open();
    windows[0]!.minimized = true;
    home.openSession(ID);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.loadURL).toHaveBeenLastCalledWith(CARD);
    expect(windows[0]!.restore).toHaveBeenCalled();
    expect(windows[0]!.focus).toHaveBeenCalled();
  });

  it('survives signing in first, and then is forgotten', () => {
    const { home, windows } = setup();
    home.openSession(ID);
    const window = windows[0]!;
    window.navigate('did-navigate', 'https://kite.example/sign-in', 200);
    window.loadURL.mockClear();
    // Signing in lands on the plain home page: the card is still owed.
    window.navigate('did-navigate', 'https://kite.example/home', 200);
    expect(window.loadURL).toHaveBeenCalledExactlyOnceWith(CARD);
    window.loadURL.mockClear();
    window.navigate('did-navigate', CARD, 200);
    expect(window.loadURL).not.toHaveBeenCalled();
    // Going back to the list later stays there.
    window.navigate('did-navigate', 'https://kite.example/home', 200);
    expect(window.loadURL).not.toHaveBeenCalled();
  });
});

describe('a link with a one-time code (ADR-0052)', () => {
  /** A session's id. */
  const ID = '86495cda-fbd1-4cea-8387-cd29f5c1381b';
  /** An invented code (43 base64url characters). */
  const CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
  /** The link page's address: the session only, never the code. */
  const LINK_PAGE = `https://kite.example/desktop/link?session=${ID}`;

  it('opens the link page without the code in the address, and gives the code once', () => {
    const { home, windows } = setup();
    home.openSession(ID, CODE);
    expect(windows[0]!.loadURL).toHaveBeenCalledExactlyOnceWith(LINK_PAGE);
    expect(home.takeLinkCode()).toBe(CODE);
    expect(home.takeLinkCode()).toBeNull();
  });

  it('lets the link page stay, and does not pull the panel back to the card', () => {
    const { home, windows } = setup();
    home.openSession(ID, CODE);
    const window = windows[0]!;
    window.navigate('did-navigate', LINK_PAGE, 200);
    window.navigate('did-navigate', 'https://kite.example/home', 200);
    expect(window.loadURL).toHaveBeenCalledExactlyOnceWith(LINK_PAGE);
  });

  it('forgets a code after 60 seconds', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const { home } = setup();
      home.openSession(ID, CODE);
      vi.setSystemTime(1_000_000 + LINK_CODE_KEEP_MS + 1);
      expect(home.takeLinkCode()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no code for a link without one', () => {
    const { home } = setup();
    home.openSession(ID);
    expect(home.takeLinkCode()).toBeNull();
  });
});

describe('the controller', () => {
  it('opens one window and shows it when painted', () => {
    const { home, windows } = setup();
    home.open();
    expect(windows).toHaveLength(1);
    windows[0]!.emit('ready-to-show');
    expect(windows[0]!.show).toHaveBeenCalledTimes(1);
    expect(home.window()).toBe(windows[0]);
  });

  it('a second open brings it forward, restoring it if minimised', () => {
    const { home, windows } = setup();
    home.open();
    windows[0]!.minimized = true;
    home.open();
    expect(windows).toHaveLength(1);
    expect(windows[0]!.restore).toHaveBeenCalled();
    expect(windows[0]!.focus).toHaveBeenCalled();
  });

  it('hides during a call, and comes back without taking focus', () => {
    const { home, windows } = setup();
    home.open();
    home.hide();
    expect(windows[0]!.hide).toHaveBeenCalled();
    home.showInactive();
    expect(windows[0]!.showInactive).toHaveBeenCalled();
    expect(windows[0]!.focus).not.toHaveBeenCalled();
  });

  it('remembers its place shortly after a move or a resize', () => {
    vi.useFakeTimers();
    const { home, windows, stored } = setup();
    home.open();
    const window = windows[0]!;
    window.bounds = { x: 50, y: 60, width: 420, height: 600 };
    window.emit('moved');
    expect(stored().homeBounds).toBeUndefined();
    vi.advanceTimersByTime(600);
    expect(stored().homeBounds).toEqual({ x: 50, y: 60, width: 420, height: 600 });
  });

  it('reports when it has closed, and opens a new window after that', () => {
    const { home, windows, onClosed } = setup();
    home.open();
    windows[0]!.emit('closed');
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(home.window()).toBeNull();
    home.open();
    expect(windows).toHaveLength(2);
  });

  it('does nothing on hide or show with no window', () => {
    const { home } = setup();
    expect(() => home.hide()).not.toThrow();
    expect(() => home.showInactive()).not.toThrow();
  });
});

describe('the size the page asks for (ADR-0055)', () => {
  const at = { x: 1496, y: 240, width: 400, height: 560 };

  it('grows to the launcher size, keeping the right edge and the vertical centre', () => {
    const next = panelSizeBounds(at, { width: 560, height: 720 }, AREA);
    expect(next).toEqual({ x: 1336, y: 160, width: 560, height: 720 });
  });

  it('stays inside the smallest and largest sizes and the screen', () => {
    expect(panelSizeBounds(at, { width: 10, height: 10 }, AREA)).toMatchObject(HOME_MIN_SIZE);
    const big = panelSizeBounds(at, { width: 5000, height: 5000 }, AREA);
    expect(big.width).toBe(HOME_MAX_SIZE.width);
    expect(big.height).toBe(HOME_MAX_SIZE.height);
    const small = { x: 0, y: 0, width: 1280, height: 672 };
    const fitted = panelSizeBounds(
      { x: 856, y: 56, width: 400, height: 560 },
      { width: 560, height: 720 },
      small,
    );
    expect(fitted.height).toBe(624);
    expect(fitted.y).toBeGreaterThanOrEqual(0);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(672);
  });

  it('accepts only two finite positive numbers', () => {
    expect(isPanelSize({ width: 560, height: 720 })).toBe(true);
    for (const value of [
      null,
      'x',
      {},
      { width: 560 },
      { width: -1, height: 2 },
      { width: Infinity, height: 2 },
    ]) {
      expect(isPanelSize(value)).toBe(false);
    }
  });

  it('resizes the open panel and remembers it', () => {
    const { home, windows, stored } = setup();
    home.open();
    home.resize({ width: 560, height: 720 });
    expect(windows[0]!.getBounds().width).toBe(560);
    expect(stored().homeBounds?.width).toBe(560);
  });
});
