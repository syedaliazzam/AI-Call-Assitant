/**
 * Tests for apps/web/src/features/live/overlay/usePopupDismiss.ts (ADR-0105, desktop 1.7.1): an open overlay
 * menu closes on a press outside it (the bars, the panels, the button that opened it), when the window loses
 * focus (a click in another app), and on Esc; a press inside it does not close it; the closing press and its
 * click reach nothing under the pointer, and no later click is swallowed. The unit tests run in Node: plain
 * EventTargets stand for the document and the window. Choosing an item (LiveMenu.tsx) and the drag areas
 * (theme.css k-popup-open) are part of the developer's check on the desktop app.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachPopupDismiss,
  isOutside,
  pressClosesPopup,
  swallowNextClick,
  type PopupElement,
} from '@/features/live/overlay/usePopupDismiss';

/**
 * Something pressed: a stand-in for an element.
 *
 * @param name What it stands for (only for reading the test).
 * @returns The stand-in.
 */
const target = (name: string) => ({ name }) as unknown as EventTarget;

/**
 * The menu's element: it contains only what is listed.
 *
 * @param inside What is inside the menu.
 * @returns The stand-in element.
 */
const popupOf = (...inside: EventTarget[]): PopupElement => ({
  contains: (node: Node | null) => inside.includes(node as unknown as EventTarget),
});

/**
 * A cancelable event of a type.
 *
 * @param type  The event's type.
 * @param extra Fields to add (a key's name).
 * @returns The event.
 */
const event = (type: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Event(type, { cancelable: true }), extra);

afterEach(() => {
  vi.useRealTimers();
});

describe('isOutside', () => {
  it('is false inside the menu, true anywhere else', () => {
    const row = target('menu row');
    const popup = popupOf(row);
    expect(isOutside(row, popup)).toBe(false);
    for (const elsewhere of ['bar 1', 'the ⋮ button', 'the answer panel', 'a gap']) {
      expect(isOutside(target(elsewhere), popup), elsewhere).toBe(true);
    }
    // Not drawn yet, or no target: outside.
    expect(isOutside(row, null)).toBe(true);
    expect(isOutside(null, popup)).toBe(true);
  });
});

describe('pressClosesPopup', () => {
  it('outside: closes, and the press reaches nothing under it', () => {
    const doc = new EventTarget();
    const press = {
      target: target('Transcript pill'),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    expect(pressClosesPopup(press, popupOf(target('menu row')), doc)).toBe(true);
    expect(press.preventDefault).toHaveBeenCalled();
    expect(press.stopPropagation).toHaveBeenCalled();
    // Its click is swallowed too: the pill is not toggled.
    const click = event('click');
    doc.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('inside: nothing happens here (the row handles its own click)', () => {
    const doc = new EventTarget();
    const row = target('Auto answer');
    const press = { target: row, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(pressClosesPopup(press, popupOf(row), doc)).toBe(false);
    expect(press.preventDefault).not.toHaveBeenCalled();
    const click = event('click');
    doc.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });
});

describe('swallowNextClick', () => {
  it('swallows only the next click', () => {
    const doc = new EventTarget();
    swallowNextClick(doc);
    const first = event('click');
    doc.dispatchEvent(first);
    // Cancelled, and stopped on the document (React, on its root below, never sees it).
    expect(first.defaultPrevented).toBe(true);
    expect(first.cancelBubble).toBe(true);
    const second = event('click');
    doc.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(second.cancelBubble).toBe(false);
  });

  it('a press that made no click (a drag) leaves the next click alone', () => {
    vi.useFakeTimers();
    const doc = new EventTarget();
    swallowNextClick(doc);
    doc.dispatchEvent(event('pointerup'));
    vi.runAllTimers();
    const click = event('click');
    doc.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('the click that comes with the release is still swallowed', () => {
    vi.useFakeTimers();
    const doc = new EventTarget();
    swallowNextClick(doc);
    // The release, then its click in the same task, before any timer.
    doc.dispatchEvent(event('pointerup'));
    const click = event('click');
    doc.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});

describe('attachPopupDismiss: the close conditions', () => {
  /**
   * A document and window with listeners attached for one menu.
   *
   * @param popup The open menu's element.
   * @returns The document, the window, the close spy and the stop function.
   */
  const setup = (popup: PopupElement | null = popupOf(target('menu row'))) => {
    const doc = new EventTarget();
    const win = new EventTarget();
    const close = vi.fn();
    const stop = attachPopupDismiss(doc, win, () => popup, close);
    return { doc, win, close, stop };
  };

  it('a press outside the menu closes it (the press itself is stopped)', () => {
    const { doc, close } = setup();
    // A press dispatched on the document has the document as its target: outside the menu.
    const press = event('pointerdown');
    doc.dispatchEvent(press);
    expect(close).toHaveBeenCalledWith('outside');
    expect(press.defaultPrevented).toBe(true);
  });

  it('the window losing focus (a click in another app) closes it', () => {
    const { win, close } = setup();
    win.dispatchEvent(event('blur'));
    expect(close).toHaveBeenCalledWith('blur');
  });

  it('Esc closes it; other keys do not', () => {
    const { doc, close } = setup();
    doc.dispatchEvent(event('keydown', { key: 'Enter' }));
    expect(close).not.toHaveBeenCalled();
    doc.dispatchEvent(event('keydown', { key: 'Escape' }));
    expect(close).toHaveBeenCalledWith('escape');
  });

  // ADR-0107: the menu's Escape is marked as used, so the overlay's voice Escape leaves it alone.
  it('marks its Escape as used, and leaves other keys alone', () => {
    const { doc } = setup();
    const enter = event('keydown', { key: 'Enter' });
    doc.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    const escape = event('keydown', { key: 'Escape' });
    doc.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
  });

  it('stops listening when the menu is closed', () => {
    const { doc, win, close, stop } = setup();
    stop();
    doc.dispatchEvent(event('pointerdown'));
    win.dispatchEvent(event('blur'));
    doc.dispatchEvent(event('keydown', { key: 'Escape' }));
    expect(close).not.toHaveBeenCalled();
  });
});
