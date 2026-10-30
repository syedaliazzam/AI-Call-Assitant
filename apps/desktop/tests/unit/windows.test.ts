/**
 * Tests for apps/desktop/src/windows.ts, protection.ts and store.ts, with Electron faked:
 * - compactUrl() builds /compact/[id] on the Kite URL for plain ids only;
 * - restoreBounds() keeps saved bounds that are still on a screen, else the bottom-right default;
 * - compactWindowOptions(): frameless, always on top, resizable, in the taskbar, hidden until
 *   shown, the same secure web preferences as the main window;
 * - the controller opens one window, shows it without focus (showInactive), never calls focus,
 *   switches session without a new window, applies protection and re-applies it on show,
 *   saves its position after a move, and closes; IPC answers the Kite page only;
 * - protection: supported on Windows 10 2004+ and macOS only; off by default; set() remembers
 *   and applies; the IPC accepts only a boolean, from the Kite page;
 * - the store ignores a broken file and invalid bounds.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSE_COMPACT_CHANNEL,
  GET_PROTECTION_CHANNEL,
  OPEN_COMPACT_CHANNEL,
  SET_PROTECTION_CHANNEL,
} from '../../src/channels';
import { createProtection, installProtection, protectionSupported } from '../../src/protection';
import { createStore, isBounds, type ShellSettings } from '../../src/store';
import {
  compactUrl,
  compactWindowOptions,
  createCompactWindows,
  installCompactWindows,
  restoreBounds,
} from '../../src/windows';

/** The Kite URL and origin used in these tests. */
const KITE = 'https://kite-call-assistant.vercel.app/';
const ORIGIN = 'https://kite-call-assistant.vercel.app';

/** A primary display's work area (1920 × 1040 above the taskbar). */
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };

/**
 * An in-memory store.
 *
 * @param initial Starting settings.
 * @returns The store.
 */
function memoryStore(initial: ShellSettings = {}) {
  let settings = { ...initial };
  return {
    read: () => settings,
    write: vi.fn((changes: ShellSettings) => {
      settings = { ...settings, ...changes };
    }),
  };
}

/** A fake BrowserWindow: records calls and lets the test fire its events. */
class FakeWindow {
  static created: FakeWindow[] = [];
  listeners = new Map<string, (() => void)[]>();
  destroyed = false;
  bounds = { x: 10, y: 20, width: 380, height: 320 };
  showInactive = vi.fn();
  focus = vi.fn();
  show = vi.fn();
  loadURL = vi.fn(async () => undefined);
  setAlwaysOnTop = vi.fn();
  setContentProtection = vi.fn();
  close = vi.fn(() => {
    this.emit('close');
    this.destroyed = true;
    this.emit('closed');
  });
  constructor(public options: Record<string, unknown>) {
    FakeWindow.created.push(this);
  }
  on(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  once(event: string, listener: () => void) {
    return this.on(event, listener);
  }
  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
  isDestroyed() {
    return this.destroyed;
  }
  getBounds() {
    return this.bounds;
  }
}

/**
 * The compact controller with fakes.
 *
 * @param initial Store contents.
 * @returns The controller, the store and the protection.
 */
function setup(initial: ShellSettings = {}) {
  const store = memoryStore(initial);
  const protection = createProtection(store, 'win32', '10.0.26200');
  const compact = createCompactWindows({
    createWindow: (options) => new FakeWindow(options as Record<string, unknown>) as never,
    screen: {
      getAllDisplays: () => [{ workArea: PRIMARY }] as never,
      getPrimaryDisplay: () => ({ workArea: PRIMARY }) as never,
    },
    kiteUrl: KITE,
    preloadPath: '/app/preload.js',
    appVersion: '0.1.0',
    store,
    protection,
  });
  return { compact, store, protection };
}

/**
 * An IPC event from a frame.
 *
 * @param url The frame's URL.
 * @returns The event.
 */
const from = (url: string) => ({ senderFrame: { url, parent: null } }) as never;

afterEach(() => {
  FakeWindow.created = [];
  vi.useRealTimers();
});

describe('compactUrl and restoreBounds', () => {
  it('builds the compact route for plain ids only', () => {
    expect(compactUrl(KITE, 'abc-123_X')).toBe(`${ORIGIN}/compact/abc-123_X`);
    for (const bad of ['../admin', 'a/b', '', 'x'.repeat(65), 42, 'a?b', 'https://evil.example']) {
      expect(compactUrl(KITE, bad)).toBeNull();
    }
  });

  it('keeps saved bounds still on a screen, else the bottom-right default', () => {
    const saved = { x: 100, y: 100, width: 400, height: 300 };
    expect(restoreBounds(saved, [PRIMARY], PRIMARY)).toEqual(saved);
    // On a monitor that was unplugged.
    const gone = { x: 3000, y: 100, width: 400, height: 300 };
    expect(restoreBounds(gone, [PRIMARY], PRIMARY)).toEqual({
      x: 1516,
      y: 696,
      width: 380,
      height: 320,
    });
    expect(restoreBounds(undefined, [PRIMARY], PRIMARY)).toEqual({
      x: 1516,
      y: 696,
      width: 380,
      height: 320,
    });
  });

  it('options: frameless, on top, resizable, in the taskbar, hidden until shown, secure', () => {
    const options = compactWindowOptions({ x: 1, y: 2, width: 380, height: 320 }, '/p.js', '1');
    expect(options).toMatchObject({
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: false,
      show: false,
      x: 1,
      y: 2,
    });
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: '/p.js',
    });
  });
});

describe('createCompactWindows', () => {
  it('opens one window, shown without focus, protected, and saves where it was moved', () => {
    vi.useFakeTimers();
    const { compact, store } = setup({ shareProtection: true });
    expect(compact.open('s1')).toBe(true);
    const window = FakeWindow.created[0]!;
    expect(window.loadURL).toHaveBeenCalledWith(`${ORIGIN}/compact/s1`);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    // The remembered setting (on here), applied at once.
    expect(window.setContentProtection).toHaveBeenLastCalledWith(true);
    window.emit('ready-to-show');
    expect(window.showInactive).toHaveBeenCalledTimes(1);
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    // Re-applied every time it is shown.
    window.setContentProtection.mockClear();
    window.emit('show');
    expect(window.setContentProtection).toHaveBeenCalledWith(true);
    // Moved: saved after a short delay.
    window.bounds = { x: 50, y: 60, width: 400, height: 330 };
    window.emit('moved');
    vi.advanceTimersByTime(600);
    expect(store.read().compactBounds).toEqual({ x: 50, y: 60, width: 400, height: 330 });
  });

  it('reuses the window for another session, without focus, and closes it', () => {
    const { compact } = setup({ compactBounds: { x: 5, y: 6, width: 300, height: 200 } });
    compact.open('s1');
    compact.open('s2');
    expect(FakeWindow.created).toHaveLength(1);
    const window = FakeWindow.created[0]!;
    expect(window.options).toMatchObject({ x: 5, y: 6, width: 300, height: 200 });
    expect(window.loadURL).toHaveBeenLastCalledWith(`${ORIGIN}/compact/s2`);
    expect(window.showInactive).toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    compact.close();
    expect(compact.window()).toBeNull();
    expect(compact.open('../x')).toBe(false);
  });

  it('IPC: opens and closes for the Kite page only, and refuses a bad id', async () => {
    const { compact } = setup();
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    installCompactWindows({ handle: (c: string, f: never) => handlers.set(c, f) }, compact, ORIGIN);
    await handlers.get(OPEN_COMPACT_CHANNEL)!(from(`${ORIGIN}/live/s1`), 's1');
    expect(compact.window()).not.toBeNull();
    expect(() =>
      handlers.get(OPEN_COMPACT_CHANNEL)!(from('https://evil.example/'), 's1'),
    ).toThrow();
    expect(() => handlers.get(OPEN_COMPACT_CHANNEL)!(from(`${ORIGIN}/`), '../x')).toThrow(
      /session id/,
    );
    expect(() => handlers.get(CLOSE_COMPACT_CHANNEL)!(from('https://evil.example/'))).toThrow();
    await handlers.get(CLOSE_COMPACT_CHANNEL)!(from(`${ORIGIN}/compact/s1`));
    expect(compact.window()).toBeNull();
  });
});

describe('protection', () => {
  it('is supported on Windows 10 2004+ and macOS only', () => {
    expect(protectionSupported('win32', '10.0.19041')).toBe(true);
    expect(protectionSupported('win32', '10.0.18363')).toBe(false);
    expect(protectionSupported('darwin', '23.0.0')).toBe(true);
    expect(protectionSupported('linux', '6.8.0')).toBe(false);
  });

  it('is off by default, remembers a change and applies it; IPC takes a boolean from Kite only', async () => {
    const store = memoryStore();
    const protection = createProtection(store, 'win32', '10.0.26200');
    expect(protection.state()).toEqual({ on: false, supported: true });
    const fresh = { setContentProtection: vi.fn(), on: vi.fn() };
    protection.attach(fresh);
    expect(fresh.setContentProtection).toHaveBeenCalledWith(false);
    const window = { setContentProtection: vi.fn() };
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    installProtection(
      { handle: (c: string, f: never) => handlers.set(c, f) },
      protection,
      () => window,
      ORIGIN,
    );
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(await handlers.get(SET_PROTECTION_CHANNEL)!(from(`${ORIGIN}/settings`), false)).toEqual({
      on: false,
      supported: true,
    });
    expect(window.setContentProtection).toHaveBeenCalledWith(false);
    expect(store.read().shareProtection).toBe(false);
    // Anything but true turns it off.
    expect(await handlers.get(SET_PROTECTION_CHANNEL)!(from(`${ORIGIN}/`), 'yes')).toMatchObject({
      on: false,
    });
    expect(() => handlers.get(GET_PROTECTION_CHANNEL)!(from('https://evil.example/'))).toThrow();
    expect(await handlers.get(GET_PROTECTION_CHANNEL)!(from(`${ORIGIN}/`))).toEqual({
      on: false,
      supported: true,
    });
  });
});

describe('store', () => {
  it('reads a broken file as empty, drops invalid bounds, and merges writes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kite-store-'));
    try {
      const file = path.join(dir, 'kite-shell.json');
      writeFileSync(file, '{not json');
      const store = createStore(file);
      expect(store.read()).toEqual({});
      writeFileSync(
        file,
        JSON.stringify({
          compactBounds: { x: 1, y: 2, width: -5, height: 3 },
          shareProtection: 'yes',
        }),
      );
      expect(store.read()).toEqual({});
      store.write({ shareProtection: false });
      store.write({ compactBounds: { x: 1, y: 2, width: 300, height: 200 } });
      expect(store.read()).toEqual({
        shareProtection: false,
        compactBounds: { x: 1, y: 2, width: 300, height: 200 },
      });
      expect(isBounds({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
      expect(isBounds({ x: 0, y: 0, width: Number.NaN, height: 1 })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
