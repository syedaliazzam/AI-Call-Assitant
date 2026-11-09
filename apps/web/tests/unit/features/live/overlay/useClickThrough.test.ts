/**
 * Tests for apps/web/src/features/live/overlay/useClickThrough.ts (isGap): only a layout box marked
 * data-gap counts as a transparent gap of the overlay; a bar, a panel, a button or anything else under
 * the pointer takes the click (ADR-0055). The hook itself is checked with the real shell in
 * apps/desktop/tests/manual/click-through.spec.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GAP_ATTRIBUTE, isGap } from '@/features/live/overlay/useClickThrough';

/** A stand-in for DOM elements (the unit tests run in Node). */
class FakeElement {
  /** Its attributes. */
  attributes: Set<string>;
  /**
   * @param attributes The attributes it has.
   */
  constructor(attributes: string[] = []) {
    this.attributes = new Set(attributes);
  }
  /**
   * Whether it has an attribute.
   *
   * @param name The attribute.
   * @returns True when present.
   */
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
}

const realElement = (globalThis as { Element?: unknown }).Element;

afterEach(() => {
  (globalThis as { Element?: unknown }).Element = realElement;
});

describe('isGap', () => {
  it('is true only for a box marked data-gap', () => {
    (globalThis as { Element?: unknown }).Element = FakeElement;
    expect(isGap(new FakeElement([GAP_ATTRIBUTE]) as unknown as EventTarget)).toBe(true);
    expect(isGap(new FakeElement(['class']) as unknown as EventTarget)).toBe(false);
    expect(isGap(null)).toBe(false);
    expect(isGap({} as EventTarget)).toBe(false);
  });

  it('is false where there is no DOM', () => {
    (globalThis as { Element?: unknown }).Element = undefined;
    expect(isGap({} as EventTarget)).toBe(false);
  });
});
