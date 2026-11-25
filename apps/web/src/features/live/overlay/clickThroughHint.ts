/**
 * File: apps/web/src/features/live/overlay/clickThroughHint.ts
 * Purpose: The words that tell the user how to turn Click-through off (ADR-0055 amended 26 Nov 2026). While it
 *          is on, the whole overlay passes clicks to the app behind it, so bar 1 shows a hint that takes no
 *          clicks ("Click-through on — press Ctrl+Alt+X to turn off"; ⌘ ⌥ X on a Mac), and the call window
 *          shows the same shortcut beside its "Turn click-through off" button.
 * Used by: overlay/ControlBar.tsx (bar 1's hint), LiveAnswers.tsx (the call window's notice)
 * Depends on: @kite/shared (globalHotkeys, hotkeyLabel)
 * Architecture: docs/decisions/ADR-0055-desktop-flow-matches-the-reference.md (amendment, 26 Nov 2026)
 */
import { globalHotkeys, hotkeyLabel } from '@kite/shared';

/**
 * The Click-through shortcut for this computer, as the user reads it.
 *
 * @param mac True on macOS.
 * @returns "Ctrl+Alt+X", or "⌘ ⌥ X" on a Mac.
 * Called from: clickThroughHint(), LiveAnswers.tsx; tests
 */
export function clickThroughKeyLabel(mac: boolean): string {
  return hotkeyLabel(globalHotkeys(mac)['click-through'], mac);
}

/**
 * Bar 1's hint while Click-through is on.
 *
 * @param mac True on macOS.
 * @returns "Click-through on — press Ctrl+Alt+X to turn off" (⌘ ⌥ X on a Mac).
 * Called from: ControlBar (ClickThroughHint); tests
 */
export function clickThroughHint(mac: boolean): string {
  return `Click-through on — press ${clickThroughKeyLabel(mac)} to turn off`;
}
