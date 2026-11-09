/**
 * Tests for apps/web/src/features/live/overlay/useClickThrough.ts (isGap): only a layout box marked
 * data-gap counts as a transparent gap of the overlay; a bar, a panel, a button or anything else under
 * the pointer takes the click (ADR-0055). The hook itself is checked with the real shell in
 * apps/desktop/tests/manual/click-through.spec.ts. v1.3.2 (passesThrough): in Click-through mode everything
 * but the bars (data-bars) passes clicks through, the panels too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BARS_ATTRIBUTE,
  GAP_ATTRIBUTE,
  isGap,
  passesThrough,
} from '@/features/live/overlay/useClickThrough';

/** A stand-in for DOM elements (the unit tests run in Node). */
class FakeElement {
  /** Its attributes. */
  attributes: Set<string>;
  /** The element it is inside, if any. */
  parent: FakeElement | null;
  /**
   * @param attributes The attributes it has.
   * @param parent     The element it is inside, if any.
   */
  constructor(attributes: string[] = [], parent: FakeElement | null = null) {
    this.attributes = new Set(attributes);
    this.parent = parent;
  }
  /**
   * The nearest element, itself or above it, with an attribute (only '[name]' selectors).
   *
   * @param selector For example '[data-bars]'.
   * @returns The element, or null.
   */
  closest(selector: string): FakeElement | null {
    const name = selector.slice(1, -1);
    if (this.hasAttribute(name)) return this;
    return this.parent ? this.parent.closest(selector) : null;
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

describe('passesThrough (v1.3.2)', () => {
  it('passes only gaps when Click-through is off', () => {
    (globalThis as { Element?: unknown }).Element = FakeElement;
    const panel = new FakeElement(['data-panel']);
    expect(passesThrough(new FakeElement([GAP_ATTRIBUTE]) as unknown as EventTarget, false)).toBe(
      true,
    );
    expect(passesThrough(new FakeElement([], panel) as unknown as EventTarget, false)).toBe(false);
  });

  it('passes everything but the bars when Click-through is on', () => {
    (globalThis as { Element?: unknown }).Element = FakeElement;
    const bar = new FakeElement([BARS_ATTRIBUTE]);
    const panel = new FakeElement(['data-panel']);
    expect(passesThrough(new FakeElement([], panel) as unknown as EventTarget, true)).toBe(true);
    expect(passesThrough(new FakeElement([GAP_ATTRIBUTE]) as unknown as EventTarget, true)).toBe(
      true,
    );
    expect(passesThrough(new FakeElement([], bar) as unknown as EventTarget, true)).toBe(false);
    expect(passesThrough(bar as unknown as EventTarget, true)).toBe(false);
    expect(passesThrough(null, true)).toBe(true);
  });
});
