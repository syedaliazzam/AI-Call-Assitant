/**
 * File: packages/shared/src/hotkeys.ts
 * Purpose: The list of actions a hotkey can trigger. Defined once here so the desktop shell
 *          (global shortcuts) and the web app (in-page shortcuts) use the same names.
 * Used by: apps/web/src/platform/types.ts (Platform.onHotkey), apps/desktop/src/hotkeys.ts (Day 4)
 * Depends on: nothing (types only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3
 */

/**
 * An action triggered by a keyboard shortcut during a live session.
 * - `answer`: ask Kite to answer the latest question.
 * - `screenshot`: answer from a screenshot of the screen.
 * - `clear`: clear the current answer.
 * - `prev` / `next`: move through earlier answers.
 */
export type HotkeyAction = 'answer' | 'screenshot' | 'clear' | 'prev' | 'next';
