/**
 * File: apps/web/src/core/audio/deviceWatch.ts
 * Purpose: Tells the call when the computer's audio devices change (1.5.1, ADR-0069): a headset plugged
 *          in or out, a Bluetooth device connecting. Before 1.5.1 a call kept the microphone it opened,
 *          so a headset plugged in mid-call was never heard (the browser's "default" track does not
 *          follow a new default). The live page then opens the system default again, or falls back to
 *          it when the chosen microphone has gone. Device ids and names only; never audio.
 * Used by: src/features/live/LivePage.tsx
 * Depends on: src/platform/media.ts (listMicrophones)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); ADR-0069
 */
import { listMicrophones, type MicDevice } from '@/platform/media';

/** Devices often change in bursts (a headset brings its microphone and speaker): wait this long, ms. */
export const DEVICE_SETTLE_MS = 1_000;

/**
 * Watches for device changes.
 *
 * @param onChange Called with the microphones once a burst of changes has settled.
 * @param settleMs How long to wait after the last change, ms (default DEVICE_SETTLE_MS).
 * @returns A function that stops watching.
 * Called from: LivePage.tsx (while a call is connected); tests
 */
export function watchDeviceChanges(
  onChange: (mics: MicDevice[]) => void | Promise<void>,
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
      void listMicrophones()
        .then((mics) => {
          if (!stopped) return onChange(mics);
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
