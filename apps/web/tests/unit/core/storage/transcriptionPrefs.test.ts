/**
 * Tests for apps/web/src/core/storage/transcriptionPrefs.ts (v1.1.0, ADR-0044): Auto is the default;
 * a choice made before v1.1.0 carries over; Auto runs the engine plugged in and not on battery; a
 * computer that cannot tell counts as plugged in; storage being blocked gives the default.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCURATE_TRANSCRIPTION_KEY,
  accurateWanted,
  getTranscriptionMode,
  setTranscriptionMode,
} from '@/core/storage/transcriptionPrefs';

/**
 * An in-memory localStorage.
 *
 * @returns The storage.
 */
function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the setting', () => {
  it('is Auto on a device that never touched it', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(getTranscriptionMode()).toBe('auto');
  });

  it('keeps a choice made before v1.1.0, under the same key', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(ACCURATE_TRANSCRIPTION_KEY, 'on');
    expect(getTranscriptionMode()).toBe('on');
    storage.setItem(ACCURATE_TRANSCRIPTION_KEY, 'off');
    expect(getTranscriptionMode()).toBe('off');
  });

  it('remembers a change, and Auto removes the stored choice', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    setTranscriptionMode('on');
    expect(getTranscriptionMode()).toBe('on');
    setTranscriptionMode('auto');
    expect(storage.getItem(ACCURATE_TRANSCRIPTION_KEY)).toBeNull();
    expect(getTranscriptionMode()).toBe('auto');
  });

  it('gives the default when storage is blocked, and a change does not throw', () => {
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
    expect(getTranscriptionMode()).toBe('auto');
    expect(() => setTranscriptionMode('on')).not.toThrow();
  });
});

describe('whether the engine should run', () => {
  it('on Auto: plugged in yes, on battery no, unknown counts as plugged in', () => {
    expect(accurateWanted('auto', false)).toBe(true);
    expect(accurateWanted('auto', true)).toBe(false);
    expect(accurateWanted('auto', null)).toBe(true);
  });

  it('On and Off ignore the power source', () => {
    expect(accurateWanted('on', true)).toBe(true);
    expect(accurateWanted('off', false)).toBe(false);
  });
});
