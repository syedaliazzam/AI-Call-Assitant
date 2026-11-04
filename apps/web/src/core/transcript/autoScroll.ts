/**
 * File: apps/web/src/core/transcript/autoScroll.ts
 * Purpose: When a transcript follows its newest line (v1.1.0, ADR-0041): oldest at the top, newest at
 *          the bottom, and it scrolls itself only while the reader is at the bottom. Reading further up
 *          pauses it; "Jump to latest" or scrolling back down starts it again.
 * Used by: src/features/live/useStickToBottom.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041 (reverses ADR-0030's order)
 */

/** How close to the bottom still counts as at the bottom, in px: a wheel notch is about 100. */
export const BOTTOM_SLACK_PX = 32;

/**
 * Whether a scroll area is at its bottom.
 *
 * @param scrollTop    Its scroll position.
 * @param clientHeight Its visible height.
 * @param scrollHeight Its content's height.
 * @param slack        How close counts (default BOTTOM_SLACK_PX).
 * @returns True at the bottom, or when everything fits.
 * Called from: useStickToBottom.ts; tests
 */
export function atBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  slack = BOTTOM_SLACK_PX,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= slack;
}
