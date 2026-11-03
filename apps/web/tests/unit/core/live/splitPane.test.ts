/**
 * Tests for apps/web/src/core/live/splitPane.ts (live-ui-split): the split divider's fraction is
 * clamped to SPLIT_RANGE, the default is stored as nothing (removed), and reads survive blocked or
 * garbage storage by falling back to the default. localStorage is faked (the suite runs on Node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampSplit, getSplit, setSplit, SPLIT_KEY, SPLIT_RANGE } from '@/core/live/splitPane';

/** The fake storage's contents. */
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('clampSplit', () => {
  it('keeps a fraction inside the range', () => {
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0.1)).toBe(SPLIT_RANGE.min);
    expect(clampSplit(0.95)).toBe(SPLIT_RANGE.max);
  });

  it('returns the default for anything not a finite number', () => {
    expect(clampSplit(Number.NaN)).toBe(SPLIT_RANGE.default);
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(SPLIT_RANGE.default);
  });
});

describe('getSplit / setSplit', () => {
  it('defaults when nothing is saved, and round-trips a saved value', () => {
    expect(getSplit()).toBe(SPLIT_RANGE.default);
    setSplit(0.35);
    expect(getSplit()).toBe(0.35);
    expect(stored.get(SPLIT_KEY)).toBe('0.35');
  });

  it('stores the default as nothing (so a device on the default follows any later default)', () => {
    setSplit(0.6);
    expect(stored.has(SPLIT_KEY)).toBe(true);
    setSplit(SPLIT_RANGE.default);
    expect(stored.has(SPLIT_KEY)).toBe(false);
  });

  it('clamps before saving, and reads a garbage value as the default', () => {
    setSplit(0.05);
    expect(getSplit()).toBe(SPLIT_RANGE.min);
    stored.set(SPLIT_KEY, 'not-a-number');
    expect(getSplit()).toBe(SPLIT_RANGE.default);
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getSplit()).toBe(SPLIT_RANGE.default);
    expect(() => setSplit(0.4)).not.toThrow();
  });
});
