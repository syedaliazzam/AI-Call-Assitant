/**
 * File: apps/web/src/core/audio/deviceWatch.ts
 * Purpose: Tells the call when the computer's audio devices change (1.5.1, ADR-0069): a headset plugged
 *          in or out, a Bluetooth device connecting. Before 1.5.1 a call kept the microphone it opened,
 *          so a headset plugged in mid-call was never heard (the browser's "default" track does not
 *          follow a new default). The live page then opens the system default again, or falls back to
 *          it when the chosen microphone has gone. Device ids and names only; never audio.
 *          Batch C (P1-5): it also reports the default sound output, so the call re-opens the system audio
 *          ("Them") when the default output changes (Windows' loopback hears only the default output).
 * Used by: src/features/live/LivePage.tsx
 * Depends on: src/platform/media.ts (listMicrophones)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); ADR-0069
 */
import { defaultOutputKey, listMicrophones, type MicDevice } from '@/platform/media';

/** Batch C (P1-5): the default output's key, for the live page to compare against (platform/media.ts). */
export { defaultOutputKey };

/** Devices often change in bursts (a headset brings its microphone and speaker): wait this long, ms. */
export const DEVICE_SETTLE_MS = 1_000;

/**
 * Watches for device changes.
 *
 * @param onChange Called with the microphones and (Batch C) the default output's key (null when unknown) once
 *                 a burst of changes has settled.
 * @param settleMs How long to wait after the last change, ms (default DEVICE_SETTLE_MS).
 * @returns A function that stops watching.
 * Called from: LivePage.tsx (while a call is connected); tests
 */
export function watchDeviceChanges(
  onChange: (mics: MicDevice[], defaultOutput: string | null) => void | Promise<void>,
  settleMs = DEVICE_SETTLE_MS,
): () => void {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!devices?.addEventListener) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const changed = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void Promise.all([listMicrophones(), defaultOutputKey()])
        .then(([mics, output]) => {
          if (!stopped) return onChange(mics, output);
        })
        .catch(() => undefined);
    }, settleMs);
  };
  devices.addEventListener('devicechange', changed);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    devices.removeEventListener('devicechange', changed);
  };
}
