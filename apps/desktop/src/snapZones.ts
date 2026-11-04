/**
 * File: apps/desktop/src/snapZones.ts
 * Purpose: The snap zones shown while the overlay is dragged (v1.1.0, ADR-0041): three ghost layouts
 *          along the top of the display (left, centre, right), the one under the pointer highlighted;
 *          dropping the overlay on one puts it there. A see-through window over the display's work
 *          area, on /overlay-zones of the Kite origin, that takes no clicks and never takes focus.
 * Used by: src/main.ts, src/windows.ts (reports the drag)
 * Depends on: electron (BrowserWindow, Screen types), src/security.ts (secureWebPreferences),
 *             src/windows.ts (presetPosition), @kite/shared (SNAP_PRESETS)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.3; ADR-0041
 *
 * It is a momentary drawing aid, so it stays out of the taskbar; Kite itself never does (CLAUDE.md).
 * Screen-share protection applies to it like every Kite window, so a protected overlay's zones do not
 * show in a share either.
 */
import { SNAP_PRESETS, type OverlayPreset } from '@kite/shared';
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, Screen } from 'electron';
import { SNAP_ZONE_CHANNEL } from './channels';
import { secureWebPreferences } from './security';
import { presetPosition, type OverlayDragWatcher } from './windows';

/** How often the pointer is read during a drag, in ms. */
const POLL_MS = 50;

/** macOS fires 'moved' all through a drag: a drag has ended after this long without one, in ms. */
const MAC_QUIET_MS = 250;

/** The space around each ghost layout, in DIPs (the same as the overlay's distance from the edge). */
const GHOST_GAP = 24;

/** The tallest a ghost layout is drawn, in DIPs: the zones stay along the top of the screen. */
const GHOST_MAX_HEIGHT = 320;

/** One snap zone on a display. */
export interface SnapZone {
  /** Where it puts the overlay. */
  preset: OverlayPreset;
  /** The ghost's rectangle, in screen DIPs. */
  rect: Rectangle;
}

/**
 * The snap zones on a display, for an overlay of a given size. A ghost is never wider than a third of
 * the display, so the three stay apart however wide the overlay is; dropping on one still puts the whole
 * overlay at that place.
 *
 * @param area   The display's work area.
 * @param width  The overlay's width.
 * @param height The overlay's height.
 * @returns One zone per place, left to right.
 * Called from: createSnapZones(); tests
 */
export function snapZones(area: Rectangle, width: number, height: number): SnapZone[] {
  const ghost = Math.min(height, GHOST_MAX_HEIGHT);
  const ghostWidth = Math.min(width, Math.floor((area.width - 4 * GHOST_GAP) / 3));
  return SNAP_PRESETS.map((preset) => ({
    preset,
    rect: {
      ...presetPosition(preset, area, ghostWidth, ghost),
      width: ghostWidth,
      height: ghost,
    },
  }));
}

/**
 * The zone under the pointer. A wide overlay on a small screen makes the zones overlap: the nearest
 * centre wins, so each side of the screen goes to its own zone.
 *
 * @param zones The zones.
 * @param point The pointer, in screen DIPs.
 * @returns The zone's place, or null when the pointer is on none.
 * Called from: createSnapZones(); tests
 */
export function zoneAt(
  zones: readonly SnapZone[],
  point: { x: number; y: number },
): OverlayPreset | null {
  const hits = zones.filter(
    ({ rect }) =>
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height,
  );
  const distance = ({ rect }: SnapZone) => Math.abs(rect.x + rect.width / 2 - point.x);
  return (
    hits.reduce<SnapZone | null>(
      (nearest, zone) => (!nearest || distance(zone) < distance(nearest) ? zone : nearest),
      null,
    )?.preset ?? null
  );
}

/**
 * The zones window's options: see-through, always on top, never focused, in no taskbar, sized to the
 * display's work area.
 *
 * @param area        The display's work area.
 * @param preloadPath The preload script.
 * @param appVersion  The shell version.
 * @returns BrowserWindow options.
 * Called from: createSnapZones(); tests
 */
export function snapWindowOptions(
  area: Rectangle,
  preloadPath: string,
  appVersion: string,
): BrowserWindowConstructorOptions {
  return {
    ...area,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: secureWebPreferences(preloadPath, appVersion),
  };
}

/** What createSnapZones() needs. */
export interface SnapDeps {
  /** Creates a window. */
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  /** Electron's screen module. */
  screen: Pick<Screen, 'getDisplayMatching' | 'getCursorScreenPoint'>;
  /** The Kite URL. */
  kiteUrl: string;
  /** The preload script path. */
  preloadPath: string;
  /** The shell version. */
  appVersion: string;
  /** process.platform. */
  platform: NodeJS.Platform;
  /** Puts the overlay at a place (the drop). */
  snapTo: (preset: OverlayPreset) => void;
}

/**
 * Creates the snap zones.
 *
 * @param deps See SnapDeps.
 * @returns What the overlay's window reports a drag to.
 * Called from: start() in main.ts; tests
 */
export function createSnapZones(deps: SnapDeps): OverlayDragWatcher & {
  /** Closes the zones window, if any (the overlay closed). */
  close(): void;
} {
  let zonesWindow: BrowserWindow | null = null;
  let zones: SnapZone[] = [];
  let hover: OverlayPreset | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let quiet: ReturnType<typeof setTimeout> | null = null;

  /** Reads the pointer and tells the page which zone it is on. */
  const track = () => {
    const next = zoneAt(zones, deps.screen.getCursorScreenPoint());
    if (next === hover) return;
    hover = next;
    if (zonesWindow && !zonesWindow.isDestroyed()) {
      zonesWindow.webContents.send(SNAP_ZONE_CHANNEL, hover);
    }
  };

  /** Ends the drag: hides the zones, and snaps the overlay if it was dropped on one. */
  const finish = () => {
    if (poll === null) return;
    clearInterval(poll);
    poll = null;
    if (quiet) clearTimeout(quiet);
    quiet = null;
    track();
    const dropped = hover;
    hover = null;
    if (zonesWindow && !zonesWindow.isDestroyed()) zonesWindow.hide();
    if (dropped) deps.snapTo(dropped);
  };

  return {
    moving(overlay) {
      if (poll !== null) return;
      const bounds = overlay.getBounds();
      const area = deps.screen.getDisplayMatching(bounds).workArea;
      zones = snapZones(area, bounds.width, bounds.height);
      const url = new URL('/overlay-zones', deps.kiteUrl);
      url.searchParams.set(
        'zones',
        zones
          .map(({ preset, rect }) =>
            [preset, rect.x - area.x, rect.y - area.y, rect.width, rect.height].join(','),
          )
          .join(';'),
      );
      if (!zonesWindow || zonesWindow.isDestroyed()) {
        zonesWindow = deps.createWindow(snapWindowOptions(area, deps.preloadPath, deps.appVersion));
        zonesWindow.setIgnoreMouseEvents(true);
        zonesWindow.setAlwaysOnTop(true, 'floating');
      } else {
        zonesWindow.setBounds(area);
      }
      void zonesWindow.loadURL(url.toString());
      zonesWindow.showInactive();
      // The overlay stays above its own ghosts.
      overlay.moveTop();
      hover = null;
      poll = setInterval(track, POLL_MS);
    },
    moved() {
      if (poll === null) return;
      if (deps.platform === 'darwin') {
        // macOS fires this all through a drag: wait for a quiet moment instead.
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(finish, MAC_QUIET_MS);
        return;
      }
      finish();
    },
    close() {
      if (poll !== null) clearInterval(poll);
      poll = null;
      if (quiet) clearTimeout(quiet);
      quiet = null;
      if (zonesWindow && !zonesWindow.isDestroyed()) zonesWindow.close();
      zonesWindow = null;
    },
  };
}
