/**
 * Tests for apps/web/src/core/storage/hintPrefs.ts (v1.1.0): each one-time notice is remembered on its
 * own, and with storage blocked it shows again, which is the safe way to fail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hintSeen, markHintSeen } from '@/core/storage/hintPrefs';

afterEach(() => vi.unstubAllGlobals());

describe('hintPrefs', () => {
  it('remembers each notice on its own', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
    expect(hintSeen('acceptable-use')).toBe(false);
    markHintSeen('acceptable-use');
    expect(hintSeen('acceptable-use')).toBe(true);
    expect(hintSeen('headphones')).toBe(false);
  });

  it('shows again when storage is blocked, without throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => markHintSeen('headphones')).not.toThrow();
    expect(hintSeen('headphones')).toBe(false);
  });
});
