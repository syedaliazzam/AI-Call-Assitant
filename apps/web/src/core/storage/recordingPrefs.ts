/**
 * File: apps/web/src/core/storage/recordingPrefs.ts
 * Purpose: This device's recording choices (desktop 1.5.0, ADR-0068): the type a recording started
 *          during a call uses (the ⋮ menu's "Recording type"; Screen + audio until changed) and the
 *          video quality (Settings; Standard 720p until changed). Kept in localStorage: per-device
 *          conveniences. The Connect card's Record choice is never remembered (it starts Off each time),
 *          and consent is asked for every recording.
 * Used by: src/features/live (LivePage, the ⋮ menu), src/features/settings/RecordingSetting.tsx
 * Depends on: localStorage, @kite/shared (RecordingKind, RecordingQuality)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
import type { RecordingKind, RecordingQuality } from '@kite/shared';

/** The localStorage key of the in-call recording type. */
const KIND_KEY = 'kite.recording.kind';

/** The localStorage key of the quality. */
const QUALITY_KEY = 'kite.recording.quality';

/**
 * Reads a value from localStorage.
 * @param key The key.
 * @returns The value, or null (also when storage is blocked).
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a value to localStorage (nothing happens when storage is blocked: the default is used).
 * @param key   The key.
 * @param value The value.
 */
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the default applies next time.
  }
}

/**
 * The type a recording started during a call uses (the Rec pill, Ctrl+Alt+R).
 * @returns 'screen' (the default) or 'audio'.
 * Called from: LivePage.tsx; tests
 */
export function getRecordingKind(): RecordingKind {
  return read(KIND_KEY) === 'audio' ? 'audio' : 'screen';
}

/**
 * Remembers the in-call recording type (the ⋮ menu).
 * @param kind The type.
 * Called from: LivePage.tsx; tests
 */
export function setRecordingKind(kind: RecordingKind): void {
  write(KIND_KEY, kind);
}

/**
 * The video quality.
 * @returns 'standard' (720p15, the default) or 'high' (1080p30).
 * Called from: LivePage.tsx, RecordingSetting.tsx; tests
 */
export function getRecordingQuality(): RecordingQuality {
  return read(QUALITY_KEY) === 'high' ? 'high' : 'standard';
}

/**
 * Remembers the video quality (Settings).
 * @param quality The quality.
 * Called from: RecordingSetting.tsx; tests
 */
export function setRecordingQuality(quality: RecordingQuality): void {
  write(QUALITY_KEY, quality);
}
