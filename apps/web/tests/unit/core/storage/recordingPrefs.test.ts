/**
 * Tests for apps/web/src/core/storage/recordingPrefs.ts (desktop 1.5.0, ADR-0068): the in-call
 * recording type defaults to Screen + audio and the quality to Standard; each is remembered; with
 * storage blocked the defaults apply, without throwing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRecordingKind,
  getRecordingQuality,
  setRecordingKind,
  setRecordingQuality,
} from '@/core/storage/recordingPrefs';

afterEach(() => vi.unstubAllGlobals());

describe('recordingPrefs', () => {
  it('defaults to Screen + audio and Standard, and remembers changes', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
    expect(getRecordingKind()).toBe('screen');
    expect(getRecordingQuality()).toBe('standard');
    setRecordingKind('audio');
    setRecordingQuality('high');
    expect(getRecordingKind()).toBe('audio');
    expect(getRecordingQuality()).toBe('high');
    setRecordingKind('screen');
    expect(getRecordingKind()).toBe('screen');
  });

  it('uses the defaults when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    setRecordingKind('audio');
    setRecordingQuality('high');
    expect(getRecordingKind()).toBe('screen');
    expect(getRecordingQuality()).toBe('standard');
  });
});
