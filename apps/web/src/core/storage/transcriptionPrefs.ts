/**
 * File: apps/web/src/core/storage/transcriptionPrefs.ts
 * Purpose: The device's transcription setting (v1.0.1, ADR-0034; v1.1.0, ADR-0044; v1.4, ADR-0066):
 *          "Accurate transcription", which transcribes the other person's finished lines again with the
 *          desktop app's Parakeet engine during the call, and the user's own lines after it. On (the
 *          default since ADR-0066, on battery too), "Only when plugged in", or Off. With On or "Only
 *          when plugged in" the desktop app downloads the model by itself; Off never downloads it. Kept
 *          in this browser profile's localStorage (a device setting, like the overlay's), never sent
 *          anywhere.
 * Used by: src/features/settings/TranscriptionSetting.tsx, src/features/live/LivePage.tsx,
 *          src/features/home/AccurateDownload.tsx; tests
 * Depends on: localStorage (a missing or blocked one means the default: On)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md, ADR-0044, ADR-0066
 */

/**
 * localStorage key: 'plugged' or 'off' for a choice the user made ('on' from before ADR-0066 is
 * read as On); nothing stored means the default, On.
 */
export const ACCURATE_TRANSCRIPTION_KEY = 'kite.accurateTranscription';

/** The setting: always on (default), only when plugged in, or off. */
export type TranscriptionMode = 'on' | 'plugged' | 'off';

/**
 * The setting on this device. Before ADR-0066 the default was Auto (plugged in only), stored as
 * nothing: those devices now get the new default, On. A stored 'on' or 'off' keeps its meaning.
 *
 * @returns The setting (default 'on').
 * Called from: TranscriptionSetting.tsx, LivePage.tsx, AccurateDownload.tsx; tests
 */
export function getTranscriptionMode(): TranscriptionMode {
  try {
    const stored = localStorage.getItem(ACCURATE_TRANSCRIPTION_KEY);
    return stored === 'plugged' || stored === 'off' ? stored : 'on';
  } catch {
    // Storage blocked (private window, policy): the default.
    return 'on';
  }
}

/**
 * Changes the setting on this device.
 *
 * @param mode The new setting. 'on' (the default) removes the stored choice.
 * Called from: TranscriptionSetting.tsx; tests
 */
export function setTranscriptionMode(mode: TranscriptionMode): void {
  try {
    if (mode === 'on') localStorage.removeItem(ACCURATE_TRANSCRIPTION_KEY);
    else localStorage.setItem(ACCURATE_TRANSCRIPTION_KEY, mode);
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
}

/**
 * v1.4 (ADR-0066): whether the desktop app should start (or resume) the model's download by itself.
 *
 * @param mode  The setting.
 * @param state The engine's state on this computer (AccurateStatus.state).
 * @returns True unless the setting is Off or there is nothing to download (no engine build, already
 *          there, or already downloading).
 * Called from: AccurateDownload.tsx; tests
 */
export function downloadWanted(mode: TranscriptionMode, state: string): boolean {
  return mode !== 'off' && (state === 'not-downloaded' || state === 'error');
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
