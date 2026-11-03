/**
 * Tests apps/web/src/core/storage/answerPrefs.ts: the answer settings remembered on this device,
 * their defaults, and that a default stores nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getChatTarget,
  getCodingLanguage,
  getMissingInfoMode,
  getReviewOldestFirst,
  setChatTarget,
  setCodingLanguage,
  setMissingInfoMode,
  setReviewOldestFirst,
} from '@/core/storage/answerPrefs';

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

describe('answer settings', () => {
  it('starts on the defaults', () => {
    expect(getCodingLanguage()).toBe('Python');
    expect(getMissingInfoMode()).toBe('approach');
    expect(getChatTarget('s1')).toBe('auto');
    expect(getReviewOldestFirst()).toBe(false);
  });

  it('remembers each choice', () => {
    setCodingLanguage('Go');
    setMissingInfoMode('story');
    setChatTarget('s1', 'kite');
    setReviewOldestFirst(true);
    expect(getCodingLanguage()).toBe('Go');
    expect(getMissingInfoMode()).toBe('story');
    expect(getChatTarget('s1')).toBe('kite');
    expect(getReviewOldestFirst()).toBe(true);
  });

  it('keeps the chat switch per session', () => {
    setChatTarget('s1', 'call');
    expect(getChatTarget('s2')).toBe('auto');
  });

  it('stores nothing for a default, so a session on the defaults keeps its prompt', () => {
    setCodingLanguage('Python');
    setMissingInfoMode('approach');
    setChatTarget('s1', 'auto');
    expect(stored.size).toBe(0);
  });

  it('falls back to the defaults when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getCodingLanguage()).toBe('Python');
    expect(() => setCodingLanguage('Go')).not.toThrow();
  });

  it('ignores a value it does not know', () => {
    stored.set('kite.codingLanguage', 'Klingon');
    expect(getCodingLanguage()).toBe('Python');
  });
});
