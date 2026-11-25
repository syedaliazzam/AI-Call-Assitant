/**
 * File: apps/desktop/src/snapZones.ts
 * Purpose: The snap zones shown while the overlay is dragged (v1.1.0, ADR-0041): ghost layouts at the
 *          overlay's places on the display. v1.3.0 (ADR-0056): all six positions (a 2 × 3 grid); the
 *          one nearest to the dragged overlay is highlighted, and dropping it anywhere snaps it there
 *          (src/positions.ts). Dragged onto another display, the zones follow. A see-through window over
 *          the display's work area, on /overlay-zones of the Kite origin, that takes no clicks and never
 *          takes focus.
 * Used by: src/main.ts, src/windows.ts (reports the drag)
 * Depends on: electron (BrowserWindow, Screen types), src/security.ts (secureWebPreferences),
 *             src/positions.ts, src/windows.ts (types), @kite/shared (SNAP_PRESETS)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.3; ADR-0041; ADR-0120 (Mac Spaces)
 *
 * It is a momentary drawing aid, so it stays out of the taskbar; Kite itself never does (CLAUDE.md).
 * Screen-share protection applies to it like every Kite window, so a protected overlay's zones do not
 * show in a share either.
 */
import { SNAP_PRESETS, type OverlayPreset } from '@kite/shared';
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, Screen } from 'electron';
import { SNAP_ZONE_CHANNEL } from './channels';
import { nearestPosition, POSITION_MARGIN, positionPlace } from './positions';
import { secureWebPreferences } from './security';
import type { OverlayDragWatcher } from './windows';

/** How often the pointer is read during a drag, in ms. */
const POLL_MS = 50;

/** macOS fires 'moved' all through a drag: a drag has ended after this long without one, in ms. */
const MAC_QUIET_MS = 250;

/** The space around each ghost layout, in DIPs (the same as the overlay's distance from the edge). */
const GHOST_GAP = POSITION_MARGIN;

/** The tallest a ghost layout is drawn, in DIPs: the two rows never meet. */
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
 * the display nor taller than half of it, so the six stay apart however big the overlay is; dropping
 * still puts the whole overlay at the place.
 *
 * @param area   The display's work area.
 * @param width  The overlay's width.
 * @param height The overlay's height.
 * @returns One zone per place: the top row left to right, then the bottom row.
 * Called from: createSnapZones(); tests
 */
export function snapZones(area: Rectangle, width: number, height: number): SnapZone[] {
  const ghost = Math.max(
    1,
    Math.min(height, GHOST_MAX_HEIGHT, Math.floor((area.height - 3 * GHOST_GAP) / 2)),
  );
  const ghostWidth = Math.max(1, Math.min(width, Math.floor((area.width - 4 * GHOST_GAP) / 3)));
  return SNAP_PRESETS.map((preset) => ({
    preset,
    rect: {
      ...positionPlace(preset, area, ghostWidth, ghost),
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
 * Whether two rectangles are the same.
 *
 * @param a The first, or null.
 * @param b The second.
 * @returns True when they match.
 * Called from: createSnapZones() (track)
 */
const sameRect = (a: Rectangle | null, b: Rectangle) =>
  !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

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
  let hover: OverlayPreset | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  /** The overlay being dragged. */
  let dragged: BrowserWindow | null = null;
  /** The work area the zones are drawn on (the display the overlay is on). */
  let zonesArea: Rectangle | null = null;

  /**
   * Draws the zones on a display's work area for the overlay's size.
   *
   * @param overlay The overlay.
   * @param area    The work area.
   */
  const show = (overlay: BrowserWindow, area: Rectangle) => {
    const bounds = overlay.getBounds();
    zonesArea = area;
    const zones = snapZones(area, bounds.width, bounds.height);
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
      // ADR-0120: on a Mac, on every Space, full-screen ones too, as the overlay is (ADR-0111 §3,
      // floatOverFullScreen() in windows.ts): over a full-screen meeting the zones were left on the normal
      // desktop. Done once, when the window is made (it is reused for every drag), so the Dock icon's short
      // blink that Electron's call causes happens at most once per run.
      if (deps.platform === 'darwin') {
        zonesWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
    } else {
      zonesWindow.setBounds(area);
    }
    void zonesWindow.loadURL(url.toString());
    zonesWindow.showInactive();
    // The overlay stays above its own ghosts.
    overlay.moveTop();
    // The new page highlights again once it has loaded.
    hover = null;
  };

  /** Finds the position nearest to the dragged overlay and tells the page to highlight it. */
  const track = () => {
    if (!dragged || dragged.isDestroyed()) return;
    const bounds = dragged.getBounds();
    const area = deps.screen.getDisplayMatching(bounds).workArea;
    // Dragged onto another display: the zones follow it.
    if (!sameRect(zonesArea, area)) show(dragged, area);
    const next = nearestPosition(bounds, area);
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
    dragged = null;
    zonesArea = null;
    if (zonesWindow && !zonesWindow.isDestroyed()) zonesWindow.hide();
    if (dropped) deps.snapTo(dropped);
  };

  return {
    moving(overlay) {
      if (poll !== null) return;
      dragged = overlay;
      show(overlay, deps.screen.getDisplayMatching(overlay.getBounds()).workArea);
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
      dragged = null;
      zonesArea = null;
      if (zonesWindow && !zonesWindow.isDestroyed()) zonesWindow.close();
      zonesWindow = null;
    },
  };
}
