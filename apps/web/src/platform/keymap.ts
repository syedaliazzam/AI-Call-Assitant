/**
 * File: apps/web/src/platform/keymap.ts
 * Purpose: The hotkeys (packages/shared/src/hotkeys.ts) as a key-press → action map, used for the
 *          in-page shortcuts (while a Kite window has focus) in the browser and the desktop app.
 * Used by: src/platform/browser.ts and src/platform/desktop.ts (onHotkey, listenForFocusedHotkeys)
 * Depends on: @kite/shared (HotkeyAction)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (default hotkeys);
 *               day-04-answers.md Stage 6
 *
 * The modifier is ⌘ on macOS and Ctrl elsewhere; ADR-0110: on a Mac, Clear, Clear transcript, previous /
 * next and zoom are ⌃⌥ keys (macHotkeyFor()), so ⌘⌫, ⌘←/→ and ⌘= / - / 0 keep their Mac meaning. While
 * the user types in a text box, no shortcut is taken: Ctrl+← / Ctrl+→ and Ctrl+Backspace already move
 * and delete by word there,
 * and Enter sends the chat question. Two exceptions (v1.2.0, spec S14), keys that edit nothing and are
 * meant for use from the chat box itself: Chat (pressed twice for the microphone) and Ctrl+Alt+Enter.
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
  /**
   * The key's place on the keyboard ('Equal', 'ArrowLeft', 'KeyK'), when known. ADR-0110: on a Mac,
   * Option changes the character (⌥= types "≠"), so the Mac keys are matched by place.
   */
  code?: string;
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
 * ADR-0110: the Mac's keys (packages/shared MAC_GLOBAL_HOTKEYS). ⌘ for Answer, Screenshot, the voice
 * question, Ask AI, the script bar and the screenshot and voice question, as before; ⌃⌥ (Control+Option)
 * for Clear answers, Clear transcript, previous / next and zoom, so ⌘⌫, ⌘← / ⌘→ and ⌘= / ⌘- / ⌘0 keep
 * their usual Mac meaning.
 *
 * @param press  The key press (not a repeat).
 * @param typing True when it happened in a text box.
 * @returns The action, or null.
 * Called from: hotkeyFor()
 */
function macHotkeyFor(press: KeyPress, typing: boolean): HotkeyAction | null {
  const place = press.code ?? '';
  // ⌃⌥ with no ⌘: never while typing (Option+arrows and Option+⌫ edit text).
  if (press.ctrlKey && press.altKey && !press.metaKey) {
    if (typing) return null;
    if (place === 'Backspace' || press.key === 'Backspace') {
      return press.shiftKey ? 'clear-transcript' : 'clear';
    }
    // "+" is Shift+= on most layouts, so both count for zoom in.
    if (place === 'Equal') return 'zoom-in';
    if (press.shiftKey) return null;
    if (place === 'ArrowLeft' || press.key === 'ArrowLeft') return 'prev';
    if (place === 'ArrowRight' || press.key === 'ArrowRight') return 'next';
    if (place === 'Minus') return 'zoom-out';
    if (place === 'Digit0') return 'zoom-reset';
    return null;
  }
  if (!press.metaKey || press.ctrlKey) return null;
  // ⌘⌥: the screenshot and voice question (also from a text box), Ask AI and the script bar.
  if (press.altKey) {
    if (press.shiftKey) return null;
    if (press.key === 'Enter') return 'screenshot-send';
    if (typing) return null;
    if (place === 'KeyK' || press.key.toLowerCase() === 'k') return 'ask-kite';
    if (place === 'KeyS' || press.key.toLowerCase() === 's') return 'script-bar';
    return null;
  }
  // ⌘ alone: Answer, Screenshot and the voice question (the voice question also from a text box).
  if (press.key === ' ' && press.shiftKey) return 'chat';
  if (typing) return null;
  if (press.key === 'Enter') return press.shiftKey ? 'screenshot' : 'answer';
  return null;
}

/**
 * The hotkey action for a key press, or null when it is not a Kite shortcut.
 *
 * @param press The key press.
 * @param mac   True on macOS (the Mac's keys, ADR-0110), false elsewhere (Ctrl).
 * @returns 'answer', 'screenshot', 'screenshot-send', 'chat', 'clear', 'clear-transcript', 'prev',
 *          'next', 'ask-kite', 'script-bar', or null.
 * Called from: listenForHotkeys(); tests
 */
export function hotkeyFor(press: KeyPress, mac: boolean): HotkeyAction | null {
  if (press.repeat) return null;
  const typing = isTyping(press.target);
  if (mac) return macHotkeyFor(press, typing);
  // The shortcuts with Alt: Ask Kite (ADR-0030) and the script bar (v1.0.2, ADR-0035). Every other
  // Alt combination stays the browser's.
  if (press.altKey) {
    const held = press.ctrlKey && !press.metaKey;
    if (!held || press.shiftKey) return null;
    // Where Ctrl+Alt is AltGr, e.key is the letter it types ("ś" on a Polish layout), so typing that
    // letter in the page is never taken as a shortcut.
    if (press.key === 'Enter') return 'screenshot-send';
    if (typing) return null;
    const key = press.key.toLowerCase();
    if (key === 'k') return 'ask-kite';
    return key === 's' ? 'script-bar' : null;
  }
  // Exactly Ctrl: Ctrl with the Windows key is not a shortcut.
  const modifier = press.ctrlKey && !press.metaKey;
  if (!modifier) return null;
  if (typing) return press.key === ' ' && press.shiftKey ? 'chat' : null;
  switch (press.key) {
    case 'Enter':
      return press.shiftKey ? 'screenshot' : 'answer';
    case 'Backspace':
      // v1.1.0: Ctrl+Shift+Backspace clears the transcript; Chat moved to Ctrl+Shift+Space.
      // ADR-0082: Ctrl+Backspace clears the answers.
      return press.shiftKey ? 'clear-transcript' : 'clear';
    case ' ':
      return press.shiftKey ? 'chat' : null;
    case 'ArrowLeft':
      return press.shiftKey ? null : 'prev';
    case 'ArrowRight':
      return press.shiftKey ? null : 'next';
    // ADR-0082: the overlay's zoom, as in browsers. "+" is Shift+= on most layouts, so both count.
    case '=':
    case '+':
      return 'zoom-in';
    case '-':
      return press.shiftKey ? null : 'zoom-out';
    case '0':
      return press.shiftKey ? null : 'zoom-reset';
    default:
      return null;
  }
}

/**
 * ADR-0082: whether a key press is Escape with no modifier, which cancels a voice question while it
 * listens (the page's own key handling while a Kite window has focus; desktop 1.6.4 also holds it from
 * other apps for those few seconds).
 *
 * @param press The key press.
 * @returns True for a plain Escape.
 * Called from: src/features/live/LiveAnswers.tsx, src/features/live/CompactLive.tsx; tests
 */
export function isVoiceCancelKey(press: KeyPress): boolean {
  return (
    press.key === 'Escape' && !press.ctrlKey && !press.metaKey && !press.altKey && !press.shiftKey
  );
}

/**
 * Whether a key press is the overlay's Transcript key (v1.3.0, ADR-0056: Ctrl+Alt+T, ⌘⌥T on macOS),
 * handled only by the overlay's own page while it has focus. Never while typing in a box, and never where
 * Ctrl+Alt is AltGr and types a letter (e.key is then that letter, not "t").
 *
 * @param press The key press.
 * @param mac   True on macOS.
 * @returns True for the Transcript key.
 * Called from: src/features/live/CompactView.tsx; tests
 */
export function isTranscriptKey(press: KeyPress, mac: boolean): boolean {
  if (press.repeat || !press.altKey || press.shiftKey) return false;
  const held = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!held || isTyping(press.target)) return false;
  // On macOS Option changes e.key ("†"), so the key's place (e.code) is checked there too.
  const code = (press as KeyPress & { code?: string }).code;
  return press.key.toLowerCase() === 't' || (mac && code === 'KeyT');
}

/**
 * Listens for the Ask Kite shortcut alone, on every signed-in page. Unlike listenForHotkeys(), it
 * leaves every other key to the page and the browser, because no call is going on there.
 *
 * @param target  The window to listen on.
 * @param mac     True on macOS.
 * @param handler Called each time it is pressed.
 * @returns A function that stops listening.
 * Called from: browserPlatform.onAskKiteHotkey(), desktop platform onAskKiteHotkey(); tests
 */
export function listenForAskKite(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  mac: boolean,
  handler: () => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (hotkeyFor(event, mac) !== 'ask-kite') return;
    event.preventDefault();
    handler();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
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
