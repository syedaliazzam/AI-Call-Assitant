/**
 * Tests for apps/web/src/platform/keymap.ts: the §7.3 default hotkeys map to their actions with
 * ⌘ on macOS and Ctrl elsewhere (Answer, Screenshot, Clear, Previous, Next); the other
 * platform's modifier, Alt, held-down repeats and keys typed in a text box are not shortcuts;
 * listenForHotkeys() calls the handler, prevents the browser's default and stops listening.
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

  it('ignores other keys, Alt, repeats, both modifiers and typing in a text box', () => {
    expect(hotkeyFor(press('a', { ctrlKey: true }), false)).toBeNull();
    expect(hotkeyFor(press('Enter'), false)).toBeNull();
    expect(hotkeyFor(press('Enter', { ctrlKey: true, altKey: true }), false)).toBeNull();
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
