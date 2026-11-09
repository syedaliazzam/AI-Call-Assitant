/**
 * Tests for apps/web/src/core/storage/transcriptionPrefs.ts (v1.1.0, ADR-0044; v1.4, ADR-0066): On is
 * the default, also on a device that had the old Auto default; a stored 'on' or 'off' keeps its
 * meaning; "Only when plugged in" runs the engine plugged in and not on battery; a computer that
 * cannot tell counts as plugged in; storage being blocked gives the default.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCURATE_TRANSCRIPTION_KEY,
  accurateWanted,
  downloadWanted,
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
  it('is On on a device that never touched it (the old Auto default stored nothing)', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(getTranscriptionMode()).toBe('on');
  });

  it('keeps a choice made before, under the same key', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(ACCURATE_TRANSCRIPTION_KEY, 'on');
    expect(getTranscriptionMode()).toBe('on');
    storage.setItem(ACCURATE_TRANSCRIPTION_KEY, 'off');
    expect(getTranscriptionMode()).toBe('off');
    storage.setItem(ACCURATE_TRANSCRIPTION_KEY, 'something else');
    expect(getTranscriptionMode()).toBe('on');
  });

  it('remembers a change, and On removes the stored choice', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    setTranscriptionMode('plugged');
    expect(getTranscriptionMode()).toBe('plugged');
    setTranscriptionMode('on');
    expect(storage.getItem(ACCURATE_TRANSCRIPTION_KEY)).toBeNull();
    expect(getTranscriptionMode()).toBe('on');
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
    expect(getTranscriptionMode()).toBe('on');
    expect(() => setTranscriptionMode('off')).not.toThrow();
  });
});

describe('whether the download starts by itself (ADR-0066)', () => {
  it('starts or resumes unless the setting is Off or there is nothing to download', () => {
    expect(downloadWanted('on', 'not-downloaded')).toBe(true);
    expect(downloadWanted('plugged', 'not-downloaded')).toBe(true);
    // A failed download is resumed (from where it stopped) at the next start.
    expect(downloadWanted('on', 'error')).toBe(true);
    expect(downloadWanted('off', 'not-downloaded')).toBe(false);
    for (const state of ['ready', 'downloading', 'unavailable']) {
      expect(downloadWanted('on', state)).toBe(false);
    }
  });
});

describe('whether the engine should run', () => {
  it('only when plugged in: plugged in yes, on battery no, unknown counts as plugged in', () => {
    expect(accurateWanted('plugged', false)).toBe(true);
    expect(accurateWanted('plugged', true)).toBe(false);
    expect(accurateWanted('plugged', null)).toBe(true);
  });

  it('On (also on battery) and Off ignore the power source', () => {
    expect(accurateWanted('on', true)).toBe(true);
    expect(accurateWanted('on', null)).toBe(true);
    expect(accurateWanted('off', false)).toBe(false);
  });
});
