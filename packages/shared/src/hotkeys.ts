/**
 * File: packages/shared/src/hotkeys.ts
 * Purpose: The list of actions a hotkey can trigger, the desktop shell's default global
 *          shortcuts for them, and the registration status the shell reports. Defined once
 *          here so the desktop shell (global shortcuts) and the web app (in-page shortcuts and
 *          labels) use the same names.
 * Used by: apps/web/src/platform (types.ts, desktop.ts, keymap.ts), apps/desktop/src/hotkeys.ts,
 *          apps/desktop/src/preload.ts
 * Depends on: nothing (types and constants only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3, §7.3 (default hotkeys)
 */

/**
 * An action triggered by a keyboard shortcut during a live session.
 * - `answer`: ask Kite to answer the latest question.
 * - `screenshot`: answer from a screenshot of the screen.
 * - `clear`: clear the current answer.
 * - `prev` / `next`: move through earlier answers.
 */
export type HotkeyAction = 'answer' | 'screenshot' | 'clear' | 'prev' | 'next';

/** Every hotkey action, in the order the shell registers them. */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'answer',
  'screenshot',
  'clear',
  'prev',
  'next',
];

/**
 * The desktop shell's default global shortcuts (architecture §7.3), as Electron accelerators.
 * "CommandOrControl" is ⌘ on macOS and Ctrl on Windows and Linux.
 */
export const DEFAULT_GLOBAL_HOTKEYS: Readonly<Record<HotkeyAction, string>> = {
  answer: 'CommandOrControl+Enter',
  screenshot: 'CommandOrControl+Shift+Enter',
  clear: 'CommandOrControl+Backspace',
  prev: 'CommandOrControl+Left',
  next: 'CommandOrControl+Right',
};

/** Whether one global shortcut could be registered. */
export interface HotkeyStatus {
  /** The action. */
  action: HotkeyAction;
  /** Its shortcut, as an Electron accelerator (for example 'CommandOrControl+Enter'). */
  accelerator: string;
  /**
   * True when the shell registered it. False when another app already uses it: the shortcut
   * then works only while the Kite window has focus (the page's own key handling).
   */
  registered: boolean;
}
