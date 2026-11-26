/**
 * File: apps/web/src/features/live/overlay/panelWidth.ts
 * Purpose: ADR-0113: how the overlay's pieces line up across the window, and the panels' own width. The
 *          bars keep their natural width; the panels (the answer, or the transcript and the answer as one
 *          block) have their own width, a share of the bars' width that the answer panel's corner grip sets.
 *          Both line up by the position's column, as the rows mirror top and bottom (ADR-0056): left
 *          positions on their left edges, the centre ones centred, right positions on their right edges.
 *          ADR-0115: the default share when the user has not dragged (a reading column for the answer alone).
 *          ADR-0124 amended (27 Nov 2026): the answer, alone or beside the transcript, lines up by the position's
 *          column again (ADR-0124 had centred the answer alone on every position).
 *          ADR-0119 amended (27 Nov 2026, like ParakeetAI): the transcript and the answer side by side are one row
 *          about 1.4 × bar 1's width (at least 720 CSS px, never wider than the window), and the window grows
 *          for it through the shell's existing resize steps (pairWindowWidth(), widthSteps()).
 * Used by: src/features/live/CompactView.tsx, src/features/live/overlay/OverlayAnswer.tsx
 * Depends on: @kite/shared (OverlayPreset), src/core/storage/overlayPrefs.ts (clampPanelsWidth,
 *             OVERLAY_PANELS_WIDTH)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0113, ADR-0115, ADR-0119,
 *               ADR-0124
 *
 * Pure functions only, so the unit tests can check every case without a layout engine (jsdom has none).
 */
import type { OverlayPreset, OverlayResizeStep } from '@kite/shared';
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

/**
 * ADR-0119 amended (27 Nov 2026, like ParakeetAI): the transcript and the answer side by side are a row about this
 * many times bar 1's width (the reference's row measured about 1.4 × its first bar).
 */
export const PAIR_WIDTH_FACTOR = 1.4;

/**
 * ADR-0119 amended: the narrowest row that holds the pair side by side, CSS px: the transcript's 240 and the answer's
 * 340 (ADR-0085), the gap and the divider. The overlay stacks the pair only in a window narrower than this, which
 * the window's growth avoids unless the screen itself is too narrow (see pairWindowWidth()).
 */
export const PAIR_MIN_WIDTH = 600;

/**
 * ADR-0119 amended: the narrowest the pair's row is made where the window allows, CSS px: below about this the
 * answer's footer wraps (ADR-0119 chose 720 px for that reason; integration test S15). A narrow bar 1 still gets it.
 */
export const PAIR_ROW_MIN = 720;

/**
 * ADR-0119 amended: the space the shell keeps between the overlay and the screen's edges, DIPs (the desktop shell's
 * POSITION_MARGIN, apps/desktop/src/positions.ts). The grown window stays inside the work area less these.
 */
export const PAIR_SCREEN_MARGIN = 16;

/**
 * ADR-0119 amended: the CSS width of the row with the transcript and the answer both open. It sits inside the bars'
 * column (100 % is bar 1's width): 1.4 × bar 1, at least PAIR_ROW_MIN, never wider than the window (100cqw: the
 * overlay's root, the nearest named container). The user's dragged share (ADR-0113) applies to the answer alone.
 *
 * @returns A CSS width.
 * Called from: CompactView.tsx; tests
 */
export function pairWidthStyle(): string {
  return `min(100cqw, max(${PAIR_ROW_MIN}px, ${Math.round(PAIR_WIDTH_FACTOR * 100)}%))`;
}

/**
 * ADR-0119 amended: how wide the overlay window should be for the pair's row, in DIPs: wide enough for
 * max(PAIR_ROW_MIN, PAIR_WIDTH_FACTOR × bar 1) at the page's zoom, never narrower than it is now, and never wider
 * than the screen's work area less PAIR_SCREEN_MARGIN on each side. A window already wide enough keeps its width.
 *
 * @param input.bar1   Bar 1's width, CSS px of the page.
 * @param input.root   The overlay root's width, CSS px of the page (the window at the page's zoom).
 * @param input.window The window's width, DIPs (window.innerWidth).
 * @param input.screen The width of the screen's work area, DIPs (screen.availWidth).
 * @returns The window's width, whole DIPs.
 * Called from: usePairWindow.ts; tests
 */
export function pairWindowWidth(input: {
  /** Bar 1's width, CSS px of the page. */
  bar1: number;
  /** The overlay root's width, CSS px of the page. */
  root: number;
  /** The window's width, DIPs. */
  window: number;
  /** The screen's work area width, DIPs. */
  screen: number;
}): number {
  const { bar1, root, window, screen } = input;
  if (!(root > 0) || !(window > 0)) return Math.round(window);
  // DIPs per CSS px: the page's zoom (CSS zoom on the page; the window itself is in DIPs).
  const scale = window / root;
  const row = Math.max(PAIR_ROW_MIN, PAIR_WIDTH_FACTOR * bar1);
  const most = screen > 0 ? screen - 2 * PAIR_SCREEN_MARGIN : Infinity;
  return Math.round(Math.max(window, Math.min(most, Math.ceil(row * scale))));
}

/**
 * ADR-0119 amended: the shell's resize steps (OverlayResizeStep, the bridge every desktop app has had since 1.0.2)
 * that widen or narrow the window by a distance without moving the bars: on a left position its right edge moves,
 * on a right position its left edge, and centred both edges by half each. Only 'start' and 'move' are sent: the
 * shell's 'end' would store the window's height as the one the user chose for these panels, and save the grown
 * width as the overlay's own (the page undoes the growth itself, usePairWindow.ts).
 *
 * @param column The position's column (the edge or edges that move).
 * @param delta  How much wider, DIPs (negative: narrower).
 * @returns The steps, in order.
 * Called from: usePairWindow.ts; tests
 */
export function widthSteps(column: OverlayColumn, delta: number): OverlayResizeStep[] {
  const steps = (edge: 'e' | 'w', dx: number): OverlayResizeStep[] => [
    { phase: 'start', edge, dx: 0, dy: 0 },
    { phase: 'move', edge, dx, dy: 0 },
  ];
  if (column === 'start') return steps('e', delta);
  if (column === 'end') return steps('w', -delta);
  const left = Math.round(delta / 2);
  return [...steps('w', -left), ...steps('e', delta - left)];
}
