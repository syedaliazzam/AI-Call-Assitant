/**
 * Tests for apps/web/src/platform/keymap.ts: the §7.3 default hotkeys map to their actions with
 * ⌘ on macOS and Ctrl elsewhere (Answer, Screenshot, Clear, Previous, Next); the other
 * platform's modifier, Alt, held-down repeats and keys typed in a text box are not shortcuts;
 * listenForHotkeys() calls the handler, prevents the browser's default and stops listening.
 * The two Alt shortcuts: Ask Kite (ADR-0030) and the script bar (v1.0.2, ADR-0035).
 */
import { describe, expect, it, vi } from 'vitest';
import { hotkeyFor, listenForHotkeys, type KeyPress } from '@/platform/keymap';

/**
 * A key press with nothing held.
 *
 * @param key    The key.
 * @param fields Modifiers or target to set.
 * @returns The key press.
 */
function press(key: string, fields: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: null,
    ...fields,
  };
}

describe('hotkeyFor', () => {
  it('maps the Windows defaults (Ctrl)', () => {
    const ctrl = { ctrlKey: true };
    expect(hotkeyFor(press('Enter', ctrl), false)).toBe('answer');
    expect(hotkeyFor(press('Enter', { ...ctrl, shiftKey: true }), false)).toBe('screenshot');
    expect(hotkeyFor(press('Backspace', ctrl), false)).toBe('clear');
    expect(hotkeyFor(press('ArrowLeft', ctrl), false)).toBe('prev');
    expect(hotkeyFor(press('ArrowRight', ctrl), false)).toBe('next');
  });

  it('maps the macOS defaults (⌘) and ignores Ctrl there', () => {
    expect(hotkeyFor(press('Enter', { metaKey: true }), true)).toBe('answer');
    expect(hotkeyFor(press('ArrowRight', { metaKey: true }), true)).toBe('next');
    expect(hotkeyFor(press('Enter', { ctrlKey: true }), true)).toBeNull();
    expect(hotkeyFor(press('Enter', { metaKey: true }), false)).toBeNull();
  });

  it('maps Ask Kite, the one shortcut with Alt, but never while typing (ADR-0030)', () => {
    expect(hotkeyFor(press('k', { ctrlKey: true, altKey: true }), false)).toBe('ask-kite');
    expect(hotkeyFor(press('K', { ctrlKey: true, altKey: true }), false)).toBe('ask-kite');
    expect(hotkeyFor(press('k', { metaKey: true, altKey: true }), true)).toBe('ask-kite');
    expect(hotkeyFor(press('k', { altKey: true }), false)).toBeNull();
    expect(hotkeyFor(press('j', { ctrlKey: true, altKey: true }), false)).toBeNull();
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(hotkeyFor(press('k', { ctrlKey: true, altKey: true, target: input }), false)).toBeNull();
  });

  it('maps the script bar (Ctrl+Alt+S, ⌘⌥S), not with Shift, not the AltGr letter (ADR-0035)', () => {
    expect(hotkeyFor(press('s', { ctrlKey: true, altKey: true }), false)).toBe('script-bar');
    expect(hotkeyFor(press('S', { ctrlKey: true, altKey: true }), false)).toBe('script-bar');
    expect(hotkeyFor(press('s', { metaKey: true, altKey: true }), true)).toBe('script-bar');
    expect(hotkeyFor(press('s', { ctrlKey: true, altKey: true }), true)).toBeNull();
    expect(
      hotkeyFor(press('s', { ctrlKey: true, altKey: true, shiftKey: true }), false),
    ).toBeNull();
    // A Polish layout: Ctrl+Alt is AltGr and types "ś"; that is typing, not the shortcut.
    expect(hotkeyFor(press('ś', { ctrlKey: true, altKey: true }), false)).toBeNull();
  });

  it('ignores other keys, Alt, repeats, both modifiers and typing in a text box', () => {
    expect(hotkeyFor(press('a', { ctrlKey: true }), false)).toBeNull();
    expect(hotkeyFor(press('Enter'), false)).toBeNull();
    expect(hotkeyFor(press('a', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(hotkeyFor(press('Enter', { ctrlKey: true, repeat: true }), false)).toBeNull();
    expect(hotkeyFor(press('Enter', { ctrlKey: true, metaKey: true }), false)).toBeNull();
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(hotkeyFor(press('Backspace', { ctrlKey: true, target: input }), false)).toBeNull();
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(hotkeyFor(press('Enter', { ctrlKey: true, target: editable }), false)).toBeNull();
    const button = { tagName: 'BUTTON' } as unknown as EventTarget;
    expect(hotkeyFor(press('Enter', { ctrlKey: true, target: button }), false)).toBe('answer');
  });
});

describe('hotkeyFor in the chat bar (spec S14)', () => {
  /** A press in a text box. */
  const input = { tagName: 'INPUT' } as unknown as EventTarget;

  it('Ctrl+Alt+Enter sends with a screenshot, in the box or anywhere else', () => {
    const keys = { ctrlKey: true, altKey: true };
    expect(hotkeyFor(press('Enter', keys), false)).toBe('screenshot-send');
    expect(hotkeyFor(press('Enter', { ...keys, target: input }), false)).toBe('screenshot-send');
    expect(hotkeyFor(press('Enter', { metaKey: true, altKey: true }), true)).toBe(
      'screenshot-send',
    );
    // Not with Shift, and not on the other platform's modifier.
    expect(hotkeyFor(press('Enter', { ...keys, shiftKey: true }), false)).toBeNull();
    expect(hotkeyFor(press('Enter', keys), true)).toBeNull();
  });

  it('Chat works from the box, so it can be pressed twice; no other key does', () => {
    const chat = { ctrlKey: true, shiftKey: true, target: input };
    expect(hotkeyFor(press(' ', chat), false)).toBe('chat');
    expect(hotkeyFor(press(' ', { ctrlKey: true, target: input }), false)).toBeNull();
    expect(hotkeyFor(press('k', { ctrlKey: true, altKey: true, target: input }), false)).toBeNull();
    expect(hotkeyFor(press('s', { ctrlKey: true, altKey: true, target: input }), false)).toBeNull();
    expect(hotkeyFor(press('ArrowLeft', { ctrlKey: true, target: input }), false)).toBeNull();
  });
});

describe('listenForHotkeys', () => {
  it('calls the handler, prevents the default, and stops when asked', () => {
    const target = new EventTarget();
    const handler = vi.fn();
    const stop = listenForHotkeys(target as unknown as Window, false, handler);
    /**
     * A keydown event (an Event's target is set by dispatchEvent, so it is not copied).
     *
     * @param key   The key.
     * @param ctrl  Ctrl held.
     * @returns The event.
     */
    const keydown = (key: string, ctrl: boolean) => {
      const { target: _target, ...fields } = press(key, { ctrlKey: ctrl });
      return Object.assign(new Event('keydown', { cancelable: true }), fields);
    };
    const event = keydown('Enter', true);
    target.dispatchEvent(event);
    expect(handler).toHaveBeenCalledWith('answer');
    expect(event.defaultPrevented).toBe(true);
    const other = keydown('x', true);
    target.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    stop();
    target.dispatchEvent(keydown('Enter', true));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
