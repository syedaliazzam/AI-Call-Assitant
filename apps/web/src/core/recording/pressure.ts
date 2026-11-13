/**
 * File: apps/web/src/core/recording/pressure.ts
 * Purpose: Watches the computer's CPU pressure with the Compute Pressure API (Chromium 125+, in the desktop
 *          app and in Chrome/Edge), for the recording's frame-rate yield (Batch C, P1-6; frameYield.ts).
 *          Where the API is missing or refused, nothing is reported and the yield relies on the other
 *          signal (speech on this computer). Reads states only ('nominal', 'fair', 'serious', 'critical').
 * Used by: src/features/live/useCallRecording.ts
 * Depends on: the browser's PressureObserver (injectable)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md H3; ADR-0078
 */
import type { PressureState } from './frameYield';

/** How often the browser may report, ms (it reports only changes). */
export const PRESSURE_SAMPLE_MS = 1_000;

/** The parts of the Compute Pressure API used here (it is not in TypeScript's DOM types yet). */
interface PressureObserverLike {
  /** Starts observing a source. */
  observe(source: 'cpu', options?: { sampleInterval?: number }): Promise<void>;
  /** Stops observing. */
  disconnect(): void;
}

/** The constructor, as found on the global object. */
type PressureObserverConstructor = new (
  callback: (records: readonly { state: string }[]) => void,
) => PressureObserverLike;

/**
 * Watches the CPU's pressure state.
 *
 * @param onState Called with each new state.
 * @param ctor    The PressureObserver constructor (default: the browser's, when there is one).
 * @returns Stops watching.
 * Called from: useCallRecording.ts (while a screen recording runs); tests
 */
export function watchCpuPressure(
  onState: (state: PressureState) => void,
  ctor: PressureObserverConstructor | undefined = (
    globalThis as { PressureObserver?: PressureObserverConstructor }
  ).PressureObserver,
): () => void {
  if (!ctor) return () => undefined;
  let observer: PressureObserverLike | null = null;
  try {
    observer = new ctor((records) => {
      const state = records.at(-1)?.state;
      if (state === 'nominal' || state === 'fair' || state === 'serious' || state === 'critical') {
        onState(state);
      }
    });
    // Refused by a permissions policy, or no CPU source on this computer: nothing is reported.
    void observer.observe('cpu', { sampleInterval: PRESSURE_SAMPLE_MS }).catch(() => undefined);
  } catch {
    return () => undefined;
  }
  return () => observer?.disconnect();
}
