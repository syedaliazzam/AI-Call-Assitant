/**
 * Tests apps/web/src/core/storage/companyPrefs.ts (ADR-0048): company suggestions are on by default,
 * remember being turned off, and read as off when storage is blocked, so a person's choice to stay
 * off Brandfetch cannot be lost by failing to read it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { companySuggestionsOn, setCompanySuggestionsOn } from '@/core/storage/companyPrefs';

afterEach(() => vi.unstubAllGlobals());

describe('companyPrefs', () => {
  it('is on by default, and remembers the choice', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
    expect(companySuggestionsOn()).toBe(true);
    setCompanySuggestionsOn(false);
    expect(companySuggestionsOn()).toBe(false);
    setCompanySuggestionsOn(true);
    expect(companySuggestionsOn()).toBe(true);
  });

  it('reads as off when storage is blocked, without throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(companySuggestionsOn()).toBe(false);
    expect(() => setCompanySuggestionsOn(true)).not.toThrow();
  });
});
