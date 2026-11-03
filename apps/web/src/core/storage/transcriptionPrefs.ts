/**
 * File: apps/web/src/core/storage/transcriptionPrefs.ts
 * Purpose: The device's transcription setting (v1.0.1, ADR-0034): "Accurate transcription
 *          (beta)", which re-transcribes each finished line with the desktop app's Parakeet engine.
 *          Off unless the user turns it on; kept in this browser profile's localStorage (a device
 *          setting, like the overlay's), never sent anywhere.
 * Used by: src/features/settings/TranscriptionSetting.tsx, src/features/live/LivePage.tsx; tests
 * Depends on: localStorage (a missing or blocked one means the default: off)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */

/** localStorage key: 'on' when accurate transcription is turned on. */
export const ACCURATE_TRANSCRIPTION_KEY = 'kite.accurateTranscription';

/**
 * Whether the user turned accurate transcription on (default off).
 *
 * @returns True only after the user turned it on.
 * Called from: TranscriptionSetting.tsx, LivePage.tsx
 */
export function getAccurateTranscription(): boolean {
  try {
    return localStorage.getItem(ACCURATE_TRANSCRIPTION_KEY) === 'on';
  } catch {
    // Storage blocked (private window, policy): the default, off.
    return false;
  }
}

/**
 * Turns accurate transcription on or off for this device.
 *
 * @param on True to turn it on.
 * Called from: TranscriptionSetting.tsx
 */
export function setAccurateTranscription(on: boolean): void {
  try {
    localStorage.setItem(ACCURATE_TRANSCRIPTION_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
}
