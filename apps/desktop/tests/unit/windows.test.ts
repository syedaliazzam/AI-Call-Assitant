/**
 * Tests for apps/desktop/src/windows.ts, protection.ts and store.ts, with Electron faked:
 * - compactUrl() builds /compact/[id] on the Kite URL for plain ids only;
 * - restoreBounds() keeps saved bounds that are still on a screen, else 900 × 480 at the
 *   remembered preset (top centre by default; v1.0.2, ADR-0035);
 * - compactWindowOptions(): frameless, always on top, resizable, see-through (transparent), in the
 *   taskbar, hidden until shown, the same secure web preferences as the main window;
 * - v1.0.2: preset places, snapping to edges after a move, page-driven resizing from each edge,
 *   the script-bar modes and their way back, and the IPC checks for those values;
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
  OVERLAY_MODE_CHANNEL,
  OVERLAY_PLACE_CHANNEL,
  OVERLAY_PRESET_CHANNEL,
  OVERLAY_RESIZE_CHANNEL,
  SET_PROTECTION_CHANNEL,
} from '../../src/channels';
import { createProtection, installProtection, protectionSupported } from '../../src/protection';
import { createStore, isBounds, type ShellSettings } from '../../src/store';
import {
  compactUrl,
  compactWindowOptions,
  createCompactWindows,
  installCompactWindows,
  COMPACT_COLLAPSED_HEIGHT,
  COMPACT_DEFAULT_SIZE,
  fromIconBounds,
  isOverlayMove,
  narrowedBounds,
  OVERLAY_BOTH_WIDTH,
  widthAboutCentre,
  COMPACT_MIN_SIZE,
  isOverlayMode,
  isOverlayPreset,
  isResizeStep,
  OVERLAY_OPACITY_RANGE,
  OVERLAY_STEP,
  overlayMove,
  overlayShortcut,
  presetBounds,
  resizeBounds,
  restoreBounds,
  SCRIPT_BAR_SIZE,
  snapBounds,
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
  setIgnoreMouseEvents = vi.fn();
  /** Stands for the window's page (the click-through handler checks the sender is it). */
  webContents = { id: 1 };
  show = vi.fn();
  loadURL = vi.fn(async () => undefined);
  setAlwaysOnTop = vi.fn();
  setContentProtection = vi.fn();
  setOpacity = vi.fn();
  setMinimumSize = vi.fn();
  hide = vi.fn();
  visible = true;
  isVisible() {
    return this.visible;
  }
  getPosition() {
    return [this.bounds.x, this.bounds.y];
  }
  setPosition = vi.fn((x: number, y: number) => {
    this.bounds = { ...this.bounds, x, y };
  });
  setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
    this.bounds = bounds;
  });
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
      getDisplayMatching: () => ({ workArea: PRIMARY }) as never,
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

  it('keeps saved bounds still on a screen, else 900 × 480 at the top centre (ADR-0035, ADR-0055)', () => {
    const saved = { x: 100, y: 100, width: 400, height: 300 };
    expect(restoreBounds(saved, [PRIMARY], PRIMARY)).toEqual(saved);
    // v1.3.0 (ADR-0056): 16 DIPs from the work area's edges (24 before).
    const topCentre = { x: 510, y: 16, width: 900, height: 480 };
    expect(COMPACT_DEFAULT_SIZE).toEqual({ width: 900, height: 480 });
    // On a monitor that was unplugged.
    const gone = { x: 3000, y: 100, width: 400, height: 300 };
    expect(restoreBounds(gone, [PRIMARY], PRIMARY)).toEqual(topCentre);
    expect(restoreBounds(undefined, [PRIMARY], PRIMARY)).toEqual(topCentre);
    // The remembered preset decides the default place.
    expect(restoreBounds(undefined, [PRIMARY], PRIMARY, 'top-right')).toEqual({
      x: 1920 - 900 - 16,
      y: 16,
      width: 900,
      height: 480,
    });
  });

  it('see-through on every system: transparent; vibrancy on macOS, no acrylic on Windows (ADR-0039)', () => {
    const bounds = { x: 1, y: 2, width: 380, height: 320 };
    const win = compactWindowOptions(bounds, '/p.js', '1', 'win32');
    // v1.0.1 had the clear colour without `transparent`, which Electron ignores: solid black.
    expect(win).toMatchObject({
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      maximizable: false,
      fullscreenable: false,
    });
    // v1.0.3: acrylic blurred what is behind into unreadable colour on the real screen.
    expect(win.backgroundMaterial).toBeUndefined();
    const mac = compactWindowOptions(bounds, '/p.js', '1', 'darwin');
    expect(mac).toMatchObject({ transparent: true, vibrancy: 'hud', maximizable: false });
    expect(mac.backgroundColor).toBeUndefined();
    const other = compactWindowOptions(bounds, '/p.js', '1', 'linux');
    expect(other).toMatchObject({ transparent: true, backgroundColor: '#00000000' });
    expect(other.backgroundMaterial).toBeUndefined();
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
    const { compact } = setup({
      compactBounds: { x: 5, y: 6, width: 300, height: 200 },
      overlayBarsWidened: true,
      overlayBarsWidth: 900,
    });
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

  it('attaches each window once, re-applying the setting on every show (v1.3.0, ADR-0055)', () => {
    const store = memoryStore({ shareProtection: true });
    const protection = createProtection(store, 'win32', '10.0.26200');
    const shows: (() => void)[] = [];
    const window = {
      setContentProtection: vi.fn(),
      on: vi.fn((_event: string, handler: () => void) => shows.push(handler)),
    };
    // Attached as it is created (browser-window-created) and again by its owner.
    protection.attach(window as never);
    protection.attach(window as never);
    expect(window.setContentProtection).toHaveBeenCalledTimes(1);
    expect(window.setContentProtection).toHaveBeenLastCalledWith(true);
    expect(shows).toHaveLength(1);
    shows[0]!();
    expect(window.setContentProtection).toHaveBeenCalledTimes(2);
  });

  it('is off by default, remembers a change and applies it; IPC takes a boolean from Kite only', async () => {
    const store = memoryStore();
    const protection = createProtection(store, 'win32', '10.0.26200');
    expect(protection.state()).toEqual({ on: false, supported: true, scope: 'all' });
    const fresh = { setContentProtection: vi.fn(), on: vi.fn() };
    protection.attach(fresh);
    expect(fresh.setContentProtection).toHaveBeenCalledWith(false);
    const window = { setContentProtection: vi.fn() };
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    installProtection(
      { handle: (c: string, f: never) => handlers.set(c, f) },
      protection,
      () => [window],
      ORIGIN,
    );
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(await handlers.get(SET_PROTECTION_CHANNEL)!(from(`${ORIGIN}/settings`), false)).toEqual({
      on: false,
      supported: true,
      scope: 'all',
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
      scope: 'all',
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

describe('the overlay window (ADR-0029)', () => {
  it('shows or hides without taking focus, and moves by the shortcut steps', () => {
    const { compact } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    overlayShortcut(compact, 'overlay-toggle');
    expect(window.hide).toHaveBeenCalledTimes(1);
    window.visible = false;
    window.showInactive.mockClear();
    overlayShortcut(compact, 'overlay-toggle');
    expect(window.showInactive).toHaveBeenCalledTimes(1);
    const start = { ...window.bounds };
    overlayShortcut(compact, 'overlay-right');
    expect(window.bounds.x).toBe(start.x + OVERLAY_STEP.small);
    overlayShortcut(compact, 'overlay-up');
    expect(window.bounds.y).toBe(start.y - OVERLAY_STEP.small);
    expect(overlayMove('answer')).toBeNull();
  });

  it('keeps the opacity readable, whatever is asked', () => {
    const { compact } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    compact.setOpacity(0.6);
    expect(window.setOpacity).toHaveBeenLastCalledWith(0.6);
    compact.setOpacity(0);
    expect(window.setOpacity).toHaveBeenLastCalledWith(OVERLAY_OPACITY_RANGE.min);
    compact.setOpacity(9);
    expect(window.setOpacity).toHaveBeenLastCalledWith(OVERLAY_OPACITY_RANGE.max);
    window.setOpacity.mockClear();
    compact.setOpacity('0.5');
    compact.setOpacity(Number.NaN);
    expect(window.setOpacity).not.toHaveBeenCalled();
  });

  it('collapses to the controls bar, and opens to the size it had', () => {
    const { compact, store } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    const height = window.bounds.height;
    compact.setCollapsed(true);
    expect(window.bounds.height).toBe(COMPACT_COLLAPSED_HEIGHT);
    // Saved while collapsed: the open size is what is remembered.
    window.emit('close');
    expect(store.read().compactBounds?.height).toBe(height);
    compact.setCollapsed(false);
    expect(window.bounds.height).toBe(height);
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(
      COMPACT_MIN_SIZE.width,
      COMPACT_MIN_SIZE.height,
    );
  });
});

describe('placement, snapping and resizing (v1.0.2, ADR-0035)', () => {
  it('puts the overlay at each preset, shrunk to fit a small screen', () => {
    expect(presetBounds('top-center', PRIMARY)).toEqual({ x: 510, y: 16, width: 900, height: 480 });
    expect(presetBounds('top-left', PRIMARY)).toEqual({ x: 16, y: 16, width: 900, height: 480 });
    expect(presetBounds('top-right', PRIMARY)).toEqual({ x: 1004, y: 16, width: 900, height: 480 });
    expect(presetBounds('bottom-center', PRIMARY)).toEqual({
      x: 510,
      y: 1040 - 480 - 16,
      width: 900,
      height: 480,
    });
    // A second display to the right, and a screen smaller than the overlay.
    expect(presetBounds('top-center', { x: 1920, y: 0, width: 1280, height: 720 })).toEqual({
      x: 1920 + 190,
      y: 16,
      width: 900,
      height: 480,
    });
    expect(presetBounds('top-center', { x: 0, y: 0, width: 500, height: 400 })).toEqual({
      x: 0,
      y: 0,
      width: 500,
      height: 400,
    });
  });

  it('snaps each side near an edge flush to it, and leaves the size alone', () => {
    const size = { width: 560, height: 420 };
    expect(snapBounds({ x: 7, y: 6, ...size }, PRIMARY)).toEqual({ x: 0, y: 0, ...size });
    // v1.3.0 (ADR-0056): within 8 DIPs only, so a window at a position (16 from the edge) stays there.
    expect(snapBounds({ x: 16, y: 16, ...size }, PRIMARY)).toEqual({ x: 16, y: 16, ...size });
    expect(snapBounds({ x: 1920 - 560 - 6, y: 1040 - 420 + 5, ...size }, PRIMARY)).toEqual({
      x: 1920 - 560,
      y: 1040 - 420,
      ...size,
    });
    const free = { x: 17, y: 300, ...size };
    expect(snapBounds(free, PRIMARY)).toEqual(free);
  });

  it('resizes from each edge, keeps the opposite edge, the minimum and the screen', () => {
    const start = { x: 600, y: 200, width: 560, height: 420 };
    const min = COMPACT_MIN_SIZE;
    expect(resizeBounds(start, 'se', 40, 30, min, PRIMARY)).toEqual({
      x: 600,
      y: 200,
      width: 600,
      height: 450,
    });
    // West and north move the window; the right and bottom edges stay.
    expect(resizeBounds(start, 'nw', -50, -20, min, PRIMARY)).toEqual({
      x: 550,
      y: 180,
      width: 610,
      height: 440,
    });
    // Never below the minimum: the dragged edge stops.
    expect(resizeBounds(start, 'w', 500, 0, min, PRIMARY)).toEqual({
      x: 600 + 560 - min.width,
      y: 200,
      width: min.width,
      height: 420,
    });
    // Never off the screen.
    expect(resizeBounds(start, 'e', 5_000, 0, min, PRIMARY).width).toBe(1920 - 600);
    expect(resizeBounds(start, 'n', 0, -5_000, min, PRIMARY)).toMatchObject({ y: 0, height: 620 });
  });

  it('checks the values the page sends', () => {
    expect(isOverlayPreset('top-right')).toBe(true);
    expect(isOverlayPreset('middle')).toBe(false);
    expect(isOverlayMode('script-input')).toBe(true);
    expect(isOverlayMode('fullscreen')).toBe(false);
    // v1.0.4: ⛶ opens the full call window; the overlay no longer expands.
    expect(isOverlayMode('expanded')).toBe(false);
    expect(isResizeStep({ phase: 'move', edge: 'se', dx: 3, dy: -4 })).toBe(true);
    expect(isResizeStep({ phase: 'move', edge: 'x', dx: 3, dy: 4 })).toBe(false);
    expect(isResizeStep({ phase: 'move', edge: 'e', dx: Number.NaN, dy: 4 })).toBe(false);
    expect(isResizeStep({ phase: 'move', edge: 'e', dx: 1e9, dy: 4 })).toBe(false);
    expect(isResizeStep(null)).toBe(false);
  });

  it('snaps after a move near an edge, then saves the snapped place', () => {
    vi.useFakeTimers();
    const { compact, store } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    window.bounds = { x: 8, y: 300, width: 560, height: 420 };
    window.emit('moved');
    vi.advanceTimersByTime(600);
    expect(window.bounds).toEqual({ x: 0, y: 300, width: 560, height: 420 });
    expect(store.read().compactBounds).toEqual({ x: 0, y: 300, width: 560, height: 420 });
    // A resize alone never moves the window.
    window.setBounds.mockClear();
    window.bounds = { x: 5, y: 300, width: 600, height: 420 };
    window.emit('resized');
    vi.advanceTimersByTime(600);
    expect(window.setBounds).not.toHaveBeenCalled();
  });

  it('places at a preset, remembers it, and only remembers when no overlay is open', () => {
    const { compact, store } = setup();
    expect(compact.preset()).toBe('top-center');
    compact.place('top-right');
    expect(store.read().overlayPreset).toBe('top-right');
    expect(compact.preset()).toBe('top-right');
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    // Opens at the remembered preset (nothing saved yet).
    expect(window.options).toMatchObject({ x: 1004, y: 16, width: 900, height: 480 });
    compact.place('bottom-center');
    expect(window.bounds).toEqual({ x: 510, y: 544, width: 900, height: 480 });
    expect(store.read().compactBounds).toEqual({ x: 510, y: 544, width: 900, height: 480 });
  });

  it('script bar: slim at the top centre, input row, and back to where the overlay was', () => {
    const { compact, store } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    const full = { x: 300, y: 500, width: 600, height: 450 };
    window.bounds = { ...full };
    compact.setMode('script');
    expect(compact.mode()).toBe('script');
    expect(window.bounds).toEqual({ x: 640, y: 8, width: 640, height: SCRIPT_BAR_SIZE.height });
    compact.setMode('script-input');
    expect(window.bounds).toEqual({
      x: 640,
      y: 8,
      width: 640,
      height: SCRIPT_BAR_SIZE.height + SCRIPT_BAR_SIZE.inputHeight,
    });
    // The old collapse call never leaves the script bar.
    compact.setCollapsed(false);
    expect(compact.mode()).toBe('script-input');
    // Saved while slim: the full overlay's bounds are what is remembered.
    window.emit('close');
    expect(store.read().compactBounds).toEqual(full);
    compact.setMode('full');
    expect(window.bounds).toEqual(full);
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(
      COMPACT_MIN_SIZE.width,
      COMPACT_MIN_SIZE.height,
    );
    // From the script bar to the controls bar: the full overlay's place, at the bar's height.
    compact.setMode('script');
    compact.setMode('collapsed');
    expect(window.bounds).toEqual({ ...full, height: COMPACT_COLLAPSED_HEIGHT });
  });

  it('page-driven resize: from a start, any edge in full mode, width only when slim', () => {
    const { compact, store } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    window.bounds = { x: 600, y: 200, width: 560, height: 420 };
    // No start: ignored.
    compact.resize({ phase: 'move', edge: 'se', dx: 50, dy: 50 });
    expect(window.setBounds).not.toHaveBeenCalled();
    compact.resize({ phase: 'start', edge: 'se', dx: 0, dy: 0 });
    compact.resize({ phase: 'move', edge: 'se', dx: 20, dy: 10 });
    compact.resize({ phase: 'end', edge: 'se', dx: 40, dy: 30 });
    expect(window.bounds).toEqual({ x: 600, y: 200, width: 600, height: 450 });
    expect(store.read().compactBounds).toEqual({ x: 600, y: 200, width: 600, height: 450 });
    compact.setMode('script');
    const bar = { ...window.bounds };
    compact.resize({ phase: 'start', edge: 'n', dx: 0, dy: 0 });
    compact.resize({ phase: 'end', edge: 'n', dx: 0, dy: -100 });
    expect(window.bounds).toEqual(bar);
    compact.resize({ phase: 'start', edge: 'se', dx: 0, dy: 0 });
    compact.resize({ phase: 'end', edge: 'se', dx: 60, dy: 200 });
    expect(window.bounds).toEqual({ ...bar, width: bar.width + 60 });
  });

  it('IPC: presets, resize steps and modes from the Kite page only, and only valid ones', async () => {
    const { compact, store } = setup();
    compact.open('s1');
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    installCompactWindows({ handle: (c: string, f: never) => handlers.set(c, f) }, compact, ORIGIN);
    const page = from(`${ORIGIN}/compact/s1`);
    const evil = from('https://evil.example/');
    expect(() => handlers.get(OVERLAY_PLACE_CHANNEL)!(page, 'middle')).toThrow(/preset/);
    expect(() => handlers.get(OVERLAY_PLACE_CHANNEL)!(evil, 'top-right')).toThrow();
    await handlers.get(OVERLAY_PLACE_CHANNEL)!(page, 'top-right');
    expect(store.read().overlayPreset).toBe('top-right');
    expect(await handlers.get(OVERLAY_PRESET_CHANNEL)!(page)).toBe('top-right');
    expect(() => handlers.get(OVERLAY_PRESET_CHANNEL)!(evil)).toThrow();
    expect(() =>
      handlers.get(OVERLAY_RESIZE_CHANNEL)!(page, { phase: 'move', edge: 'up', dx: 1, dy: 1 }),
    ).toThrow(/resize/);
    await handlers.get(OVERLAY_RESIZE_CHANNEL)!(page, { phase: 'start', edge: 'e', dx: 0, dy: 0 });
    expect(() => handlers.get(OVERLAY_MODE_CHANNEL)!(page, 'huge')).toThrow(/mode/);
    expect(() => handlers.get(OVERLAY_MODE_CHANNEL)!(evil, 'script')).toThrow();
    await handlers.get(OVERLAY_MODE_CHANNEL)!(page, 'script');
    expect(compact.mode()).toBe('script');
  });
});

describe('the icon (v1.2.0, spec S13)', () => {
  /** The overlay as it opens in these tests. */
  const BOUNDS = { x: 200, y: 100, width: 780, height: 136 };

  /**
   * An open overlay at BOUNDS.
   *
   * @returns The controller, the window and the store.
   */
  function openIcon() {
    const made = setup({ compactBounds: BOUNDS, overlayBarsWidened: true, overlayBarsWidth: 900 });
    made.compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    window.bounds = { ...BOUNDS };
    return { ...made, window };
  }

  it('shrinks to 48 px at the top centre of the overlay, lowering the minimum first', () => {
    const { compact, window } = openIcon();
    compact.setMode('icon');
    expect(window.bounds).toEqual({ x: 200 + 366, y: 100, width: 48, height: 48 });
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(48, 48);
    expect(compact.mode()).toBe('icon');
  });

  it('moves with its size stated, and the overlay opens where the icon was dragged to', () => {
    const { compact, window } = openIcon();
    compact.setMode('icon');
    compact.move(50, 200);
    expect(window.bounds).toEqual({ x: 616, y: 300, width: 48, height: 48 });
    compact.setMode('full');
    expect(window.bounds).toEqual({ x: 250, y: 300, width: 780, height: 136 });
  });

  it('keeps the overlay on the display when the icon was dragged to its edge', () => {
    expect(fromIconBounds({ x: 1900, y: 1000, width: 48, height: 48 }, BOUNDS, PRIMARY)).toEqual({
      x: 1920 - 780,
      y: 1040 - 136,
      width: 780,
      height: 136,
    });
    expect(fromIconBounds({ x: 0, y: 0, width: 48, height: 48 }, BOUNDS, PRIMARY)).toEqual({
      x: 0,
      y: 0,
      width: 780,
      height: 136,
    });
  });

  it('remembers the overlay, not the icon', () => {
    const { compact, store } = openIcon();
    compact.setMode('icon');
    compact.move(50, 0);
    compact.close();
    expect(store.read().compactBounds).toEqual({ x: 250, y: 100, width: 780, height: 136 });
  });

  it('is a mode the page may ask for, and only well-formed moves are taken', () => {
    expect(isOverlayMode('icon')).toBe(true);
    expect(isOverlayMove({ dx: 3, dy: -4 })).toBe(true);
    expect(isOverlayMove({ dx: Number.NaN, dy: 0 })).toBe(false);
    expect(isOverlayMove({ dx: 1e6, dy: 0 })).toBe(false);
    expect(isOverlayMove({ dx: '1', dy: 0 })).toBe(false);
    expect(isOverlayMove(null)).toBe(false);
  });
});

describe('both panels side by side (v1.2.0, spec S15)', () => {
  /** The overlay as it opens in these tests. */
  const BOUNDS = { x: 570, y: 24, width: 780, height: 136 };

  /** No panels open. */
  const BARS = { transcript: false, answer: false, popupHeight: 0 };

  /** Both open. */
  const BOTH = { transcript: true, answer: true, popupHeight: 0 };

  /**
   * An open overlay at BOUNDS.
   *
   * @param settings More stored settings.
   * @returns The controller, the window and the store.
   */
  function openPanels(settings: ShellSettings = {}) {
    const made = setup({
      compactBounds: BOUNDS,
      overlayBarsWidened: true,
      overlayBarsWidth: 900,
      ...settings,
    });
    made.compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    window.bounds = { ...BOUNDS };
    return { ...made, window };
  }

  it('widens about its centre, and goes back to the width it had', () => {
    const { compact, window } = openPanels();
    compact.setLayout(BOTH);
    expect(window.bounds).toMatchObject({ x: 570 - 150, width: OVERLAY_BOTH_WIDTH, y: 24 });
    compact.setLayout(BARS);
    expect(window.bounds).toMatchObject({ x: 570, width: 780, y: 24 });
  });

  it('stays on a display narrower than it wants', () => {
    expect(widthAboutCentre({ x: 100, width: 780 }, 1080, { x: 0, width: 900 })).toEqual({
      x: 0,
      width: 900,
    });
    expect(widthAboutCentre({ x: 1100, width: 780 }, 1080, { x: 0, width: 1920 })).toEqual({
      x: 840,
      width: 1080,
    });
  });

  it('goes back exactly when the display limited the widening, and keeps a move made since', () => {
    const { compact, window } = openPanels();
    // Near the left edge: it could not widen about its centre.
    window.bounds = { ...BOUNDS, x: 40 };
    compact.setLayout(BOTH);
    expect(window.bounds.x).toBe(0);
    compact.setLayout(BARS);
    expect(window.bounds).toMatchObject({ x: 40, width: 780 });
    // Moved while wide: it stays moved.
    compact.setLayout(BOTH);
    window.bounds = { ...window.bounds, x: 500 };
    compact.setLayout(BARS);
    expect(window.bounds).toMatchObject({ x: 540, width: 780 });
    // And it never comes back off the display.
    expect(narrowedBounds({ x: 1900 }, { width: 780, shift: 150 }, PRIMARY)).toEqual({
      x: 1920 - 780,
      width: 780,
    });
  });

  it('remembers its narrow place, so it does not open wide with no panels', () => {
    const { compact, store } = openPanels();
    compact.setLayout(BOTH);
    compact.close();
    expect(store.read().compactBounds).toMatchObject({ x: 570, width: 780 });
  });

  it('remembers a width the user dragged, and does not change a wider window', () => {
    const { compact, store, window } = openPanels();
    compact.setLayout(BOTH);
    compact.resize({ phase: 'start', edge: 'e', dx: 0, dy: 0 });
    compact.resize({ phase: 'end', edge: 'e', dx: 100, dy: 0 });
    expect(store.read().overlayBothWidth).toBe(OVERLAY_BOTH_WIDTH + 100);
    compact.setLayout(BARS);
    compact.setLayout(BOTH);
    expect(window.bounds.width).toBe(OVERLAY_BOTH_WIDTH + 100);
  });
});

describe('a place saved by 1.1.0 or 1.2.0 (v1.2.0, ADR-0055)', () => {
  it('is widened once for the new bar 1, about its centre', () => {
    const { compact, store } = setup({
      compactBounds: { x: 620, y: 24, width: 680, height: 480 },
    });
    compact.open('s1');
    expect(FakeWindow.created.at(-1)!.options).toMatchObject({ x: 510, y: 24, width: 900 });
    expect(store.read().overlayBarsWidened).toBe(true);
    expect(store.read().overlayBarsWidth).toBe(900);
  });

  it('a place widened by 1.2.0 (780) is widened once more for the Transcript pill', () => {
    const { compact, store } = setup({
      compactBounds: { x: 570, y: 24, width: 780, height: 480 },
      overlayBarsWidened: true,
    });
    compact.open('s1');
    expect(FakeWindow.created.at(-1)!.options).toMatchObject({ x: 510, y: 24, width: 900 });
    expect(store.read().overlayBarsWidth).toBe(900);
  });

  it('a width chosen after that stays', () => {
    const { compact } = setup({
      compactBounds: { x: 620, y: 24, width: 600, height: 480 },
      overlayBarsWidened: true,
      overlayBarsWidth: 900,
    });
    compact.open('s1');
    expect(FakeWindow.created.at(-1)!.options).toMatchObject({ x: 620, width: 600 });
  });
});

describe('click-through over the gaps (v1.3.0, ADR-0055)', () => {
  it('passes clicks through with the moves forwarded, and takes them again', () => {
    const { compact } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    compact.setClickThrough(true);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    compact.setClickThrough(false);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it('never passes clicks through the icon', () => {
    const { compact } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    compact.setClickThrough(true);
    compact.setMode('icon');
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    compact.setClickThrough(true);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it('IPC: only the overlay window’s own Kite page', async () => {
    const { compact } = setup();
    compact.open('s1');
    const window = FakeWindow.created.at(-1)!;
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    installCompactWindows({ handle: (c: string, f: never) => handlers.set(c, f) }, compact, ORIGIN);
    const handler = handlers.get('kite:overlay-click-through')!;
    const page = {
      senderFrame: { url: `${ORIGIN}/compact/s1`, parent: null },
      sender: window.webContents,
    };
    const otherWindow = { senderFrame: { url: `${ORIGIN}/home`, parent: null }, sender: { id: 2 } };
    expect(() => handler(from('https://evil.example/'), true)).toThrow();
    await handler(otherWindow, true);
    expect(window.setIgnoreMouseEvents).not.toHaveBeenCalled();
    await handler(page, true);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    await handler(page, 'yes');
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });
});

describe('the six positions (v1.3.0, ADR-0056)', () => {
  /** A second display, to the right of the primary. */
  const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

  /**
   * The controller with two displays (ids 1 and 2) and a page that can be sent the position.
   *
   * @param initial Store contents.
   * @returns The controller, the store and the window's sent messages.
   */
  function twoDisplays(initial: ShellSettings = {}) {
    const store = memoryStore(initial);
    const displayFor = (rect: { x: number }) =>
      rect.x >= SECOND.x ? { id: 2, workArea: SECOND } : { id: 1, workArea: PRIMARY };
    const compact = createCompactWindows({
      createWindow: (options) => {
        const window = new FakeWindow(options as Record<string, unknown>);
        (window as unknown as { webContents: unknown }).webContents = {
          id: 1,
          send: vi.fn(),
          on: vi.fn(),
        };
        return window as never;
      },
      screen: {
        getAllDisplays: () => [{ workArea: PRIMARY }, { workArea: SECOND }] as never,
        getPrimaryDisplay: () => ({ id: 1, workArea: PRIMARY }) as never,
        getDisplayMatching: displayFor as never,
      },
      kiteUrl: KITE,
      preloadPath: '/app/preload.js',
      appVersion: '1.3.0',
      store,
      protection: createProtection(store, 'win32', '10.0.26200'),
    });
    return { compact, store };
  }

  /**
   * The open overlay's window and what it was sent.
   *
   * @returns The window and its send mock.
   */
  const opened = () => {
    const window = FakeWindow.created.at(-1)!;
    const send = (window.webContents as unknown as { send: ReturnType<typeof vi.fn> }).send;
    return { window, send };
  };

  it('jumps within the row and between rows, 16 from the edges, and tells the page', () => {
    const { compact } = twoDisplays();
    compact.open('s1');
    const { window, send } = opened();
    expect(compact.position()).toBe('top-center');
    compact.setLayout({ transcript: false, answer: false, popupHeight: 0 });
    const height = window.bounds.height;
    overlayShortcut(compact, 'overlay-spot-left');
    expect(window.bounds).toMatchObject({ x: 16, y: 16 });
    overlayShortcut(compact, 'overlay-spot-left');
    expect(window.bounds).toMatchObject({ x: 16, y: 16 });
    overlayShortcut(compact, 'overlay-row-bottom');
    expect(window.bounds).toMatchObject({ x: 16, y: 1040 - height - 16 });
    expect(compact.position()).toBe('bottom-left');
    overlayShortcut(compact, 'overlay-spot-right');
    overlayShortcut(compact, 'overlay-spot-right');
    overlayShortcut(compact, 'overlay-spot-right');
    expect(window.bounds).toMatchObject({ x: 1920 - window.bounds.width - 16 });
    expect(send).toHaveBeenLastCalledWith('kite:overlay-position-changed', 'bottom-right');
  });

  it('on the bottom row, grows and shrinks upward: the bars keep their bottom edge', () => {
    const { compact } = twoDisplays();
    compact.open('s1');
    const { window } = opened();
    compact.setLayout({ transcript: false, answer: false, popupHeight: 0 });
    overlayShortcut(compact, 'overlay-row-bottom');
    const bottom = window.bounds.y + window.bounds.height;
    expect(bottom).toBe(1040 - 16);
    compact.setLayout({ transcript: false, answer: true, popupHeight: 0 });
    expect(window.bounds.height).toBeGreaterThan(200);
    expect(window.bounds.y + window.bounds.height).toBe(bottom);
    // A menu needing room grows it upward too.
    compact.setLayout({ transcript: false, answer: false, popupHeight: 600 });
    expect(window.bounds.y + window.bounds.height).toBe(bottom);
    // Collapsing keeps bar 1 at the bottom edge; opening again grows upward.
    compact.setMode('collapsed');
    expect(window.bounds).toMatchObject({ y: bottom - COMPACT_COLLAPSED_HEIGHT });
    compact.setMode('full');
    expect(window.bounds.y + window.bounds.height).toBe(bottom);
    // The icon sits at the bottom edge, and the bars come back at the same position.
    compact.setMode('icon');
    expect(window.bounds.y + window.bounds.height).toBe(bottom);
    compact.setMode('full');
    expect(window.bounds.y + window.bounds.height).toBe(bottom);
  });

  it('the ⋮ grid puts it at a position at its current size; the script bar keeps its place', () => {
    const { compact } = twoDisplays();
    compact.open('s1');
    const { window } = opened();
    window.bounds = { x: 400, y: 300, width: 1000, height: 200 };
    compact.goTo('top-right');
    expect(window.bounds).toEqual({ x: 1920 - 1000 - 16, y: 16, width: 1000, height: 200 });
    compact.setMode('script');
    const script = { ...window.bounds };
    compact.goTo('bottom-left');
    expect(window.bounds).toEqual(script);
  });

  it('remembers the position per display, and opens there next time', () => {
    const { compact, store } = twoDisplays();
    compact.open('s1');
    overlayShortcut(compact, 'overlay-row-bottom');
    expect(store.read().overlayPositions).toEqual({ '1': 'bottom-center' });
    compact.close();
    // Moved to the second display and dropped near its top right.
    compact.open('s1');
    const { window } = opened();
    expect(compact.position()).toBe('bottom-center');
    window.bounds = { x: 4000, y: 40, width: 900, height: 480 };
    compact.snapTo('top-right');
    expect(window.bounds).toMatchObject({ x: 1920 + 2560 - 900 - 16, y: 16 });
    expect(store.read().overlayPositions).toEqual({ '1': 'bottom-center', '2': 'top-right' });
    compact.close();
    compact.open('s1');
    expect(compact.position()).toBe('top-right');
    expect(opened().window.options).toMatchObject({ x: 1920 + 2560 - 900 - 16, y: 16 });
  });

  it('a nudge moves it a little and keeps its position (and row)', () => {
    const { compact } = twoDisplays();
    compact.open('s1');
    const { window } = opened();
    overlayShortcut(compact, 'overlay-row-bottom');
    const start = { ...window.bounds };
    overlayShortcut(compact, 'overlay-up');
    expect(window.bounds.y).toBe(start.y - OVERLAY_STEP.small);
    expect(compact.position()).toBe('bottom-center');
  });

  it('answers the page with the position, and puts the overlay at one it asks for', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const { compact } = twoDisplays();
    installCompactWindows(
      { handle: (channel: string, handler: never) => handlers.set(channel, handler) } as never,
      compact,
      ORIGIN,
    );
    const position = handlers.get('kite:overlay-position')!;
    expect(position(from(KITE))).toBeNull();
    compact.open('s1');
    expect(position(from(KITE))).toBe('top-center');
    expect(position(from(KITE), 'bottom-right')).toBe('bottom-right');
    expect(() => position(from(KITE), 'middle')).toThrow('Not an overlay position');
    expect(() => position(from('https://evil.example/'))).toThrow();
  });
});
