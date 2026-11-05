/**
 * Tests apps/web/src/core/live/doublePress.ts (spec S14): two presses close together are a double press;
 * the first press, a slow second one, and a held key's repeats are not.
 */
import { describe, expect, it } from 'vitest';
import { DOUBLE_PRESS_MS, isDoublePress, KEY_REPEAT_MS } from '@/core/live/doublePress';

describe('isDoublePress', () => {
  it('is false for the first press', () => {
    expect(isDoublePress(null, 1_000)).toBe(false);
  });

  it('is true for a second press within the limit, up to and including it', () => {
    expect(isDoublePress(1_000, 1_200)).toBe(true);
    expect(isDoublePress(1_000, 1_000 + DOUBLE_PRESS_MS)).toBe(true);
  });

  it('is false for a slow second press', () => {
    expect(isDoublePress(1_000, 1_001 + DOUBLE_PRESS_MS)).toBe(false);
  });

  it('is false for a held key repeating', () => {
    expect(isDoublePress(1_000, 1_000 + KEY_REPEAT_MS - 1)).toBe(false);
  });
});
