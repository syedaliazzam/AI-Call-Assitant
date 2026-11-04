/**
 * File: apps/web/src/core/storage/transcriptionPrefs.ts
 * Purpose: The device's transcription setting (v1.0.1, ADR-0034; v1.1.0, ADR-0044): "Accurate
 *          transcription", which re-transcribes each finished line with the desktop app's Parakeet
 *          engine. Auto (the default) uses it when plugged in and not on battery; On and Off are also
 *          available. Auto never starts the model's download: it only uses a model that is already on
 *          this computer. Kept in this browser profile's localStorage (a device setting, like the
 *          overlay's), never sent anywhere.
 * Used by: src/features/settings/TranscriptionSetting.tsx, src/features/live/LivePage.tsx,
 *          src/features/home/AccurateOffer.tsx; tests
 * Depends on: localStorage (a missing or blocked one means the default: Auto)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md, ADR-0044
 */

/** localStorage key: 'on' or 'off' for a choice the user made; nothing stored means Auto. */
export const ACCURATE_TRANSCRIPTION_KEY = 'kite.accurateTranscription';

/** The setting: on when plugged in, always on, or always off. */
export type TranscriptionMode = 'auto' | 'on' | 'off';

/**
 * The setting on this device. Before v1.1.0 the switch stored 'on' or 'off' only once it was changed,
 * so those choices carry over and a device that never touched it becomes Auto.
 *
 * @returns The setting (default 'auto').
 * Called from: TranscriptionSetting.tsx, LivePage.tsx, AccurateOffer.tsx; tests
 */
export function getTranscriptionMode(): TranscriptionMode {
  try {
    const stored = localStorage.getItem(ACCURATE_TRANSCRIPTION_KEY);
    return stored === 'on' || stored === 'off' ? stored : 'auto';
  } catch {
    // Storage blocked (private window, policy): the default.
    return 'auto';
  }
}

/**
 * Changes the setting on this device.
 *
 * @param mode The new setting. 'auto' removes the stored choice.
 * Called from: TranscriptionSetting.tsx; tests
 */
export function setTranscriptionMode(mode: TranscriptionMode): void {
  try {
    if (mode === 'auto') localStorage.removeItem(ACCURATE_TRANSCRIPTION_KEY);
    else localStorage.setItem(ACCURATE_TRANSCRIPTION_KEY, mode);
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
}

/**
 * Whether the accurate engine should run now.
 *
 * @param mode      The setting.
 * @param onBattery True when the computer is on battery; null when that cannot be told, which counts
 *                  as plugged in (a desktop without a battery reports nothing to worry about).
 * @returns True to use the engine (when it is downloaded).
 * Called from: LivePage.tsx; tests
 */
export function accurateWanted(mode: TranscriptionMode, onBattery: boolean | null): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return onBattery !== true;
}
