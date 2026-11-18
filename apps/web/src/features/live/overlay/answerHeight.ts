/**
 * File: apps/web/src/features/live/overlay/answerHeight.ts
 * Purpose: How tall the overlay's answer panel is (ADR-0105, desktop 1.7.1): it opens tall enough for a
 *          typical answer (answer line, 3–5 bullets, Tip and Note) with no scrolling, grows with a longer
 *          answer while it streams but never shrinks during it, and fits the next answer again. The desktop
 *          shell caps the window (70 % of the work area, apps/desktop/src/windows.ts answerMaxHeight()).
 * Used by: src/features/live/CompactView.tsx
 * Depends on: nothing (pure functions, unit-tested)
 * Architecture: ADR-0105; ADR-0061 (the window is fitted to the page's content)
 */

/**
 * The answer panel's default height, in CSS px at 100 % text size: its header, padding and a typical
 * answer. Measured on 18 Nov 2026 with the real overlay (headless Chromium): a question, an answer line,
 * five bullets, a Tip and a Note need a 371 px panel from 768 px wide (the default overlay width on a 1920
 * wide screen); 380 leaves a little room. In a narrower window the same answer wraps more and the panel
 * grows past it (507 px at 640 wide), up to the shell's cap.
 */
export const ANSWER_PANEL_DEFAULT_HEIGHT = 380;

/**
 * The part of the default height that does not follow the answer text size: the panel's header row (44)
 * and the padding around the answer (26).
 */
export const ANSWER_PANEL_CHROME = 70;

/**
 * The answer panel's default (smallest) height for a text size: the header and padding stay, the text part
 * grows or shrinks with the size chosen in Display (0.8–1.5).
 *
 * @param fontScale The overlay's answer text size (1 = 100 %).
 * @returns The height, in whole CSS px.
 * Called from: CompactView (the answer panel's min-height and the window's content height); tests
 */
export function answerPanelMinHeight(fontScale = 1): number {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return Math.round(
    ANSWER_PANEL_CHROME + (ANSWER_PANEL_DEFAULT_HEIGHT - ANSWER_PANEL_CHROME) * scale,
  );
}

/**
 * How tall a panel needs to be to show everything: what it shows now plus what its scroll areas hide, and
 * never less than its default height (so a window that is still shorter learns the default too).
 *
 * @param shown     The panel's height now (offsetHeight).
 * @param hidden    What its scroll areas hide (scrollHeight − clientHeight, summed).
 * @param minHeight Its default height (0 for none).
 * @returns The height, in CSS px.
 * Called from: naturalExtentOf() in CompactView.tsx; tests
 */
export function neededPanelHeight(shown: number, hidden: number, minHeight: number): number {
  return Math.max(shown + Math.max(0, hidden), minHeight);
}

/** The content height held for one answer (see holdHeight()). */
export interface HeldHeight {
  /** What the height is held for: the answer, the open panels, the zoom, text size and width. */
  key: string;
  /** The tallest content height seen for it, in DIPs. */
  height: number;
}

/**
 * Keeps the window from jumping up and down while an answer streams (ADR-0105): for the same answer (and
 * the same panels, zoom, text size and width) the content height only grows. A new answer, or anything
 * else in the key changing (the person resized or zoomed), starts again from what it needs, so a shorter
 * answer shrinks the window back.
 *
 * @param previous What was held, or null.
 * @param key      The current answer's key, or null when no answer is shown (nothing is held then).
 * @param measured The content height measured now, in DIPs.
 * @returns What to hold now (null when nothing is), whose height is the one to report.
 * Called from: CompactView (the content-height layout effect); tests
 */
export function holdHeight(
  previous: HeldHeight | null,
  key: string | null,
  measured: number,
): HeldHeight | null {
  if (key === null) return null;
  if (previous?.key === key) return { key, height: Math.max(previous.height, measured) };
  return { key, height: measured };
}

/**
 * The key an answer's height is held for (holdHeight()).
 *
 * @param input.answerId   The answer shown, or null/undefined when none (or the answer panel is closed).
 * @param input.transcript Whether the transcript panel is open too.
 * @param input.up         True on the bottom row.
 * @param input.zoom       The UI zoom.
 * @param input.fontScale  The answer text size.
 * @param input.width      The page's width, in CSS px (a resize by the person starts again).
 * @returns The key, or null when no answer is shown.
 * Called from: CompactView; tests
 */
export function answerHoldKey(input: {
  /** The answer shown, or null/undefined when none (or the answer panel is closed). */
  answerId: string | null | undefined;
  /** Whether the transcript panel is open too. */
  transcript: boolean;
  /** True on the bottom row. */
  up: boolean;
  /** The UI zoom. */
  zoom: number;
  /** The answer text size. */
  fontScale: number;
  /** The page's width, in CSS px. */
  width: number;
}): string | null {
  if (!input.answerId) return null;
  return [
    input.answerId,
    input.transcript ? 't' : '-',
    input.up ? 'up' : 'down',
    input.zoom,
    input.fontScale,
    Math.round(input.width),
  ].join('|');
}
