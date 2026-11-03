/**
 * Tests apps/web/src/core/storage/transcriptionPrefs.ts (v1.0.1, ADR-0034): accurate
 * transcription is off by default (and when storage is blocked), and remembers the user's choice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccurateTranscription,
  setAccurateTranscription,
} from '@/core/storage/transcriptionPrefs';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});

describe('accurate transcription setting', () => {
  it('is off by default, and remembers on and off', () => {
    expect(getAccurateTranscription()).toBe(false);
    setAccurateTranscription(true);
    expect(getAccurateTranscription()).toBe(true);
    setAccurateTranscription(false);
    expect(getAccurateTranscription()).toBe(false);
  });

  it('is off when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getAccurateTranscription()).toBe(false);
  });
});
