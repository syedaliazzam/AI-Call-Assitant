/**
 * File: apps/desktop/src/windows.ts
 * Purpose: The overlay, the compact live window (architecture §7.3; ADR-0029): frameless, always
 *          on top, resizable, shown without taking focus from the meeting (showInactive), at its
 *          last position and size; loads /compact/[id] from the Kite origin only; screen-share
 *          protection applied (protection.ts). Opened and closed by the Kite page over IPC
 *          (`kite:open-compact`, `kite:close-compact`), and closed with the main window. The page
 *          sets its opacity and collapses it; global shortcuts show, hide and move it. Closing
 *          it brings back the main window, which a call may have minimised.
 *          v1.0.2 (ADR-0035): the window is see-through (transparent, with the native blur as a
 *          bonus), opens at the top centre at 560 × 420, can be put at a preset place, snaps to the
 *          screen's edges after a move, is resized from its edges by the page, and has a slim
 *          script-bar mode next to its full and collapsed modes.
 *          v1.0.4 (ADR-0040): ⛶ opens the full call window (the main window) and hides the overlay;
 *          the expanded overlay mode is gone.
 *          v1.1.0 (ADR-0041): stacked bars and panels. The page says which panels are open
 *          (setLayout) and the window fits them, growing downward and remembering a height for each
 *          set of panels; its place is remembered per display; snap zones show during a drag.
 *          A web app before 1.1.0 never calls setLayout, and gets the fixed window it expects.
 *          v1.2.0 (spec S13, S15): an icon mode, 48 px square, moved by the page; with both panels open
 *          the window also grows sideways, about its centre, so they fit side by side.
 *          v1.3.0 (ADR-0056): six positions in a 2 × 3 grid (src/positions.ts), 16 DIPs from the work
 *          area's edges: jump shortcuts, the ⋮ grid and a drop after a drag put it at one, remembered
 *          per display. On the bottom row the window is anchored at its bottom edge: it grows and
 *          shrinks upward, and the page puts its panels above the bars.
 *          v1.3.2 (ADR-0061): the window is fitted to the bars and panels the page shows
 *          (OverlayLayout.contentHeight, fittedHeight()), so it covers nothing else; releaseFocus() gives the
 *          keyboard back to the app behind after a click on a panel (kite:overlay-release-focus).
 * Used by: src/main.ts
 * Depends on: electron (BrowserWindow, Screen, IpcMain types), src/security.ts
 *             (secureWebPreferences), src/protection.ts, src/store.ts, src/channels.ts,
 *             src/hotkeys.ts (isKiteSender), src/positions.ts, @kite/shared (overlay types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §7.3 (windows.ts);
 *               day-05-overlay-screenshots-notes.md Stage 3; ADR-0029, ADR-0033, ADR-0035
 *
 * Focus: the window appears and updates without taking focus (showInactive; the page's updates
 * never call focus()), so the meeting keeps the keyboard. Clicking into it focuses it like any
 * window, so its chat box takes typing. It stays in the taskbar and Alt+Tab.
 */
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  Rectangle,
  Screen,
} from 'electron';
import {
  OVERLAY_PRESETS,
  overlayRow,
  type GlobalHotkey,
  type OverlayJump,
  type OverlayEdge,
  type OverlayLayout,
  type OverlayMode,
  type OverlayPreset,
  type OverlayResizeStep,
} from '@kite/shared';
import {
  CLOSE_COMPACT_CHANNEL,
  MINIMIZE_MAIN_CHANNEL,
  OPEN_COMPACT_CHANNEL,
  OVERLAY_CLICK_THROUGH_CHANNEL,
  OVERLAY_COLLAPSE_CHANNEL,
  OVERLAY_LAYOUT_CHANNEL,
  OVERLAY_MODE_CHANNEL,
  OVERLAY_MOVE_CHANNEL,
  OVERLAY_OPACITY_CHANNEL,
  OVERLAY_PLACE_CHANNEL,
  OVERLAY_POSITION_CHANNEL,
  OVERLAY_POSITION_EVENT,
  OVERLAY_PRESET_CHANNEL,
  OVERLAY_RELEASE_FOCUS_CHANNEL,
  OVERLAY_RESIZE_CHANNEL,
  SHOW_CALL_WINDOW_CHANNEL,
} from './channels';
import { APP_NAME } from './config';
import { isKiteSender } from './hotkeys';
import { isOverlayJump, jumpPosition, nearestPosition, positionPlace } from './positions';
import type { Protection } from './protection';
import { secureWebPreferences } from './security';
import type { Bounds, OverlayLayoutKey, ShellStore } from './store';

/**
 * The overlay's default size, in DIPs (v1.0.3, ADR-0039; 560 × 420 in v1.0.2): three bars with a
 * typical answer (answer line, three bullets, footer) visible without scrolling, still small
 * enough to sit above a meeting's video at the top centre. v1.2.0: 780 wide, which fits every key-cap on
 * bar 1 (spec S13); v1.3.0 (ADR-0055): 900, for the Transcript pill too; 1.5.0 (ADR-0068): 980, for the
 * Rec pill and its key-cap too (measured: bar 1 needs about 950 with it). The height is what a web app
 * before 1.1.0 gets. 1.6.4 (ADR-0082): no longer the overlay's default size (overlayDefaultSize() is); the
 * height is still what save() stores for a rolled-back web app.
 */
export const COMPACT_DEFAULT_SIZE = { width: 980, height: 480 };

/**
 * 1.6.4 (ADR-0082): the overlay's default size as a share of the work area of the display it opens on: a
 * third of its width, and up to half of its height with panels open (the height still follows what the
 * panels show). Bar 1 no longer has Answer, Screenshot and Chat, and gives way step by step when narrow,
 * with ⋮ and Exit always whole (ADR-0075).
 */
export const OVERLAY_DEFAULT_SHARE = { width: 1 / 3, height: 1 / 2 };

/** 1.6.4 (ADR-0082): the version of the default size; a store with a lower one takes it once. */
export const OVERLAY_DEFAULT_SIZE_VERSION = 164;

/** v1.2.0 (spec S15): the window's width with both panels open, side by side, in DIPs. */
export const OVERLAY_BOTH_WIDTH = 1080;

/** v1.2.0 (spec S13): the icon's size, in DIPs. */
export const OVERLAY_ICON_SIZE = 48;

/**
 * v1.1.0 (ADR-0041): the window's default height with each set of panels open, in DIPs. v1.2.0: bar 1 is
 * 44 tall and bar 2 with its strip about 84, with a 6 px gap; the transcript panel takes bar 2's place,
 * and both panels sit side by side, so together they need no more than the taller one.
 */
export const OVERLAY_LAYOUT_HEIGHTS: Readonly<Record<OverlayLayoutKey, number>> = {
  bars: 136,
  transcript: 390,
  answer: 500,
  both: 540,
};

/** v1.1.0: the smallest height with each set of panels open, in DIPs. */
export const OVERLAY_LAYOUT_MIN_HEIGHTS: Readonly<Record<OverlayLayoutKey, number>> = {
  bars: 108,
  transcript: 240,
  answer: 280,
  both: 440,
};

/** The tallest a menu may ask the window to grow, in DIPs (a bad value cannot fill the screen). */
const MAX_POPUP_HEIGHT = 900;

/** v1.3.2: the tallest content height the page may report, in DIPs (taller than any screen's work area). */
const MAX_CONTENT_HEIGHT = 8_000;

/**
 * The overlay's smallest size, in DIPs (v1.0.3: 560 wide, the narrowest that still showed the key hints on
 * Answer, Screenshot and Chat). 1.6.4 (ADR-0082): 440, so a third of a 1366-wide laptop screen fits; bar 1
 * has no Answer, Screenshot and Chat buttons any more, and ⋮ and Exit always fit.
 */
export const COMPACT_MIN_SIZE = { width: 440, height: 260 };

/** The overlay's height when collapsed to its controls bar, in DIPs (v1.1.0: 60 → 56, bar 1's own). */
export const COMPACT_COLLAPSED_HEIGHT = 56;

/**
 * The script bar (v1.0.2, ADR-0035): a slim bar with the answer line, and the height its one-line
 * input adds. `minWidth` is as narrow as it may be resized.
 */
export const SCRIPT_BAR_SIZE = { width: 640, height: 64, inputHeight: 48, minWidth: 360 };

/** Distance from the top of the screen of the script bar, in DIPs: close to the camera. */
const SCRIPT_BAR_TOP = 8;

/**
 * How close to a screen edge a moved overlay snaps flush to it, in DIPs (ADR-0035). v1.3.0 (ADR-0056):
 * 8, under the positions' 16 DIP margin, so a window at a position is never pulled onto the edge.
 */
export const SNAP_DISTANCE = 8;

/** The overlay's opacity range: below this the text is no longer readable. */
export const OVERLAY_OPACITY_RANGE = { min: 0.35, max: 1 };

/**
 * How far a nudge shortcut moves the overlay, in DIPs. `big` is the step an older web app's
 * `-big` actions asked for (until 1.2.0, Ctrl+Alt+Shift+Arrows); 1.3.0 nudges by the small step.
 */
export const OVERLAY_STEP = { small: 20, big: 100 };

/** How long after the last move or resize the position is saved, in ms. */
const SAVE_DELAY_MS = 500;

/**
 * The compact view's URL for a session, or null when the id is not a plain id (so nothing but
 * the Kite page's own route can ever be loaded).
 *
 * @param kiteUrl   The Kite URL (config).
 * @param sessionId The session id from the page.
 * @returns The URL, for example https://…/compact/abc.
 * Called from: createCompactWindows(); tests
 */
export function compactUrl(kiteUrl: string, sessionId: unknown): string | null {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return null;
  return new URL(`/compact/${sessionId}`, kiteUrl).toString();
}

/**
 * 1.6.4 (ADR-0082): the overlay's default size on a display: a third of its work area's width and half of
 * its height, never below the smallest size and never beyond the work area.
 *
 * @param area The display's work area.
 * @returns Width and height, in whole DIPs.
 * Called from: presetBounds(), createCompactWindows() (open, applyLayout); tests
 */
export function overlayDefaultSize(area: Pick<Rectangle, 'width' | 'height'>): {
  width: number;
  height: number;
} {
  const width = Math.min(
    area.width,
    Math.max(COMPACT_MIN_SIZE.width, area.width * OVERLAY_DEFAULT_SHARE.width),
  );
  const height = Math.min(
    area.height,
    Math.max(OVERLAY_LAYOUT_MIN_HEIGHTS.answer, area.height * OVERLAY_DEFAULT_SHARE.height),
  );
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * The overlay at a preset place in a work area, at the default size (1.6.4, ADR-0082: a third of the work
 * area's width and half its height), 16 DIPs from the work area's edges (v1.3.0; 24 before). The taskbar is
 * already outside the work area.
 *
 * @param preset Where.
 * @param area   The display's work area.
 * @returns The bounds, in whole DIPs.
 * Called from: restoreBounds(), createCompactWindows() (place); tests
 */
export function presetBounds(preset: OverlayPreset, area: Rectangle): Bounds {
  const { width, height } = overlayDefaultSize(area);
  return { ...presetPosition(preset, area, width, height), width, height };
}

/**
 * Where a window of a given size sits at a preset place in a work area.
 *
 * @param preset Where.
 * @param area   The display's work area.
 * @param width  The window's width.
 * @param height The window's height.
 * @returns The top-left corner, in whole DIPs.
 * Called from: presetBounds(), createCompactWindows() (snapTo); src/snapZones.ts; tests
 */
export function presetPosition(
  preset: OverlayPreset,
  area: Rectangle,
  width: number,
  height: number,
): { x: number; y: number } {
  // v1.3.0 (ADR-0056): one rule for all six positions (src/positions.ts).
  return positionPlace(preset, area, width, height);
}

/**
 * Which remembered height a layout uses (v1.1.0).
 *
 * @param layout The open panels.
 * @returns Its key.
 * Called from: createCompactWindows(); tests
 */
export function layoutKey(layout: Pick<OverlayLayout, 'transcript' | 'answer'>): OverlayLayoutKey {
  if (layout.transcript && layout.answer) return 'both';
  if (layout.transcript) return 'transcript';
  return layout.answer ? 'answer' : 'bars';
}

/**
 * The window's height for a layout, within what the display has below the window's top: it only ever
 * grows downward, so the bars stay under the pointer (v1.1.0).
 *
 * @param key         The layout's key.
 * @param popupHeight How tall an open menu needs the window to be (0 for none).
 * @param remembered  The height the user last gave this layout, if any.
 * @param available   The DIPs between the window's top and the bottom of the work area.
 * @param scale       The page's UI scale (default 1): the bars and the default heights grow with it.
 * @param panelsDefault 1.6.4 (ADR-0082): the default height with panels open (half the work area, from
 *                      overlayDefaultSize()); absent: the fixed OVERLAY_LAYOUT_HEIGHTS, as before.
 * @returns The height, in whole DIPs.
 * Called from: createCompactWindows(); tests
 */
export function layoutHeight(
  key: OverlayLayoutKey,
  popupHeight: number,
  remembered: number | undefined,
  available: number,
  scale = 1,
  panelsDefault?: number,
): number {
  // The bars-only height is exact, so it always follows the scale; a height the user chose stays.
  const base = key === 'bars' ? undefined : remembered;
  const byDefault =
    key === 'bars' || panelsDefault === undefined
      ? OVERLAY_LAYOUT_HEIGHTS[key] * scale
      : Math.max(OVERLAY_LAYOUT_MIN_HEIGHTS[key] * scale, panelsDefault);
  const wanted = Math.max(base ?? byDefault, popupHeight);
  return Math.round(Math.max(OVERLAY_LAYOUT_MIN_HEIGHTS.bars * scale, Math.min(wanted, available)));
}

/**
 * v1.3.2: the window's height fitted to what the page shows: never taller than the layout's height (the
 * most the user gave the panels), never shorter than the page's content, an open menu, or the bars' own
 * minimum. The empty space below shorter panels is then not part of the window at all, so it covers
 * nothing of the app behind.
 *
 * @param height        The layout's height (layoutHeight()).
 * @param contentHeight What the page's bars and panels need, in DIPs; undefined from an older page.
 * @param popupHeight   What an open menu needs (0 for none).
 * @param scale         The page's UI scale (default 1).
 * @returns The height, in whole DIPs.
 * Called from: createCompactWindows() (applyLayout); tests
 */
export function fittedHeight(
  height: number,
  contentHeight: number | undefined,
  popupHeight: number,
  scale = 1,
): number {
  if (contentHeight === undefined || contentHeight <= 0) return height;
  const floor = Math.max(contentHeight, popupHeight, OVERLAY_LAYOUT_MIN_HEIGHTS.bars * scale);
  return Math.round(Math.min(height, floor));
}

/**
 * Whether a value from the page is a layout: two booleans and a height within reason.
 *
 * @param value What arrived over IPC.
 * @returns True for a usable layout.
 * Called from: installCompactWindows(); tests
 */
export function isOverlayLayout(value: unknown): value is OverlayLayout {
  const layout = value as Partial<OverlayLayout> | null;
  return (
    !!layout &&
    typeof layout.transcript === 'boolean' &&
    typeof layout.answer === 'boolean' &&
    typeof layout.popupHeight === 'number' &&
    Number.isFinite(layout.popupHeight) &&
    layout.popupHeight >= 0 &&
    layout.popupHeight <= MAX_POPUP_HEIGHT &&
    (layout.scale === undefined ||
      (typeof layout.scale === 'number' && layout.scale >= 0.5 && layout.scale <= 2)) &&
    // v1.3.2: optional; when given, a finite height within reason.
    (layout.contentHeight === undefined ||
      (typeof layout.contentHeight === 'number' &&
        Number.isFinite(layout.contentHeight) &&
        layout.contentHeight >= 0 &&
        layout.contentHeight <= MAX_CONTENT_HEIGHT))
  );
}

/**
 * Where to open the window: the saved bounds if they still overlap a screen's work area by at
 * least 80 × 40 DIPs (a monitor may have been unplugged), otherwise the default size at the
 * remembered preset on the primary screen (top centre unless the user chose another; ADR-0035).
 *
 * @param saved     The saved bounds, if any.
 * @param workAreas Every display's work area.
 * @param primary   The primary display's work area.
 * @param preset    The remembered preset (default 'top-center').
 * @returns The bounds.
 * Called from: createCompactWindows(); tests
 */
export function restoreBounds(
  saved: Bounds | undefined,
  workAreas: readonly Rectangle[],
  primary: Rectangle,
  preset: OverlayPreset = 'top-center',
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
  return presetBounds(preset, primary);
}

/**
 * Snaps bounds flush to the edges of a work area they are within SNAP_DISTANCE of (ADR-0035): each
 * side is checked on its own, so a window near a corner snaps into the corner. The size never
 * changes.
 *
 * @param bounds   The window's bounds after a move.
 * @param area     The work area of the display it is on.
 * @param distance How close counts as near (default SNAP_DISTANCE).
 * @returns The snapped bounds (the same values when nothing was near an edge).
 * Called from: createCompactWindows() (after a move); tests
 */
export function snapBounds(bounds: Bounds, area: Rectangle, distance = SNAP_DISTANCE): Bounds {
  let { x, y } = bounds;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  if (Math.abs(x - area.x) <= distance) x = area.x;
  else if (Math.abs(x + bounds.width - right) <= distance) x = right - bounds.width;
  if (Math.abs(y - area.y) <= distance) y = area.y;
  else if (Math.abs(y + bounds.height - bottom) <= distance) y = bottom - bounds.height;
  return { ...bounds, x, y };
}

/**
 * The bounds after dragging an edge or corner by (dx, dy) from where the drag started (ADR-0035):
 * east and south grow the size; west and north also move the window, so the opposite edge stays
 * where it was. The size never goes below the minimum (the dragged edge stops instead), and the
 * dragged edge never leaves the work area.
 *
 * @param start The bounds when the drag started.
 * @param edge  The edge or corner dragged.
 * @param dx    Horizontal distance from the start, in DIPs.
 * @param dy    Vertical distance from the start, in DIPs.
 * @param min   The smallest size.
 * @param area  The work area of the display the window is on.
 * @returns The new bounds, in whole DIPs.
 * Called from: createCompactWindows() (resize); tests
 */
export function resizeBounds(
  start: Bounds,
  edge: OverlayEdge,
  dx: number,
  dy: number,
  min: { width: number; height: number },
  area: Rectangle,
): Bounds {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (edge.includes('e')) {
    right = Math.min(area.x + area.width, Math.max(left + min.width, right + dx));
  }
  if (edge.includes('w')) {
    left = Math.max(area.x, Math.min(right - min.width, left + dx));
  }
  if (edge.includes('s')) {
    bottom = Math.min(area.y + area.height, Math.max(top + min.height, bottom + dy));
  }
  if (edge.includes('n')) {
    top = Math.max(area.y, Math.min(bottom - min.height, top + dy));
  }
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

/**
 * Whether a value from the page is an overlay preset.
 *
 * @param value What arrived over IPC.
 * @returns True for one of OVERLAY_PRESETS.
 * Called from: installCompactWindows(); tests
 */
export function isOverlayPreset(value: unknown): value is OverlayPreset {
  return (OVERLAY_PRESETS as readonly unknown[]).includes(value);
}

/**
 * Whether a value from the page is an overlay mode.
 *
 * @param value What arrived over IPC.
 * @returns True for 'full', 'collapsed', 'script', 'script-input' or 'icon'.
 * Called from: installCompactWindows(); tests
 */
export function isOverlayMode(value: unknown): value is OverlayMode {
  return ['full', 'collapsed', 'script', 'script-input', 'icon'].includes(value as string);
}

/** What widening for both panels changed, so narrowing can undo it (v1.2.0). */
export interface NarrowPlace {
  /** The width to go back to. */
  width: number;
  /** How far left widening moved the window, in DIPs. */
  shift: number;
}

/**
 * Whether a value from the page is a move: finite distances no larger than any screen.
 *
 * @param value What arrived over IPC.
 * @returns True for a usable move.
 * Called from: installCompactWindows(); tests
 */
export function isOverlayMove(value: unknown): value is {
  /** Pixels to the right. */
  dx: number;
  /** Pixels down. */
  dy: number;
} {
  const move = value as { dx?: unknown; dy?: unknown } | null;
  return (
    !!move &&
    [move.dx, move.dy].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20_000,
    )
  );
}

/**
 * The window's place and width for a set of panels (v1.2.0): wider with both open, narrow again after,
 * growing about its centre so the bars stay where they were, and always inside the display.
 *
 * @param bounds  The window's bounds now.
 * @param wanted  The width it should have.
 * @param area    The display's work area.
 * @returns Its x and width.
 * Called from: createCompactWindows(); tests
 */
export function widthAboutCentre(
  bounds: Pick<Bounds, 'x' | 'width'>,
  wanted: number,
  area: Pick<Rectangle, 'x' | 'width'>,
): { x: number; width: number } {
  const width = Math.round(Math.min(wanted, area.width));
  const x = bounds.x + Math.round((bounds.width - width) / 2);
  return { x: Math.max(area.x, Math.min(x, area.x + area.width - width)), width };
}

/**
 * The window's place and width after both panels close (v1.2.0): it undoes what widening did, which is
 * not simply "about the centre" when the display's edge limited it, and it keeps any move made since.
 *
 * @param bounds The window's bounds now.
 * @param narrow The width it had, and how far left widening moved it.
 * @param area   The display's work area.
 * @returns Its x and width.
 * Called from: createCompactWindows(); tests
 */
export function narrowedBounds(
  bounds: Pick<Bounds, 'x'>,
  narrow: NarrowPlace,
  area: Pick<Rectangle, 'x' | 'width'>,
): { x: number; width: number } {
  const x = bounds.x + narrow.shift;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - narrow.width)),
    width: narrow.width,
  };
}

/**
 * Where the overlay opens from the icon: the icon stays the top centre of the overlay (on the bottom
 * row, v1.3.0: its bottom centre), inside the display, so the bars come back where the icon was dragged
 * to.
 *
 * @param icon The icon's bounds.
 * @param full The overlay's bounds before it shrank.
 * @param area The display's work area.
 * @param row  The overlay's row (default 'top').
 * @returns The overlay's bounds.
 * Called from: createCompactWindows(); tests
 */
export function fromIconBounds(
  icon: Bounds,
  full: Bounds,
  area: Rectangle,
  row: 'top' | 'bottom' = 'top',
): Bounds {
  const x = icon.x - Math.round((full.width - icon.width) / 2);
  const y = row === 'bottom' ? icon.y + icon.height - full.height : icon.y;
  return {
    ...full,
    x: Math.max(area.x, Math.min(x, area.x + area.width - full.width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - full.height)),
  };
}

/**
 * Whether a value from the page is one step of a resize: a known phase and edge, and finite
 * distances no larger than any screen (a bad value cannot throw the window off the screen).
 *
 * @param value What arrived over IPC.
 * @returns True for a usable step.
 * Called from: installCompactWindows(); tests
 */
export function isResizeStep(value: unknown): value is OverlayResizeStep {
  const step = value as Partial<OverlayResizeStep> | null;
  return (
    !!step &&
    ['start', 'move', 'end'].includes(step.phase as string) &&
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(step.edge as string) &&
    [step.dx, step.dy].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20_000,
    )
  );
}

/**
 * The window options that make the overlay see-through (ADR-0035; adjusts ADR-0031 and ADR-0033).
 *
 * See-through is the main effect: the window is `transparent`, so wherever the page paints nothing
 * the meeting shows, and the panel's own background (70 % by default, the opacity slider) keeps
 * the text readable over a busy window. Electron honours a clear `backgroundColor` only on a
 * transparent window (Electron 44 docs: "Alpha in #AARRGGBB format is supported if transparent is
 * set to true"), which is why v1.0.1's overlay painted solid black behind its panel on Windows.
 *
 * The blur is a bonus: Windows' acrylic material and macOS's vibrancy blur what is behind. Windows
 * appears to draw acrylic only while the window is the focused one, and the overlay is shown
 * without focus (the meeting keeps the keyboard), so on Windows the blur is mostly seen while the
 * user is clicking or typing in the overlay. Windows 10 has no acrylic: the panel is then simply
 * see-through. A transparent window has no system frame, so it is not maximisable or full-screen
 * (double-clicking the drag bar must not cover the meeting), and on Windows and Linux its shadow
 * is off: the system shadow is a rectangle around the rounded panel. macOS draws the shadow from
 * the window's content, so it stays.
 *
 * @param platform The operating system.
 * @returns The options to add.
 * Called from: compactWindowOptions(); tests
 */
export function overlayGlass(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  const seeThrough: BrowserWindowConstructorOptions = {
    transparent: true,
    maximizable: false,
    fullscreenable: false,
  };
  if (platform === 'darwin') {
    return { ...seeThrough, vibrancy: 'hud', visualEffectState: 'active' };
  }
  // A clear background, not a colour: a colour would hide what is behind the window.
  const clear: BrowserWindowConstructorOptions = {
    ...seeThrough,
    backgroundColor: '#00000000',
    hasShadow: false,
  };
  // Windows (v1.0.3, ADR-0039): no acrylic. Measured on the real screen, Windows' acrylic blurs what
  // is behind into unreadable colour (and is drawn only for a focused window), which read as "not
  // see-through". Plain transparency shows the meeting behind the 70% panel; the panel's tint and
  // the text shadow keep the text readable.
  return clear;
}

/**
 * The compact window's options.
 *
 * @param bounds      Where to open it.
 * @param preloadPath The preload script (window.kiteDesktop).
 * @param appVersion  The shell version (for the bridge).
 * @param platform    The operating system (tests pass one; the app uses process.platform).
 * @returns BrowserWindow options: frameless, always on top, resizable (from the system's edges where
 *          it allows, and always by the page's own edge handles: resizeBounds()), see-through,
 *          hidden until shown without focus, with the same secure web preferences as the main
 *          window.
 * Called from: createCompactWindows(); tests
 */
export function compactWindowOptions(
  bounds: Bounds,
  preloadPath: string,
  appVersion: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    minWidth: COMPACT_MIN_SIZE.width,
    minHeight: COMPACT_MIN_SIZE.height,
    title: `${APP_NAME} (overlay)`,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    // Visible in the taskbar and Alt+Tab like any window (never hidden: CLAUDE.md).
    skipTaskbar: false,
    show: false,
    ...overlayGlass(platform),
    webPreferences: secureWebPreferences(preloadPath, appVersion),
  };
}

/** What createCompactWindows() needs. */
export interface CompactDeps {
  /** Creates a window (new BrowserWindow in the app; a fake in tests). */
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  /** Electron's screen module (getDisplayMatching: the display the overlay is on, ADR-0035). */
  screen: Pick<Screen, 'getAllDisplays' | 'getPrimaryDisplay' | 'getDisplayMatching'>;
  /** The Kite URL. */
  kiteUrl: string;
  /** The preload script path. */
  preloadPath: string;
  /** The shell version. */
  appVersion: string;
  /** Remembered position and size. */
  store: ShellStore;
  /** Screen-share protection. */
  protection: Protection;
  /** Called when the overlay has closed (brings back the main window). Optional in tests. */
  onClosed?: () => void;
  /** Snap zones during a drag (v1.1.0, src/snapZones.ts). Optional in tests. */
  snap?: OverlayDragWatcher;
  /**
   * v1.3.1 (ADR-0058): whether a jump between the six positions slides (150 ms) instead of moving at
   * once. main.ts answers from the system's "reduce motion" setting. Missing (tests): it never slides.
   */
  slideJumps?: () => boolean;
}

/** v1.3.1 (ADR-0058): how long a jump between positions slides, in ms (the web's --k-dur token). */
export const JUMP_SLIDE_MS = 150;

/** One frame of the slide, in ms (about 60 a second). */
const JUMP_FRAME_MS = 16;

/**
 * The in-between places of a slide from one place to another, eased out (fast, then settling), the
 * last one exactly the target. Only the position moves; the size is the target's throughout.
 *
 * @param from   Where the window is.
 * @param to     Where it goes.
 * @param frames How many steps (at least 1).
 * @returns The bounds for each frame, in order.
 * Called from: goTo() in createCompactWindows(); tests
 */
export function slideFrames(from: Bounds, to: Bounds, frames: number): Bounds[] {
  const count = Math.max(1, Math.round(frames));
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    // Cubic ease-out, close to the web's --k-ease-out curve.
    const eased = 1 - (1 - t) ** 3;
    return {
      ...to,
      x: Math.round(from.x + (to.x - from.x) * eased),
      y: Math.round(from.y + (to.y - from.y) * eased),
    };
  });
}

/** What the overlay tells the snap zones about a drag (v1.1.0). */
export interface OverlayDragWatcher {
  /**
   * The user is dragging the overlay: show the zones (called many times during one drag).
   *
   * @param window The overlay.
   */
  moving(window: BrowserWindow): void;
  /** The overlay's move finished (a drag ended, or the window was moved some other way). */
  moved(): void;
}

/** The compact window. */
export interface CompactWindows {
  /**
   * Opens the window for a session (or shows the open one, switching session if needed),
   * without taking focus.
   *
   * @param sessionId The session id.
   * @returns False when the id is not a plain id.
   */
  open(sessionId: unknown): boolean;
  /** Closes it, if open. */
  close(): void;
  /** The open window, or null. */
  window(): BrowserWindow | null;
  /**
   * v1.3.0 (ADR-0055): lets clicks pass through the window to the app behind it while the pointer is
   * over a transparent gap (true), or takes them again (false). Pointer moves still reach the page
   * (forward), so it can switch back as soon as the pointer is over a bar or panel. The icon is never
   * passed through.
   *
   * @param through True to pass clicks through.
   */
  setClickThrough(through: boolean): void;
  /**
   * v1.3.2: gives the keyboard back to the app that had it, when the overlay has it (a click on a panel
   * control made the overlay the active window). Windows activates the next window below the overlay,
   * which is the app that was active before the click. Does nothing when the overlay has no focus, so
   * a late call never moves the keyboard away from what the user is doing.
   */
  releaseFocus(): void;
  /** Hides the overlay if it is showing; shows it again, without taking focus, if hidden. */
  toggle(): void;
  /**
   * Moves the overlay.
   *
   * @param dx Pixels to the right (negative: left).
   * @param dy Pixels down (negative: up).
   */
  move(dx: number, dy: number): void;
  /**
   * Sets the overlay's opacity, kept to a readable range.
   *
   * @param value What the page asked for.
   */
  setOpacity(value: unknown): void;
  /**
   * Collapses the overlay to its controls bar, or opens it to the size it had
   * (setMode('collapsed') / setMode('full')).
   *
   * @param collapsed True to collapse.
   */
  setCollapsed(collapsed: boolean): void;
  /**
   * v1.0.2 (ADR-0035): switches between full, collapsed and the script bar. Leaving a slim mode
   * for full brings back the bounds the overlay had in full mode.
   *
   * @param mode The mode.
   */
  setMode(mode: OverlayMode): void;
  /** The current mode ('full' when no overlay is open). */
  mode(): OverlayMode;
  /**
   * v1.0.2: puts the overlay at a preset place at its default size, on the display it is on, and
   * remembers the preset. With no overlay open it only remembers. In a slim mode the full-mode
   * bounds move there (and a collapsed bar moves with them), so the page's mode stays as it is.
   *
   * @param preset Where.
   */
  place(preset: OverlayPreset): void;
  /** The remembered preset ('top-center' until the user chooses another). */
  preset(): OverlayPreset;
  /**
   * v1.3.0 (ADR-0056): puts the open overlay at one of the six positions at its current size (the ⋮
   * grid), remembered for the display it is on. The script bar keeps its own place.
   *
   * @param preset Where.
   */
  goTo(preset: OverlayPreset): void;
  /**
   * v1.3.0: a jump shortcut: one spot left or right within the row (stopping at the edges), or to the
   * top or bottom row.
   *
   * @param jump The shortcut.
   */
  jump(jump: OverlayJump): void;
  /** v1.3.0: the open overlay's position, or null with no overlay open. */
  position(): OverlayPreset | null;
  /**
   * v1.1.0: which panels are open. The window fits them and growing never moves its top. A web app
   * before 1.1.0 never calls this.
   *
   * @param layout The open panels.
   */
  setLayout(layout: OverlayLayout): void;
  /**
   * v1.1.0: the overlay was dropped on a snap zone: it goes there at its current size, and the place
   * is remembered for this display.
   *
   * @param preset Where.
   */
  snapTo(preset: OverlayPreset): void;
  /**
   * v1.0.2: one step of a page-driven resize. 'move' and 'end' without a 'start' are ignored. In
   * the slim modes only the width changes.
   *
   * @param step The step.
   */
  resize(step: OverlayResizeStep): void;
}

/**
 * The overlay's movement for a shortcut, or null when it is not a move.
 *
 * @param action The global shortcut.
 * @returns The pixels to move by.
 * Called from: overlayShortcut(); tests
 */
export function overlayMove(action: GlobalHotkey): { dx: number; dy: number } | null {
  const match = /^overlay-(up|down|left|right)(-big)?$/.exec(action);
  if (!match) return null;
  const step = match[2] ? OVERLAY_STEP.big : OVERLAY_STEP.small;
  if (match[1] === 'up') return { dx: 0, dy: -step };
  if (match[1] === 'down') return { dx: 0, dy: step };
  if (match[1] === 'left') return { dx: -step, dy: 0 };
  return { dx: step, dy: 0 };
}

/**
 * Carries out an overlay shortcut.
 *
 * @param compact The controller.
 * @param action  The shortcut.
 * Called from: start() in main.ts (installHotkeys' overlayAction); tests
 */
export function overlayShortcut(compact: CompactWindows, action: GlobalHotkey): void {
  if (action === 'overlay-toggle') {
    compact.toggle();
    return;
  }
  if (isOverlayJump(action)) {
    compact.jump(action);
    return;
  }
  const move = overlayMove(action);
  if (move) compact.move(move.dx, move.dy);
}

/**
 * Creates the compact window controller.
 *
 * @param deps Window factory, screen, URL, preload, store and protection.
 * @returns The controller.
 * Called from: start() in main.ts; tests
 */
export function createCompactWindows(deps: CompactDeps): CompactWindows {
  let current: BrowserWindow | null = null;
  let loadedUrl = '';
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The window's mode (ADR-0035). */
  let mode: OverlayMode = 'full';
  /** The bounds the overlay had in full mode, kept while it is in a slim mode; null in full. */
  let fullBounds: Bounds | null = null;
  /** The bounds when the current page-driven resize started; null when none is going on. */
  let resizeStart: Bounds | null = null;
  /** True when the window moved since the last save (only a move snaps to the edges). */
  let movedSinceSave = false;
  /** v1.1.0: the panels the page says are open; null for a web app before 1.1.0. */
  let layout: OverlayLayout | null = null;
  /** v1.2.0: what to go back to while both panels have made the window wider; else null. */
  let narrow: NarrowPlace | null = null;
  /**
   * v1.3.0 (ADR-0056): the open overlay's position (the last one it was put at; a nudge keeps it), or
   * null with no overlay open. Its row says which edge the window grows from.
   */
  let position: OverlayPreset | null = null;

  /**
   * The row the window is anchored to: on the bottom row it grows and shrinks upward.
   *
   * @returns 'top' or 'bottom'.
   */
  const row = () => overlayRow(position ?? 'top-center');

  /** Tells the overlay's page its position (it puts the panels above the bars on the bottom row). */
  const announce = () => {
    if (!current || current.isDestroyed() || position === null) return;
    current.webContents?.send?.(OVERLAY_POSITION_EVENT, position);
  };

  /**
   * Remembers a position for the display a rectangle is on, and as the place new displays open at.
   *
   * @param preset The position.
   * @param bounds Where the window is.
   */
  const rememberPosition = (preset: OverlayPreset, bounds: Bounds) => {
    const display = deps.screen.getDisplayMatching(bounds);
    const positions = deps.store.read().overlayPositions ?? {};
    deps.store.write({
      overlayPreset: preset,
      ...(display ? { overlayPositions: { ...positions, [String(display.id)]: preset } } : {}),
    });
  };

  /**
   * The work area of the display a rectangle is mostly on (the primary one if none matches).
   *
   * @param bounds The rectangle.
   * @returns The work area.
   */
  const areaFor = (bounds: Bounds): Rectangle =>
    deps.screen.getDisplayMatching(bounds)?.workArea ?? deps.screen.getPrimaryDisplay().workArea;

  /**
   * The smallest size the window may have in a mode.
   *
   * @param which The mode.
   * @returns Width and height in DIPs.
   */
  const minFor = (which: OverlayMode) => {
    if (which === 'full') {
      return layout
        ? { width: COMPACT_MIN_SIZE.width, height: OVERLAY_LAYOUT_MIN_HEIGHTS[layoutKey(layout)] }
        : COMPACT_MIN_SIZE;
    }
    if (which === 'collapsed') {
      return { width: COMPACT_MIN_SIZE.width, height: COMPACT_COLLAPSED_HEIGHT };
    }
    if (which === 'icon') return { width: OVERLAY_ICON_SIZE, height: OVERLAY_ICON_SIZE };
    return {
      width: SCRIPT_BAR_SIZE.minWidth,
      height: SCRIPT_BAR_SIZE.height + (which === 'script-input' ? SCRIPT_BAR_SIZE.inputHeight : 0),
    };
  };

  /**
   * Sets the window's bounds and minimum size. When the window shrinks the minimum goes down first,
   * and when it grows it goes up last, so the system never refuses the new size.
   *
   * @param target The new bounds.
   * @param min    The new minimum size.
   */
  const apply = (target: Bounds, min: { width: number; height: number }) => {
    if (!current) return;
    const growing = target.height >= current.getBounds().height;
    if (!growing) current.setMinimumSize(min.width, min.height);
    current.setBounds(target);
    if (growing) current.setMinimumSize(min.width, min.height);
  };

  /**
   * Sizes the window to the open panels (full mode only; the slim modes have their own height). Its top
   * stays: it only ever grows downward, and with both panels open sideways about its centre.
   */
  const applyLayout = () => {
    if (!current || current.isDestroyed() || !layout || mode !== 'full') return;
    // v1.3.1: a panel opening mid-slide sizes the window at the slide's place.
    finishSlide();
    const bounds = current.getBounds();
    const area = areaFor(bounds);
    const key = layoutKey(layout);
    // v1.3.0: on the bottom row the bottom edge stays, so the room is above it.
    const bottomRow = row() === 'bottom';
    const height = layoutHeight(
      key,
      layout.popupHeight,
      deps.store.read().overlayHeights?.[key],
      bottomRow ? bounds.y + bounds.height - area.y : area.y + area.height - bounds.y,
      layout.scale,
      // 1.6.4 (ADR-0082): with panels open, up to half the display's height by default.
      overlayDefaultSize(area).height,
    );
    // v1.3.2: no taller than the bars and panels the page shows.
    const fitted = fittedHeight(height, layout.contentHeight, layout.popupHeight, layout.scale);
    let sideways = { x: bounds.x, width: bounds.width };
    if (key === 'both') {
      // 1.6.4 (ADR-0082): no widening by default (the panels stack in the third-of-the-screen window); a
      // width the user gave with both panels open still applies.
      const wanted = deps.store.read().overlayBothWidth ?? bounds.width;
      sideways = widthAboutCentre(bounds, Math.max(wanted, narrow?.width ?? bounds.width), area);
      narrow ??= { width: bounds.width, shift: bounds.x - sideways.x };
    } else if (narrow !== null) {
      sideways = narrowedBounds(bounds, narrow, area);
      narrow = null;
    }
    if (fitted === bounds.height && sideways.width === bounds.width) return;
    // The minimum drops to the bars first: a tall layout may not fit a short screen.
    current.setMinimumSize(COMPACT_MIN_SIZE.width, OVERLAY_LAYOUT_MIN_HEIGHTS.bars);
    const y = bottomRow ? Math.max(area.y, bounds.y + bounds.height - fitted) : bounds.y;
    current.setBounds({ ...bounds, ...sideways, y, height: fitted });
  };

  /**
   * The stacked overlay's place on the display it is on, remembered for that display (v1.1.0).
   *
   * @param bounds The window's bounds.
   */
  const savePlace = (bounds: Bounds) => {
    const display = deps.screen.getDisplayMatching(bounds);
    if (!display) return;
    const places = deps.store.read().overlayPlaces ?? {};
    deps.store.write({
      overlayPlaces: {
        ...places,
        [String(display.id)]: { x: bounds.x, y: bounds.y, width: bounds.width },
      },
    });
  };

  /**
   * The bounds to remember: the full-mode bounds, also in a slim mode. Collapsing keeps the
   * window's place and width, so a collapsed bar that was moved or widened is remembered moved
   * or widened, at its open height.
   *
   * @returns The bounds.
   */
  const fullModeBounds = (): Bounds => {
    const bounds = current!.getBounds();
    if (mode === 'icon' && fullBounds !== null) {
      return fromIconBounds(bounds, fullBounds, areaFor(bounds), row());
    }
    if (mode === 'full' || fullBounds === null) return bounds;
    if (mode === 'collapsed') {
      return row() === 'bottom'
        ? { ...bounds, y: bounds.y + bounds.height - fullBounds.height, height: fullBounds.height }
        : { ...bounds, height: fullBounds.height };
    }
    return fullBounds;
  };

  /**
   * The bounds to remember, at the width to open at: widening for both panels is not remembered as
   * the overlay's own width, or it would open wide with no panels.
   *
   * @returns The bounds.
   */
  const rememberedBounds = (): Bounds => {
    const full = fullModeBounds();
    return narrow === null ? full : { ...full, ...narrowedBounds(full, narrow, areaFor(full)) };
  };

  /**
   * Saves the window's position and size (the full-mode bounds). After a move in full or
   * collapsed mode it first snaps the window flush to a screen edge it ended up near; the script
   * bar sits a little below the top on purpose and is never snapped.
   */
  const save = () => {
    if (!current || current.isDestroyed()) return;
    if (movedSinceSave && (mode === 'full' || mode === 'collapsed')) {
      const bounds = current.getBounds();
      const snapped = snapBounds(bounds, areaFor(bounds));
      // Only when it changes: setBounds fires 'moved' again, and an unchanged window must not loop.
      if (snapped.x !== bounds.x || snapped.y !== bounds.y) current.setBounds(snapped);
    }
    movedSinceSave = false;
    const remembered = rememberedBounds();
    if (layout) {
      // Its height follows the panels. A rolled-back web app still reads compactBounds, and must get
      // a window it can use, not a 108 px strip.
      savePlace(remembered);
      deps.store.write({ compactBounds: { ...remembered, height: COMPACT_DEFAULT_SIZE.height } });
      return;
    }
    deps.store.write({ compactBounds: remembered });
  };

  /**
   * Switches the window's mode (see CompactWindows.setMode).
   *
   * @param next The mode.
   */
  const setMode = (next: OverlayMode) => {
    if (!current || current.isDestroyed() || next === mode) return;
    finishSlide();
    const bounds = current.getBounds();
    const previous = mode;
    if (next === 'full') {
      const full = fullBounds;
      mode = 'full';
      fullBounds = null;
      // From the controls bar: where the bar is now, at the open height. From the script bar:
      // back where the overlay was.
      // v1.3.0: on the bottom row the bars' bottom edge stays where it is.
      const bottomRow = row() === 'bottom';
      const area = areaFor(bounds);
      // An icon sitting exactly at its position (moved there by a jump or the grid) opens the bars at
      // that position; one dragged elsewhere opens them around it.
      const iconAtPosition =
        position !== null &&
        previous === 'icon' &&
        (({ x, y }) => x === bounds.x && y === bounds.y)(
          positionPlace(position, area, bounds.width, bounds.height),
        );
      const target =
        full === null
          ? bounds
          : iconAtPosition && position !== null
            ? { ...full, ...positionPlace(position, area, full.width, full.height) }
            : previous === 'icon'
              ? fromIconBounds(bounds, full, area, row())
              : previous === 'collapsed'
                ? bottomRow
                  ? { ...bounds, y: bounds.y + bounds.height - full.height, height: full.height }
                  : { ...bounds, height: full.height }
                : full;
      apply(target, COMPACT_MIN_SIZE);
      applyLayout();
      return;
    }
    if (previous === 'full') fullBounds = bounds;
    mode = next;
    // v1.3.0 (ADR-0055): the icon is all button; clicks never pass through it.
    if (next === 'icon') current.setIgnoreMouseEvents(false);
    const min = minFor(next);
    if (next === 'icon') {
      // The top centre of what was there (on the bottom row its bottom centre), so it shrinks
      // towards where the eye already is.
      const left = bounds.x + Math.round((bounds.width - OVERLAY_ICON_SIZE) / 2);
      const top = row() === 'bottom' ? bounds.y + bounds.height - OVERLAY_ICON_SIZE : bounds.y;
      // The minimum must drop first: this is always a shrink, in both directions.
      current.setMinimumSize(min.width, min.height);
      current.setBounds({ x: left, y: top, width: min.width, height: min.height });
      return;
    }
    if (next === 'collapsed') {
      // From full: same place and width. From the script bar: the full overlay's place and width.
      const base = previous === 'full' || fullBounds === null ? bounds : fullBounds;
      // v1.3.0: on the bottom row bar 1 stays at the bottom edge.
      const y = row() === 'bottom' ? base.y + base.height - COMPACT_COLLAPSED_HEIGHT : base.y;
      apply({ ...base, y, height: COMPACT_COLLAPSED_HEIGHT }, min);
      return;
    }
    // The script bar: opening or closing its input keeps the bar where the user put it;
    // arriving from another mode puts it at the top centre of the display the overlay is on.
    if (previous === 'script' || previous === 'script-input') {
      apply({ ...bounds, height: min.height }, min);
      return;
    }
    const area = areaFor(bounds);
    const width = Math.min(SCRIPT_BAR_SIZE.width, area.width);
    apply(
      {
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + SCRIPT_BAR_TOP,
        width,
        height: min.height,
      },
      min,
    );
  };

  /** v1.3.1: the timer of a jump that is still sliding, where it is going, and whether one is. */
  let slideTimer: ReturnType<typeof setInterval> | null = null;
  let slideTarget: Bounds | null = null;
  let sliding = false;

  /** Forgets a slide (it reached its place, or its window closed). */
  const stopSlide = () => {
    if (slideTimer) clearInterval(slideTimer);
    slideTimer = null;
    slideTarget = null;
    sliding = false;
  };

  /**
   * Ends a running slide at its place at once. Called first by everything else that moves or resizes
   * the overlay (a panel, a mode, a nudge, a resize, another jump), so they start from an exact place.
   */
  const finishSlide = () => {
    const target = slideTarget;
    stopSlide();
    if (target && current && !current.isDestroyed()) current.setBounds(target);
  };

  /**
   * Puts the open overlay at one of the six positions at its current size (see CompactWindows.goTo).
   * v1.3.1: it slides there over 150 ms unless the system asks for reduced motion.
   *
   * @param preset Where.
   */
  const goTo = (preset: OverlayPreset) => {
    if (!current || current.isDestroyed()) return;
    // The script bar sits near the camera on purpose; it keeps its place.
    if (mode === 'script' || mode === 'script-input') return;
    // A second jump during a slide starts from where the first one was going.
    finishSlide();
    const bounds = current.getBounds();
    const area = areaFor(bounds);
    position = preset;
    const target = { ...bounds, ...positionPlace(preset, area, bounds.width, bounds.height) };
    if (deps.slideJumps?.() === true) {
      // v1.3.1 (ADR-0058): slide there over 150 ms. The window's own 'moved' events are ignored
      // meanwhile, so the edge snap (save()) never pulls it off the exact place. Every step states
      // the target's size with the place: re-reading the size each step lets it creep by a pixel at
      // some display scales (150 %), and the last step is the exact target.
      const window = current;
      const frames = slideFrames(bounds, target, JUMP_SLIDE_MS / JUMP_FRAME_MS);
      sliding = true;
      slideTarget = target;
      let frame = 0;
      slideTimer = setInterval(() => {
        const next = frames[frame];
        frame += 1;
        if (window.isDestroyed() || next === undefined) {
          stopSlide();
          return;
        }
        window.setBounds(next);
        if (frame >= frames.length) stopSlide();
      }, JUMP_FRAME_MS);
    } else {
      current.setBounds(target);
    }
    if (fullBounds !== null) {
      // Collapsed or the icon: going back to full opens at the new position too.
      fullBounds = {
        ...fullBounds,
        ...positionPlace(preset, area, fullBounds.width, fullBounds.height),
      };
    }
    rememberPosition(preset, bounds);
    // An exact place: saved as it is, not snapped to the edges.
    movedSinceSave = false;
    if (saveTimer) clearTimeout(saveTimer);
    save();
    announce();
  };

  return {
    open(sessionId) {
      const url = compactUrl(deps.kiteUrl, sessionId);
      if (!url) return false;
      if (current && !current.isDestroyed()) {
        if (url !== loadedUrl) {
          loadedUrl = url;
          void current.loadURL(url);
        }
        current.showInactive();
        return true;
      }
      const displays = deps.screen.getAllDisplays();
      const settings = deps.store.read();
      const bounds = restoreBounds(
        settings.compactBounds,
        displays.map((display) => display.workArea),
        deps.screen.getPrimaryDisplay().workArea,
        settings.overlayPreset,
      );
      // v1.1.0: the place last used on this display, if any (its height follows the panels).
      const place = settings.overlayPlaces?.[String(deps.screen.getDisplayMatching(bounds)?.id)];
      if (place) Object.assign(bounds, place);
      // 1.6.4 (ADR-0082): once, the overlay takes the new default size on the display it opens on: a third
      // of the width, about its centre, and the panels' heights and the both-panels width chosen before are
      // forgotten (panels now default to half the display's height). (v1.2.0 to 1.6.3 widened a saved place
      // once per bar 1 change instead, up to 980.) A size chosen after this stays.
      if ((settings.overlayDefaultSized ?? 0) < OVERLAY_DEFAULT_SIZE_VERSION) {
        const area =
          deps.screen.getDisplayMatching(bounds)?.workArea ??
          deps.screen.getPrimaryDisplay().workArea;
        const size = overlayDefaultSize(area);
        Object.assign(bounds, widthAboutCentre(bounds, size.width, area), { height: size.height });
        // Taller than before: kept inside the display (a place low on the screen moves up).
        bounds.y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height));
        const display = deps.screen.getDisplayMatching(bounds);
        deps.store.write({
          overlayDefaultSized: OVERLAY_DEFAULT_SIZE_VERSION,
          overlayBarsWidened: true,
          overlayBarsWidth: size.width,
          overlayHeights: {},
          overlayBothWidth: undefined,
          compactBounds: { ...bounds },
          // Places on other displays kept their old widths: they are dropped, and the positions still say
          // where the overlay goes there.
          overlayPlaces: display
            ? { [String(display.id)]: { x: bounds.x, y: bounds.y, width: bounds.width } }
            : {},
        });
      }
      // v1.3.0 (ADR-0056): the position last used on this display puts the window exactly there;
      // otherwise the nearest one only says which way it grows (the window stays where it was).
      const openArea =
        deps.screen.getDisplayMatching(bounds)?.workArea ??
        deps.screen.getPrimaryDisplay().workArea;
      const rememberedPosition =
        settings.overlayPositions?.[String(deps.screen.getDisplayMatching(bounds)?.id)];
      if (rememberedPosition) {
        Object.assign(
          bounds,
          positionPlace(rememberedPosition, openArea, bounds.width, bounds.height),
        );
      }
      position = rememberedPosition ?? nearestPosition(bounds, openArea);
      mode = 'full';
      fullBounds = null;
      resizeStart = null;
      layout = null;
      narrow = null;
      const window = deps.createWindow(
        compactWindowOptions(bounds, deps.preloadPath, deps.appVersion),
      );
      current = window;
      loadedUrl = url;
      // Above normal windows, including a maximised meeting window.
      window.setAlwaysOnTop(true, 'floating');
      deps.protection.attach(window);
      // Shown without focus: the meeting keeps the keyboard.
      window.once('ready-to-show', () => window.showInactive());
      // v1.3.0: each load of the page learns the overlay's position (which way its panels open).
      window.webContents?.on?.('did-finish-load', announce);
      const later = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(save, SAVE_DELAY_MS);
      };
      // Snapping waits for the same quiet moment as saving: on macOS 'moved' fires all through a
      // drag, and moving the window under the user's pointer mid-drag would fight them.
      window.on('moved', () => {
        // A jump's slide moves the window itself (macOS reports each step as 'moved'): not a drag.
        if (sliding) return;
        movedSinceSave = true;
        later();
        deps.snap?.moved();
      });
      // Only a manual move fires this (Electron docs), so shortcuts and presets show no zones.
      window.on('will-move', () => deps.snap?.moving(window));
      window.on('resized', later);
      window.on('close', () => {
        // Closing ends any move: remember the place without snapping it now.
        movedSinceSave = false;
        save();
      });
      window.on('closed', () => {
        if (saveTimer) clearTimeout(saveTimer);
        if (current === window) current = null;
        mode = 'full';
        fullBounds = null;
        resizeStart = null;
        layout = null;
        narrow = null;
        position = null;
        deps.onClosed?.();
      });
      void window.loadURL(url);
      return true;
    },
    close() {
      if (current && !current.isDestroyed()) current.close();
    },
    window: () => (current && !current.isDestroyed() ? current : null),
    setClickThrough(through) {
      if (!current || current.isDestroyed()) return;
      // The icon is all button: it always takes its clicks.
      const pass = through && mode !== 'icon';
      if (pass) current.setIgnoreMouseEvents(true, { forward: true });
      else current.setIgnoreMouseEvents(false);
    },
    releaseFocus() {
      if (!current || current.isDestroyed() || !current.isFocused()) return;
      current.blur();
    },
    toggle() {
      if (!current || current.isDestroyed()) return;
      if (current.isVisible()) current.hide();
      else current.showInactive();
    },
    move(dx, dy) {
      if (!current || current.isDestroyed()) return;
      finishSlide();
      const [x = 0, y = 0] = current.getPosition();
      if (mode === 'icon') {
        // With its size stated: at some display scales a plain move lets a small window creep.
        current.setBounds({
          x: x + dx,
          y: y + dy,
          width: OVERLAY_ICON_SIZE,
          height: OVERLAY_ICON_SIZE,
        });
        return;
      }
      current.setPosition(x + dx, y + dy);
    },
    setOpacity(value) {
      if (!current || current.isDestroyed() || typeof value !== 'number' || Number.isNaN(value)) {
        return;
      }
      const { min, max } = OVERLAY_OPACITY_RANGE;
      current.setOpacity(Math.min(max, Math.max(min, value)));
    },
    setCollapsed(collapsed) {
      // The pre-1.0.2 call: opening again only leaves the controls bar, never the script bar.
      if (collapsed) setMode('collapsed');
      else if (mode === 'collapsed') setMode('full');
    },
    setMode,
    mode: () => (current && !current.isDestroyed() ? mode : 'full'),
    place(preset) {
      deps.store.write({ overlayPreset: preset });
      if (!current || current.isDestroyed()) return;
      finishSlide();
      const target = presetBounds(preset, areaFor(fullBounds ?? current.getBounds()));
      position = preset;
      rememberPosition(preset, target);
      announce();
      // The default width is the narrow one again; both panels widen it from there.
      narrow = null;
      if (mode === 'full') {
        current.setBounds(target);
        // Stacked: the default width at the place; the height follows the panels.
        applyLayout();
      } else {
        // The page stays in its mode; the overlay opens there when it goes back to full.
        fullBounds = target;
        if (mode === 'collapsed') {
          current.setBounds({ ...target, height: COMPACT_COLLAPSED_HEIGHT });
        }
      }
      // A preset is an exact place: saved as it is, not snapped.
      movedSinceSave = false;
      if (saveTimer) clearTimeout(saveTimer);
      save();
    },
    preset: () => deps.store.read().overlayPreset ?? 'top-center',
    goTo,
    jump(which) {
      if (!current || current.isDestroyed()) return;
      const from = position ?? nearestPosition(current.getBounds(), areaFor(current.getBounds()));
      goTo(jumpPosition(from, which));
    },
    position: () => (current && !current.isDestroyed() ? position : null),
    setLayout(next) {
      layout = next;
      applyLayout();
    },
    snapTo(preset) {
      // v1.3.0 (ADR-0056): a drop goes to the nearest of the six positions, like the ⋮ grid.
      goTo(preset);
    },
    resize(step) {
      if (!current || current.isDestroyed()) return;
      finishSlide();
      if (step.phase === 'start') {
        resizeStart = current.getBounds();
        return;
      }
      const start = resizeStart;
      if (!start) return;
      // The slim modes have a fixed height: only their left or right edge resizes them. So does the
      // stacked overlay with no panel open: the bars are as tall as they are.
      const slim = mode !== 'full' || (layout !== null && layoutKey(layout) === 'bars');
      const edge = (slim ? step.edge.replace(/[ns]/g, '') : step.edge) as OverlayEdge | '';
      if (edge !== '') {
        const target = resizeBounds(
          start,
          edge,
          step.dx,
          slim ? 0 : step.dy,
          minFor(mode),
          areaFor(start),
        );
        current.setBounds(slim ? { ...target, height: start.height } : target);
      }
      if (step.phase === 'end') {
        resizeStart = null;
        if (saveTimer) clearTimeout(saveTimer);
        // v1.1.0: this set of panels keeps the height the user gave it (not while a menu is open).
        if (layout && mode === 'full' && layout.popupHeight === 0) {
          deps.store.write({
            overlayHeights: {
              ...deps.store.read().overlayHeights,
              [layoutKey(layout)]: current.getBounds().height,
            },
            // With both panels open, the width the user gave them too.
            ...(layoutKey(layout) === 'both'
              ? { overlayBothWidth: current.getBounds().width }
              : {}),
          });
        }
        save();
      }
    },
  };
}

/**
 * Answers the Kite page's compact-window requests (Kite origin main frames only).
 *
 * @param ipcMain       Electron's ipcMain.
 * @param compact       The controller.
 * @param allowedOrigin The Kite origin.
 * @param minimizeMain  Minimises the main window (a call starting in the overlay).
 * @param showCall      Brings the full call window forward and hides the overlay (v1.0.4).
 * Called from: start() in main.ts; tests
 */
export function installCompactWindows(
  ipcMain: Pick<IpcMain, 'handle'>,
  compact: CompactWindows,
  allowedOrigin: string,
  minimizeMain: () => void = () => undefined,
  showCall: () => void = () => undefined,
): void {
  ipcMain.handle(OPEN_COMPACT_CHANNEL, (event, sessionId: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can open it');
    if (!compact.open(sessionId)) throw new Error('Not a session id');
  });
  ipcMain.handle(CLOSE_COMPACT_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can close it');
    compact.close();
  });
  ipcMain.handle(OVERLAY_OPACITY_CHANNEL, (event, opacity: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    compact.setOpacity(opacity);
  });
  ipcMain.handle(OVERLAY_COLLAPSE_CHANNEL, (event, collapsed: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    compact.setCollapsed(collapsed === true);
  });
  // v1.0.2 (ADR-0035): presets, page-driven resizing and modes. Each value is checked: only a
  // known preset, mode or a well-formed resize step reaches the window.
  ipcMain.handle(OVERLAY_PLACE_CHANNEL, (event, preset: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    if (!isOverlayPreset(preset)) throw new Error('Not an overlay preset');
    compact.place(preset);
  });
  ipcMain.handle(OVERLAY_PRESET_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can read it');
    return compact.preset();
  });
  // v1.3.0 (ADR-0056): the open overlay's position, for the ⋮ grid and which way its panels open.
  ipcMain.handle(OVERLAY_POSITION_CHANNEL, (event, preset: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can read it');
    if (preset === undefined) return compact.position();
    if (!isOverlayPreset(preset)) throw new Error('Not an overlay position');
    compact.goTo(preset);
    return compact.position();
  });
  ipcMain.handle(OVERLAY_RESIZE_CHANNEL, (event, step: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    if (!isResizeStep(step)) throw new Error('Not a resize step');
    compact.resize(step);
  });
  // v1.2.0 (spec S13): dragging the icon. The distances are checked, like a resize step's.
  ipcMain.handle(OVERLAY_MOVE_CHANNEL, (event, move: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    if (!isOverlayMove(move)) throw new Error('Not a move');
    compact.move(move.dx, move.dy);
  });
  ipcMain.handle(OVERLAY_MODE_CHANNEL, (event, mode: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    if (!isOverlayMode(mode)) throw new Error('Not an overlay mode');
    compact.setMode(mode);
  });
  // v1.1.0 (ADR-0041): which panels are open; the shell checks every value.
  ipcMain.handle(OVERLAY_LAYOUT_CHANNEL, (event, layout: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    if (!isOverlayLayout(layout)) throw new Error('Not an overlay layout');
    compact.setLayout(layout);
  });
  // v1.3.0 (ADR-0055): click-through over the gaps, from the overlay's own page only.
  ipcMain.handle(OVERLAY_CLICK_THROUGH_CHANNEL, (event, through: unknown) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    const window = compact.window();
    if (!window || event.sender !== window.webContents) return;
    compact.setClickThrough(through === true);
  });
  // v1.3.2: the keyboard back to the app behind, from the overlay's own page only.
  ipcMain.handle(OVERLAY_RELEASE_FOCUS_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can change it');
    const window = compact.window();
    if (!window || event.sender !== window.webContents) return;
    compact.releaseFocus();
  });
  ipcMain.handle(MINIMIZE_MAIN_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can do this');
    // Only with the overlay open: never leave the user with no Kite window in view.
    if (compact.window()) minimizeMain();
  });
  ipcMain.handle(SHOW_CALL_WINDOW_CHANNEL, (event) => {
    if (!isKiteSender(event, allowedOrigin)) throw new Error('Only the Kite page can do this');
    showCall();
  });
}
