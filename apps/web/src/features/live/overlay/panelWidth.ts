/**
 * File: apps/web/src/features/live/overlay/panelWidth.ts
 * Purpose: ADR-0113: how the overlay's pieces line up across the window, and the panels' own width. The
 *          bars keep their natural width; the panels (the answer, or the transcript and the answer as one
 *          block) have their own width, a share of the bars' width that the answer panel's corner grip sets.
 *          Both line up by the position's column, as the rows mirror top and bottom (ADR-0056): left
 *          positions on their left edges, the centre ones centred, right positions on their right edges.
 *          ADR-0115: the default share when the user has not dragged (a reading column for the answer alone).
 * Used by: src/features/live/CompactView.tsx, src/features/live/overlay/OverlayAnswer.tsx
 * Depends on: @kite/shared (OverlayPreset), src/core/storage/overlayPrefs.ts (clampPanelsWidth,
 *             OVERLAY_PANELS_WIDTH)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0113, ADR-0115
 *
 * Pure functions only, so the unit tests can check every case without a layout engine (jsdom has none).
 */
import type { OverlayPreset } from '@kite/shared';
import { clampPanelsWidth, OVERLAY_PANELS_WIDTH } from '@/core/storage/overlayPrefs';

/** A column of the overlay's positions: which edge the pieces line up on. */
export type OverlayColumn = 'start' | 'center' | 'end';

/**
 * The column of a position: left positions line up on the left, right ones on the right, the centre ones
 * in the middle. With no position (a browser's picture-in-picture window, or before the shell says) the
 * pieces are centred, as they always were.
 *
 * @param position The overlay's position, or null/undefined when there is none.
 * @returns The column.
 * Called from: CompactView.tsx; tests
 */
export function overlayColumn(position: OverlayPreset | null | undefined): OverlayColumn {
  if (!position) return 'center';
  if (position.endsWith('-left')) return 'start';
  if (position.endsWith('-right')) return 'end';
  return 'center';
}

/**
 * The flex alignment that lines pieces up on a column's edge (for a column-direction flex box).
 *
 * @param column The column.
 * @returns A Tailwind items-* class.
 * Called from: CompactView.tsx; tests
 */
export function columnAlignClass(column: OverlayColumn): string {
  if (column === 'start') return 'items-start';
  if (column === 'end') return 'items-end';
  return 'items-center';
}

/**
 * ADR-0124 (like ParakeetAI): the column the panels' block lines up by. The answer open alone sits centred under
 * the bars on every position; with the transcript open too, the pair lines up by the position's column, as
 * ADR-0113 and ADR-0119 decided (on a left position it extends from bar 1's left edge, on a right one from its
 * right edge, centred evenly).
 *
 * @param column The position's column (overlayColumn()).
 * @param both   True when the transcript and the answer are both open.
 * @returns The column for the panels' block (and for the answer's corner grip).
 * Called from: CompactView.tsx; tests
 */
export function panelsColumn(column: OverlayColumn, both: boolean): OverlayColumn {
  return both ? column : 'center';
}

/**
 * Which side of the answer panel its corner grip sits on: the side that moves when the panel grows. On a
 * right position the panel's right edge stays on the bar's right edge, so the grip is on the left.
 *
 * @param column The column.
 * @returns 'left' on a right position; otherwise 'right'.
 * Called from: CompactView.tsx; tests
 */
export function gripSide(column: OverlayColumn): 'left' | 'right' {
  return column === 'end' ? 'left' : 'right';
}

/**
 * The panels' width after the corner grip has moved sideways. The grip's edge follows the pointer: on a
 * left position the right edge moves by the distance; on a right position the left edge does (so moving
 * left widens); centred, both edges move, so the width changes by twice the distance.
 *
 * @param input.startWidth The panels' width when the drag started.
 * @param input.dx         How far the pointer has moved sideways since then (same units).
 * @param input.column     The position's column.
 * @param input.min        The smallest width (the answer panel's button strip, whole).
 * @param input.max        The largest width (the bars' width: the answer is never wider than the bar).
 * @returns The width, between min and max (max wins if min is larger: a window narrower than the strip).
 * Called from: widthShareAfterDrag(); tests
 */
export function widthAfterDrag(input: {
  /** The panels' width when the drag started. */
  startWidth: number;
  /** How far the pointer has moved sideways since then. */
  dx: number;
  /** The position's column. */
  column: OverlayColumn;
  /** The smallest width. */
  min: number;
  /** The largest width. */
  max: number;
}): number {
  const { startWidth, dx, column, min, max } = input;
  const change = column === 'end' ? -dx : column === 'center' ? 2 * dx : dx;
  return Math.min(max, Math.max(min, startWidth + change));
}

/**
 * The share of the bars' width to store after a sideways drag of the corner grip (widthAfterDrag(), then
 * as a share, kept inside OVERLAY_PANELS_WIDTH). The widths are measured in the page's client coordinates,
 * so the share needs no correction for the UI zoom.
 *
 * @param input See widthAfterDrag(); `max` is the bars' width.
 * @returns The share, or null when the bars have no width (nothing laid out yet).
 * Called from: CompactView.tsx; tests
 */
export function widthShareAfterDrag(input: Parameters<typeof widthAfterDrag>[0]): number | null {
  if (!(input.max > 0)) return null;
  return clampPanelsWidth(widthAfterDrag(input) / input.max);
}

/**
 * ADR-0115: the panels' share of the bars' width with the answer open. The user's own width (a drag of the
 * corner grip, remembered per device) always wins. Until there is one, the answer open alone is a reading
 * column (OVERLAY_PANELS_WIDTH.default, 62 %), and the transcript and the answer side by side keep the bars'
 * whole width: the transcript's split already narrows the answer there, and a narrower block would stack
 * the two panels (they sit side by side only from 600 CSS px).
 *
 * @param stored           The remembered share (getOverlayPanelsWidth()), or null when there is none.
 * @param besideTranscript True when the transcript panel is open beside the answer.
 * @returns The share, inside OVERLAY_PANELS_WIDTH (CompactView still raises it to the button strip's share).
 * Called from: CompactView.tsx; tests
 */
export function panelsShare(stored: number | null, besideTranscript: boolean): number {
  if (stored !== null) return clampPanelsWidth(stored);
  return besideTranscript ? OVERLAY_PANELS_WIDTH.max : OVERLAY_PANELS_WIDTH.default;
}

/**
 * The CSS width of the panels' block: its share of the bars' width.
 *
 * @param share The share (OVERLAY_PANELS_WIDTH).
 * @returns A percentage, with one decimal.
 * Called from: CompactView.tsx; tests
 */
export function panelsWidthStyle(share: number): string {
  return `${Math.round(clampPanelsWidth(share) * 1000) / 10}%`;
}
