/**
 * File: apps/desktop/src/positions.ts
 * Purpose: The overlay's six positions (v1.3.0, ADR-0056): a 2 × 3 grid on the work area of the display
 *          the overlay is on (the taskbar or Dock is already outside the work area, on whichever side
 *          it is), 16 DIPs from its edges. Where a window of a given size sits at each position, which
 *          position is nearest to where it is, and where a jump shortcut takes it. Pure maths in DIPs,
 *          so it works the same at any display scale and on any monitor.
 * Used by: src/windows.ts (jumps, the ⋮ grid, remembering a position per display),
 *          src/snapZones.ts (the six zones while dragging, the drop)
 * Depends on: electron (Rectangle type), @kite/shared (OVERLAY_GRID, overlayRow, OverlayJump)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.3; ADR-0056
 */
import {
  OVERLAY_GRID,
  overlayRow,
  type OverlayJump,
  type OverlayPreset,
  type OverlayRow,
} from '@kite/shared';
import type { Rectangle } from 'electron';

/** The space between the overlay and the work area's edges at every position, in DIPs. */
export const POSITION_MARGIN = 16;

/**
 * One coordinate of a position along one axis: start (left or top), middle or end (right or bottom),
 * kept inside the work area. A window larger than the area minus its margins moves towards the edge
 * first; one larger than the area itself starts at its edge.
 *
 * @param start  The area's start (x or y).
 * @param length The area's length (width or height).
 * @param size   The window's size along the axis.
 * @param where  Start, middle or end.
 * @param margin The space from the edges.
 * @returns The coordinate, in whole DIPs.
 * Called from: positionPlace()
 */
function along(
  start: number,
  length: number,
  size: number,
  where: 'start' | 'middle' | 'end',
  margin: number,
): number {
  const room = Math.max(0, length - size);
  const offset =
    where === 'start'
      ? Math.min(margin, room)
      : where === 'end'
        ? Math.max(0, room - margin)
        : room / 2;
  return Math.round(start + offset);
}

/**
 * The column of a position: 'start' (left), 'middle' (centre) or 'end' (right).
 *
 * @param preset The position.
 * @returns Its column.
 * Called from: positionPlace(), jumpPosition(); src/windows.ts (zoomedWidth, ADR-0085); tests
 */
export function columnOf(preset: OverlayPreset): 'start' | 'middle' | 'end' {
  if (preset.endsWith('left')) return 'start';
  if (preset.endsWith('right')) return 'end';
  return 'middle';
}

/**
 * Where a window of a given size sits at a position on a work area.
 *
 * @param preset The position.
 * @param area   The display's work area (DIPs; may start anywhere, for a taskbar on the left or top or
 *               a second monitor).
 * @param width  The window's width.
 * @param height The window's height.
 * @param margin The space from the area's edges (default POSITION_MARGIN).
 * @returns The window's top-left corner, in whole DIPs.
 * Called from: src/windows.ts (presetPosition), src/snapZones.ts; tests
 */
export function positionPlace(
  preset: OverlayPreset,
  area: Rectangle,
  width: number,
  height: number,
  margin = POSITION_MARGIN,
): { x: number; y: number } {
  return {
    x: along(area.x, area.width, width, columnOf(preset), margin),
    y: along(area.y, area.height, height, overlayRow(preset) === 'top' ? 'start' : 'end', margin),
  };
}

/**
 * The position nearest to where a window is: the one whose place (for the window's own size) has its
 * centre closest to the window's centre.
 *
 * @param bounds The window's bounds.
 * @param area   The work area of the display it is on.
 * @returns The nearest position.
 * Called from: src/windows.ts (a window with no remembered position), src/snapZones.ts (the drop); tests
 */
export function nearestPosition(
  bounds: { x: number; y: number; width: number; height: number },
  area: Rectangle,
): OverlayPreset {
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let best: OverlayPreset = 'top-center';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const preset of [...OVERLAY_GRID.top, ...OVERLAY_GRID.bottom]) {
    const place = positionPlace(preset, area, bounds.width, bounds.height);
    const distance = Math.hypot(
      place.x + bounds.width / 2 - centre.x,
      place.y + bounds.height / 2 - centre.y,
    );
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where a jump shortcut takes the overlay: one spot left or right within its row, stopping at the
 * edges (no wrap), or the same column on the top or bottom row.
 *
 * @param from The position now.
 * @param jump The shortcut.
 * @returns The new position (the same one at an edge).
 * Called from: src/windows.ts (jump); tests
 */
export function jumpPosition(from: OverlayPreset, jump: OverlayJump): OverlayPreset {
  const row: OverlayRow = overlayRow(from);
  const columns = OVERLAY_GRID[row];
  const index = columns.indexOf(from);
  if (jump === 'overlay-spot-left') return columns[Math.max(0, index - 1)]!;
  if (jump === 'overlay-spot-right') return columns[Math.min(columns.length - 1, index + 1)]!;
  return OVERLAY_GRID[jump === 'overlay-row-top' ? 'top' : 'bottom'][index]!;
}

/**
 * Whether a shortcut is a jump between positions.
 *
 * @param action A global shortcut.
 * @returns True for the four jumps.
 * Called from: src/windows.ts (overlayShortcut); tests
 */
export function isOverlayJump(action: string): action is OverlayJump {
  return (
    action === 'overlay-spot-left' ||
    action === 'overlay-spot-right' ||
    action === 'overlay-row-top' ||
    action === 'overlay-row-bottom'
  );
}
