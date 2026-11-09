/**
 * Tests for apps/web/src/platform/desktopDocument.ts (moveTitle): in the desktop app an element's
 * title becomes its aria-description and is removed, so no native tooltip window (which screen-share
 * protection does not cover) opens (ADR-0055). installDesktopDocument() is a no-op without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { installDesktopDocument, moveTitle } from '@/platform/desktopDocument';

/**
 * A stand-in element with attributes.
 *
 * @param attributes Its attributes.
 * @returns The element and its attributes.
 */
function element(attributes: Record<string, string>) {
  const values = new Map(Object.entries(attributes));
  return {
    values,
    getAttribute: (name: string) => values.get(name) ?? null,
    setAttribute: (name: string, value: string) => void values.set(name, value),
    removeAttribute: (name: string) => void values.delete(name),
  };
}

describe('moveTitle', () => {
  it('moves the title to aria-description', () => {
    const button = element({ title: 'Answer the latest question' });
    expect(moveTitle(button)).toBe(true);
    expect(button.values.get('title')).toBeUndefined();
    expect(button.values.get('aria-description')).toBe('Answer the latest question');
  });

  it('keeps an aria-description already there, and drops an empty title', () => {
    const kept = element({ title: 'Tooltip', 'aria-description': 'Own words' });
    moveTitle(kept);
    expect(kept.values.get('aria-description')).toBe('Own words');
    const empty = element({ title: '' });
    moveTitle(empty);
    expect([...empty.values.keys()]).toEqual([]);
  });

  it('leaves an element without a title alone', () => {
    const plain = element({ 'aria-label': 'Close' });
    expect(moveTitle(plain)).toBe(false);
    expect([...plain.values.entries()]).toEqual([['aria-label', 'Close']]);
  });
});

describe('installDesktopDocument', () => {
  it('does nothing without a DOM', () => {
    expect(() => installDesktopDocument(undefined)).not.toThrow();
  });
});
