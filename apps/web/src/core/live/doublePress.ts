/**
 * File: apps/web/src/core/live/doublePress.ts
 * Purpose: Tells a second press of a shortcut from a separate one (spec S14: Ctrl+Shift+Space twice opens
 *          the chat bar with the microphone on).
 * Used by: src/features/live/LiveAnswers.tsx, src/features/live/CompactLive.tsx
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S14)
 */

/** The longest gap between two presses of one double press, in ms. */
export const DOUBLE_PRESS_MS = 500;

/**
 * The shortest gap, in ms. A held key repeats far faster than a person presses twice, and a global
 * shortcut can repeat with it.
 */
export const KEY_REPEAT_MS = 60;

/**
 * Whether a press completes a double press.
 *
 * @param previous When the shortcut was last pressed (Unix ms), or null for never.
 * @param now      When it was pressed now (Unix ms).
 * @returns True for the second press of a pair.
 * Called from: LiveAnswers.tsx, CompactLive.tsx; tests
 */
export function isDoublePress(previous: number | null, now: number): boolean {
  if (previous === null) return false;
  const gap = now - previous;
  return gap >= KEY_REPEAT_MS && gap <= DOUBLE_PRESS_MS;
}
