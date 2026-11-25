/**
 * Tests for apps/desktop/src/snapZones.ts (v1.1.0, ADR-0041; v1.3.0, ADR-0056), with Electron faked: six
 * zones in a 2 × 3 grid, 16 DIPs from the work area's edges; which one the pointer is on (zoneAt); a
 * see-through window that takes no clicks and never takes focus; a drag shows the zones and highlights
 * the position nearest to the dragged overlay; a drop anywhere snaps to it; the zones follow the overlay
 * onto another display; macOS waits for a quiet moment; ADR-0120: on macOS the zones join every Space, full-screen
 * ones too (once, when the window is made), and on Windows nothing changes.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SNAP_ZONE_CHANNEL } from '../../src/channels';
import { createSnapZones, snapWindowOptions, snapZones, zoneAt } from '../../src/snapZones';

/** A display's work area. */
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

/** A second display's work area, to the right of the first. */
const SECOND = { x: 1920, y: 0, width: 1280, height: 984 };

/** A fake window. */
class FakeWindow {
  destroyed = false;
  isDestroyed = () => this.destroyed;
  loadURL = vi.fn(async (_url: string) => undefined);
  showInactive = vi.fn();
  hide = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setBounds = vi.fn();
  close = vi.fn(() => {
    this.destroyed = true;
  });
  webContents = { send: vi.fn() };
}

/**
 * The zones with faked parts. The overlay's bounds can be changed to drag it.
 *
 * @param platform process.platform.
 * @returns The zones and what they were given.
 */
function setup(platform: NodeJS.Platform = 'win32') {
  vi.useFakeTimers();
  const windows: FakeWindow[] = [];
  const options: BrowserWindowConstructorOptions[] = [];
  const bounds = { x: 620, y: 16, width: 680, height: 660 };
  const snapTo = vi.fn();
  const zones = createSnapZones({
    createWindow: (next) => {
      options.push(next);
      const window = new FakeWindow();
      windows.push(window);
      return window as unknown as BrowserWindow;
    },
    screen: {
      getDisplayMatching: (rect: { x: number }) => ({
        workArea: rect.x >= SECOND.x ? SECOND : AREA,
      }),
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    } as never,
    kiteUrl: 'https://kite.example/',
    preloadPath: '/preload.js',
    appVersion: '1.3.0',
    platform,
    snapTo,
  });
  const overlay = {
    getBounds: () => ({ ...bounds }),
    moveTop: vi.fn(),
    isDestroyed: () => false,
  } as unknown as BrowserWindow;
  return { zones, windows, options, bounds, snapTo, overlay };
}

afterEach(() => vi.useRealTimers());

describe('snapZones', () => {
  it('gives the top row then the bottom row, left to right, 16 from the edges, at most 320 tall', () => {
    expect(snapZones(AREA, 680, 660)).toEqual([
      { preset: 'top-left', rect: { x: 16, y: 16, width: 618, height: 320 } },
      { preset: 'top-center', rect: { x: 651, y: 16, width: 618, height: 320 } },
      { preset: 'top-right', rect: { x: 1286, y: 16, width: 618, height: 320 } },
      { preset: 'bottom-left', rect: { x: 16, y: 704, width: 618, height: 320 } },
      { preset: 'bottom-center', rect: { x: 651, y: 704, width: 618, height: 320 } },
      { preset: 'bottom-right', rect: { x: 1286, y: 704, width: 618, height: 320 } },
    ]);
  });

  it('keeps a shorter overlay at its own height', () => {
    expect(snapZones(AREA, 680, 108)[0]?.rect.height).toBe(108);
  });

  it('keeps the rows apart on a short screen', () => {
    const zones = snapZones({ x: 0, y: 0, width: 1280, height: 600 }, 680, 600);
    const top = zones[0]!.rect;
    const bottom = zones[3]!.rect;
    expect(top.y + top.height).toBeLessThan(bottom.y);
  });
});

describe('zoneAt', () => {
  const zones = snapZones(AREA, 680, 108);

  it('finds the zone under the pointer, or none', () => {
    expect(zoneAt(zones, { x: 30, y: 30 })).toBe('top-left');
    expect(zoneAt(zones, { x: 960, y: 100 })).toBe('top-center');
    expect(zoneAt(zones, { x: 1800, y: 30 })).toBe('top-right');
    expect(zoneAt(zones, { x: 1800, y: 1000 })).toBe('bottom-right');
    expect(zoneAt(zones, { x: 960, y: 500 })).toBeNull();
  });

  it('keeps the ghosts apart however wide the overlay is', () => {
    const [left, centre, right] = snapZones({ x: 0, y: 0, width: 1280, height: 720 }, 680, 108);
    expect(left!.rect.x + left!.rect.width).toBeLessThan(centre!.rect.x);
    expect(centre!.rect.x + centre!.rect.width).toBeLessThan(right!.rect.x);
  });

  it('gives the nearest centre if zones ever overlap', () => {
    const overlapping = [
      { preset: 'top-left' as const, rect: { x: 0, y: 0, width: 700, height: 100 } },
      { preset: 'top-center' as const, rect: { x: 600, y: 0, width: 700, height: 100 } },
    ];
    expect(zoneAt(overlapping, { x: 620, y: 30 })).toBe('top-left');
    expect(zoneAt(overlapping, { x: 680, y: 30 })).toBe('top-center');
  });
});

describe('snapWindowOptions', () => {
  it('is see-through, always on top, never focused and fills the work area', () => {
    const options = snapWindowOptions(AREA, '/p.js', '1.1.0');
    expect(options).toMatchObject({
      ...AREA,
      frame: false,
      transparent: true,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
    });
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true });
  });
});

describe('a drag', () => {
  it('shows the six zones in a window that takes no clicks, with the overlay on top', () => {
    const { zones, windows, overlay } = setup();
    zones.moving(overlay);
    const window = windows[0]!;
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(window.showInactive).toHaveBeenCalled();
    const url = new URL(window.loadURL.mock.calls[0]![0]);
    expect(url.pathname).toBe('/overlay-zones');
    expect(url.searchParams.get('zones')?.split(';')).toEqual([
      'top-left,16,16,618,320',
      'top-center,651,16,618,320',
      'top-right,1286,16,618,320',
      'bottom-left,16,704,618,320',
      'bottom-center,651,704,618,320',
      'bottom-right,1286,704,618,320',
    ]);
    expect(overlay.moveTop).toHaveBeenCalled();
  });

  it('highlights the position nearest to the overlay, once per change', () => {
    const { zones, windows, bounds, overlay } = setup();
    zones.moving(overlay);
    const send = windows[0]!.webContents.send;
    vi.advanceTimersByTime(60);
    expect(send).toHaveBeenCalledExactlyOnceWith(SNAP_ZONE_CHANNEL, 'top-center');
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);
    bounds.x = 1100;
    bounds.y = 300;
    vi.advanceTimersByTime(60);
    expect(send).toHaveBeenLastCalledWith(SNAP_ZONE_CHANNEL, 'bottom-right');
  });

  it('snaps to the nearest position wherever it is dropped, and hides the zones', () => {
    const { zones, windows, bounds, snapTo, overlay } = setup();
    zones.moving(overlay);
    bounds.x = 40;
    bounds.y = 330;
    zones.moved();
    expect(snapTo).toHaveBeenCalledExactlyOnceWith('bottom-left');
    expect(windows[0]!.hide).toHaveBeenCalled();
  });

  it('ignores a "moved" with no drag going on, as from a nudge or a jump', () => {
    const { zones, snapTo } = setup();
    zones.moved();
    expect(snapTo).not.toHaveBeenCalled();
  });

  it('follows the overlay onto another display and snaps there', () => {
    const { zones, windows, bounds, snapTo, overlay } = setup();
    zones.moving(overlay);
    bounds.x = 2230;
    bounds.y = 20;
    vi.advanceTimersByTime(60);
    expect(windows[0]!.setBounds).toHaveBeenLastCalledWith(SECOND);
    const url = new URL(windows[0]!.loadURL.mock.calls.at(-1)![0]);
    // Each zone is drawn relative to the second display's work area.
    expect(url.searchParams.get('zones')?.split(';')[0]).toBe('top-left,16,16,405,320');
    zones.moved();
    expect(snapTo).toHaveBeenCalledWith('top-center');
  });

  it('reuses its window for the next drag', () => {
    const { zones, windows, overlay } = setup();
    zones.moving(overlay);
    zones.moved();
    zones.moving(overlay);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.setBounds).toHaveBeenCalledWith(AREA);
    expect(windows[0]!.loadURL).toHaveBeenCalledTimes(2);
  });

  it('ADR-0120: on macOS joins every Space, full-screen ones too, once; on Windows does not', () => {
    const mac = setup('darwin');
    mac.zones.moving(mac.overlay);
    mac.zones.moved();
    vi.advanceTimersByTime(400);
    mac.zones.moving(mac.overlay);
    expect(mac.windows).toHaveLength(1);
    expect(mac.windows[0]!.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1);
    expect(mac.windows[0]!.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
    });
    vi.useRealTimers();
    const windows = setup('win32');
    windows.zones.moving(windows.overlay);
    expect(windows.windows[0]!.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });

  it('on macOS, waits for a quiet moment, as "moved" fires all through a drag', () => {
    const { zones, bounds, snapTo, overlay } = setup('darwin');
    zones.moving(overlay);
    bounds.x = 10;
    bounds.y = 10;
    zones.moved();
    vi.advanceTimersByTime(100);
    zones.moved();
    vi.advanceTimersByTime(200);
    expect(snapTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(snapTo).toHaveBeenCalledWith('top-left');
  });

  it('close() ends a drag and closes the window', () => {
    const { zones, windows, snapTo, overlay } = setup();
    zones.moving(overlay);
    zones.close();
    expect(windows[0]!.close).toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(snapTo).not.toHaveBeenCalled();
  });
});
