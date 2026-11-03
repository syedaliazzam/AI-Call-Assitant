/**
 * Tests for apps/web/src/core/storage/voicePrefs.ts (item 8, ADR-0038), with a fake localStorage:
 * "Read replies aloud" and "Hands-free" are off until turned on, remember their value, and stay
 * off when storage is blocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHandsFree,
  getReadAloud,
  HANDS_FREE_KEY,
  READ_ALOUD_KEY,
  setHandsFree,
  setReadAloud,
} from '@/core/storage/voicePrefs';

/** The fake storage's contents. */
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('voicePrefs', () => {
  it('is off by default', () => {
    expect(getReadAloud()).toBe(false);
    expect(getHandsFree()).toBe(false);
  });

  it('remembers each switch', () => {
    setReadAloud(true);
    setHandsFree(true);
    expect(stored.get(READ_ALOUD_KEY)).toBe('on');
    expect(stored.get(HANDS_FREE_KEY)).toBe('on');
    expect(getReadAloud()).toBe(true);
    expect(getHandsFree()).toBe(true);
    setReadAloud(false);
    expect(getReadAloud()).toBe(false);
  });

  it('stays off when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => setHandsFree(true)).not.toThrow();
    expect(getHandsFree()).toBe(false);
  });
});
