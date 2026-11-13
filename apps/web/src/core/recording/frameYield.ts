/**
 * File: apps/web/src/core/recording/frameYield.ts
 * Purpose: The screen recording gives way to speech under load (Batch C, P1-6; investigation H3). While the
 *          computer is under CPU pressure (the Compute Pressure API says 'serious' or 'critical'), or the
 *          call's speech is being turned into text on this computer and needs the room (a cloud call's
 *          channel on the on-device fallback, or the on-device engine falling behind), the recording's frame
 *          rate drops to YIELD_FPS. It comes back to the quality's own rate after RESTORE_AFTER_MS of calm
 *          (pressure 'nominal', or unknown, with no such load). The recording's sound is never touched.
 *          Pure: the caller passes the readings and the time, and applies the frame rate it returns.
 * Used by: src/features/live/useCallRecording.ts; tests/unit/core/recording/frameYield.test.ts
 * Depends on: nothing
 * Architecture: docs/investigations/2026-11-13-production-readiness.md H3; ADR-0078
 */

/** The recording's frame rate while it gives way, frames a second. */
export const YIELD_FPS = 5;

/** Calm needed before the full frame rate comes back, ms. */
export const RESTORE_AFTER_MS = 30_000;

/** The Compute Pressure API's states (null where the browser has no such API). */
export type PressureState = 'nominal' | 'fair' | 'serious' | 'critical';

/** One reading. */
export interface LoadReading {
  /** The CPU's pressure state, or null when unknown. */
  pressure: PressureState | null;
  /** True while speech is being transcribed on this computer and needs the room (see Purpose). */
  localLoad: boolean;
}

/** What changed, for the timing trace. */
export interface FrameRateChange {
  /** The frame rate to apply now. */
  fps: number;
  /** Why: 'pressure', 'local' (speech on this computer), or 'calm' (restored). */
  reason: 'pressure' | 'local' | 'calm';
}

/** Decides the recording's frame rate from the load, one reading at a time. */
export class FrameRateGovernor {
  /** True while the frame rate is lowered. */
  private yielded = false;
  /** When the current calm began (ms), or null while not calm. */
  private calmSince: number | null = null;

  /** @param fullFps The quality's own frame rate (for example 15). */
  constructor(private readonly fullFps: number) {}

  /**
   * Whether the frame rate is lowered now.
   *
   * @returns True while yielding.
   */
  isYielding(): boolean {
    return this.yielded;
  }

  /**
   * Takes one reading.
   *
   * @param reading The pressure and the local speech load.
   * @param now     The time, ms.
   * @returns The new frame rate and why, when it changes; null when it stays.
   * Called from: useCallRecording.ts (once a second while a screen recording runs); tests
   */
  update(reading: LoadReading, now: number): FrameRateChange | null {
    const pressured = reading.pressure === 'serious' || reading.pressure === 'critical';
    if (pressured || reading.localLoad) {
      this.calmSince = null;
      if (this.yielded) return null;
      this.yielded = true;
      return { fps: YIELD_FPS, reason: pressured ? 'pressure' : 'local' };
    }
    if (!this.yielded) return null;
    // 'fair' is not calm yet: it neither lowers the rate nor counts towards bringing it back.
    const calm = reading.pressure === null || reading.pressure === 'nominal';
    if (!calm) {
      this.calmSince = null;
      return null;
    }
    this.calmSince ??= now;
    if (now - this.calmSince < RESTORE_AFTER_MS) return null;
    this.yielded = false;
    this.calmSince = null;
    return { fps: this.fullFps, reason: 'calm' };
  }
}
