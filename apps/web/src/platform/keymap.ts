/**
 * File: apps/web/src/platform/keymap.ts
 * Purpose: The default hotkeys of architecture §7.3 as a key-press → action map, used for the
 *          in-page shortcuts (while the Kite page has focus) in the browser and the desktop app.
 * Used by: src/platform/browser.ts and src/platform/desktop.ts (onHotkey)
 * Depends on: @kite/shared (HotkeyAction)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (default hotkeys);
 *               day-04-answers.md Stage 6
 *
 * The modifier is ⌘ on macOS and Ctrl elsewhere. While the user types in a text box, no
 * shortcut is taken: Ctrl+← / Ctrl+→ and Ctrl+Backspace already move and delete by word there,
 * and Enter sends the chat question.
 */
import type { HotkeyAction } from '@kite/shared';

/** The parts of a keyboard event the keymap reads (a KeyboardEvent has them all). */
export interface KeyPress {
  /** The key's value, for example 'Enter', 'Backspace', 'ArrowLeft'. */
  key: string;
  /** Ctrl held. */
  ctrlKey: boolean;
  /** ⌘ (macOS) or the Windows key held. */
  metaKey: boolean;
  /** Shift held. */
  shiftKey: boolean;
  /** Alt / Option held. */
  altKey: boolean;
  /** True while the key is held down and repeating. */
  repeat: boolean;
  /** Where the key was pressed (checked for text boxes). */
  target: EventTarget | null;
}

/**
 * Whether a key press happened in a place where the user types text.
 *
 * @param target The event target.
 * @returns True for inputs, text areas, selects and editable content.
 * Called from: hotkeyFor()
 */
function isTyping(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  if (!element || typeof element.tagName !== 'string') return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable === true
  );
}

/**
 * The hotkey action for a key press, or null when it is not a Kite shortcut.
 *
 * @param press The key press.
 * @param mac   True on macOS (⌘ is the modifier), false elsewhere (Ctrl).
 * @returns 'answer', 'screenshot', 'clear', 'prev', 'next', or null.
 * Called from: listenForHotkeys(); tests
 */
export function hotkeyFor(press: KeyPress, mac: boolean): HotkeyAction | null {
  if (press.repeat || press.altKey || isTyping(press.target)) return null;
  // Exactly the platform's modifier: Ctrl+⌘ together is not a shortcut.
  const modifier = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!modifier) return null;
  switch (press.key) {
    case 'Enter':
      return press.shiftKey ? 'screenshot' : 'answer';
    case 'Backspace':
      return press.shiftKey ? null : 'clear';
    case 'ArrowLeft':
      return press.shiftKey ? null : 'prev';
    case 'ArrowRight':
      return press.shiftKey ? null : 'next';
    default:
      return null;
  }
}

/**
 * Listens for the in-page shortcuts on a window.
 *
 * @param target  The window (or any event target) to listen on.
 * @param mac     True on macOS.
 * @param handler Called with each action.
 * @returns A function that stops listening.
 * Called from: browserPlatform.onHotkey(), desktop platform onHotkey(); tests
 */
export function listenForHotkeys(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  mac: boolean,
  handler: (action: HotkeyAction) => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const action = hotkeyFor(event, mac);
    if (!action) return;
    // The browser's own meaning of these keys (for example Ctrl+← = back in some browsers).
    event.preventDefault();
    handler(action);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
