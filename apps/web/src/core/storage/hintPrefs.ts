/**
 * File: apps/web/src/core/storage/hintPrefs.ts
 * Purpose: Notices that show once on a device (v1.1.0): the acceptable-use notice and the headphones
 *          hint. (The offer to download the accurate-transcription model went in v1.4, ADR-0066: the
 *          desktop app now downloads it by itself.) Kept in localStorage: a
 *          per-device convenience. With storage blocked, a notice shows again next time, which is the
 *          safe way to fail for something the person should see.
 * Used by: src/features/notices/AcceptableUseNotice.tsx, src/features/live/LiveAnswers.tsx,
 *          src/features/home/HomePanel.tsx
 * Depends on: localStorage
 * Architecture: ADR-0041, ADR-0044, ADR-0066
 */

/** A notice that shows once. */
export type OnceHint = 'acceptable-use' | 'headphones';

/** The localStorage key of each notice. */
const KEYS: Readonly<Record<OnceHint, string>> = {
  'acceptable-use': 'kite.hint.acceptableUse',
  headphones: 'kite.hint.headphones',
};

/**
 * Whether a notice has been seen on this device.
 *
 * @param hint The notice.
 * @returns True once it has been marked as seen.
 * Called from: the components above; tests
 */
export function hintSeen(hint: OnceHint): boolean {
  try {
    return localStorage.getItem(KEYS[hint]) === 'seen';
  } catch {
    return false;
  }
}

/**
 * Marks a notice as seen on this device.
 *
 * @param hint The notice.
 * Called from: the components above; tests
 */
export function markHintSeen(hint: OnceHint): void {
  try {
    localStorage.setItem(KEYS[hint], 'seen');
  } catch {
    // Storage blocked: it shows again next time.
  }
}
