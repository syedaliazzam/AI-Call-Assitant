/**
 * Tests for apps/desktop/src/windows.ts, protection.ts and store.ts, with Electron faked:
 * - compactUrl() builds /compact/[id] on the Kite URL for plain ids only;
 * - restoreBounds() keeps saved bounds that are still on a screen, else 640 × 480 at the
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

  it('keeps saved bounds still on a screen, else 640 × 480 at the top centre (ADR-0035)', () => {
    const saved = { x: 100, y: 100, width: 400, height: 300 };
    expect(restoreBounds(saved, [PRIMARY], PRIMARY)).toEqual(saved);
    const topCentre = { x: 640, y: 24, width: 640, height: 480 };
    expect(COMPACT_DEFAULT_SIZE).toEqual({ width: 640, height: 480 });
    // On a monitor that was unplugged.
    const gone = { x: 3000, y: 100, width: 400, height: 300 };
    expect(restoreBounds(gone, [PRIMARY], PRIMARY)).toEqual(topCentre);
    expect(restoreBounds(undefined, [PRIMARY], PRIMARY)).toEqual(topCentre);
    // The remembered preset decides the default place.
    expect(restoreBounds(undefined, [PRIMARY], PRIMARY, 'top-right')).toEqual({
      x: 1920 - 640 - 24,
      y: 24,
      width: 640,
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
    overlayShortcut(compact, 'overlay-up-big');
    expect(window.bounds.y).toBe(start.y - OVERLAY_STEP.big);
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
    expect(presetBounds('top-center', PRIMARY)).toEqual({ x: 640, y: 24, width: 640, height: 480 });
    expect(presetBounds('top-right', PRIMARY)).toEqual({ x: 1256, y: 24, width: 640, height: 480 });
    expect(presetBounds('bottom-center', PRIMARY)).toEqual({
      x: 640,
      y: 1040 - 480 - 24,
      width: 640,
      height: 480,
    });
    // A second display to the right, and a screen smaller than the overlay.
    expect(presetBounds('top-center', { x: 1920, y: 0, width: 1280, height: 720 })).toEqual({
      x: 1920 + 320,
      y: 24,
      width: 640,
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
    expect(snapBounds({ x: 9, y: 14, ...size }, PRIMARY)).toEqual({ x: 0, y: 0, ...size });
    expect(snapBounds({ x: 1920 - 560 - 16, y: 1040 - 420 + 5, ...size }, PRIMARY)).toEqual({
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
    expect(window.options).toMatchObject({ x: 1256, y: 24, width: 640, height: 480 });
    compact.place('bottom-center');
    expect(window.bounds).toEqual({ x: 640, y: 536, width: 640, height: 480 });
    expect(store.read().compactBounds).toEqual({ x: 640, y: 536, width: 640, height: 480 });
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
