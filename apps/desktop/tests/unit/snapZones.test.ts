/**
 * Tests for apps/desktop/src/snapZones.ts (v1.1.0, ADR-0041, item 10), with Electron faked: three zones
 * along the top of the display, left to right; which one the pointer is on; a see-through window that
 * takes no clicks and never takes focus; a drag shows the zones and tells the page the zone under the
 * pointer; a drop on a zone snaps there and a drop elsewhere does not; macOS waits for a quiet moment.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SNAP_ZONE_CHANNEL } from '../../src/channels';
import { createSnapZones, snapWindowOptions, snapZones, zoneAt } from '../../src/snapZones';

/** A display's work area. */
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

/** A fake window. */
class FakeWindow {
  destroyed = false;
  isDestroyed = () => this.destroyed;
  loadURL = vi.fn(async (_url: string) => undefined);
  showInactive = vi.fn();
  hide = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  setAlwaysOnTop = vi.fn();
  setBounds = vi.fn();
  close = vi.fn(() => {
    this.destroyed = true;
  });
  webContents = { send: vi.fn() };
}

/**
 * The zones with faked parts.
 *
 * @param platform process.platform.
 * @returns The zones and what they were given.
 */
function setup(platform: NodeJS.Platform = 'win32') {
  vi.useFakeTimers();
  const windows: FakeWindow[] = [];
  const options: BrowserWindowConstructorOptions[] = [];
  const pointer = { x: 5, y: 900 };
  const snapTo = vi.fn();
  const zones = createSnapZones({
    createWindow: (next) => {
      options.push(next);
      const window = new FakeWindow();
      windows.push(window);
      return window as unknown as BrowserWindow;
    },
    screen: {
      getDisplayMatching: () => ({ workArea: AREA }),
      getCursorScreenPoint: () => pointer,
    } as never,
    kiteUrl: 'https://kite.example/',
    preloadPath: '/preload.js',
    appVersion: '1.1.0',
    platform,
    snapTo,
  });
  const overlay = {
    getBounds: () => ({ x: 300, y: 300, width: 680, height: 660 }),
    moveTop: vi.fn(),
  } as unknown as BrowserWindow;
  return { zones, windows, options, pointer, snapTo, overlay };
}

afterEach(() => vi.useRealTimers());

describe('snapZones', () => {
  it('gives left, centre and right along the top, at most 320 tall', () => {
    expect(snapZones(AREA, 680, 660)).toEqual([
      { preset: 'top-left', rect: { x: 24, y: 24, width: 608, height: 320 } },
      { preset: 'top-center', rect: { x: 656, y: 24, width: 608, height: 320 } },
      { preset: 'top-right', rect: { x: 1288, y: 24, width: 608, height: 320 } },
    ]);
  });

  it('keeps a shorter overlay at its own height', () => {
    expect(snapZones(AREA, 680, 108)[0]?.rect.height).toBe(108);
  });
});

describe('zoneAt', () => {
  const zones = snapZones(AREA, 680, 108);

  it('finds the zone under the pointer, or none', () => {
    expect(zoneAt(zones, { x: 30, y: 30 })).toBe('top-left');
    expect(zoneAt(zones, { x: 960, y: 100 })).toBe('top-center');
    expect(zoneAt(zones, { x: 1800, y: 30 })).toBe('top-right');
    expect(zoneAt(zones, { x: 960, y: 500 })).toBeNull();
  });

  it('keeps the ghosts apart however wide the overlay is', () => {
    const [left, centre, right] = snapZones({ x: 0, y: 0, width: 1280, height: 720 }, 680, 108);
    expect(left!.rect.x + left!.rect.width).toBeLessThan(centre!.rect.x);
    expect(centre!.rect.x + centre!.rect.width).toBeLessThan(right!.rect.x);
    expect(zoneAt(zones, { x: 644, y: 30 })).toBeNull();
  });

  it('gives the nearest centre if zones ever overlap', () => {
    const overlapping = [
      { preset: 'top-left' as const, rect: { x: 0, y: 0, width: 700, height: 100 } },
      { preset: 'top-center' as const, rect: { x: 600, y: 0, width: 700, height: 100 } },
    ];
    expect(zoneAt(overlapping, { x: 620, y: 30 })).toBe('top-left');
    expect(zoneAt(overlapping, { x: 680, y: 30 })).toBe('top-center');
  });

  it('finds none between the zones of a narrow overlay', () => {
    expect(zoneAt(snapZones(AREA, 300, 108), { x: 500, y: 30 })).toBeNull();
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
  it('shows the zones in a window that takes no clicks, with the overlay on top', () => {
    const { zones, windows, overlay } = setup();
    zones.moving(overlay);
    const window = windows[0]!;
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(window.showInactive).toHaveBeenCalled();
    const url = new URL(window.loadURL.mock.calls[0]![0]);
    expect(url.pathname).toBe('/overlay-zones');
    expect(url.searchParams.get('zones')).toBe(
      'top-left,24,24,608,320;top-center,656,24,608,320;top-right,1288,24,608,320',
    );
    expect(overlay.moveTop).toHaveBeenCalled();
  });

  it('tells the page which zone the pointer is on, once per change', () => {
    const { zones, windows, pointer, overlay } = setup();
    zones.moving(overlay);
    const send = windows[0]!.webContents.send;
    vi.advanceTimersByTime(200);
    expect(send).not.toHaveBeenCalled();
    pointer.x = 960;
    pointer.y = 100;
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(SNAP_ZONE_CHANNEL, 'top-center');
    pointer.y = 900;
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenLastCalledWith(SNAP_ZONE_CHANNEL, null);
  });

  it('snaps to the zone it is dropped on, and hides the zones', () => {
    const { zones, windows, pointer, snapTo, overlay } = setup();
    zones.moving(overlay);
    pointer.x = 1800;
    pointer.y = 30;
    zones.moved();
    expect(snapTo).toHaveBeenCalledWith('top-right');
    expect(windows[0]!.hide).toHaveBeenCalled();
  });

  it('does not snap when dropped elsewhere', () => {
    const { zones, windows, snapTo, overlay } = setup();
    zones.moving(overlay);
    zones.moved();
    expect(snapTo).not.toHaveBeenCalled();
    expect(windows[0]!.hide).toHaveBeenCalled();
  });

  it('ignores a "moved" with no drag going on, as from a nudge or a preset', () => {
    const { zones, snapTo } = setup();
    zones.moved();
    expect(snapTo).not.toHaveBeenCalled();
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

  it('on macOS, waits for a quiet moment, as "moved" fires all through a drag', () => {
    const { zones, pointer, snapTo, overlay } = setup('darwin');
    zones.moving(overlay);
    pointer.x = 30;
    pointer.y = 30;
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
