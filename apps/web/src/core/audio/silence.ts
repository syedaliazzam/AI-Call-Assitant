/**
 * File: apps/web/src/core/audio/silence.ts
 * Purpose: Notices when the other side ("Them") has been silent for a while during a connected
 *          call (Day 6 Stage 4e), so Kite can suggest checking that the right tab or app is
 *          shared and playing sound. Uses the meter level only; never audio or words.
 * Used by: src/features/live/LivePage.tsx
 * Depends on: src/core/audio/levels.ts (the 0…1 meter scale)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); day-06 Stage 4
 */

/**
 * At or below this meter level the channel counts as silent (about -55 dBFS on the levels.ts
 * scale, where 0 is -60 dBFS: a wrong or muted tab sends 0).
 */
export const SILENT_LEVEL = 0.1;

/** How long "Them" must be silent before Kite says so, ms. */
export const SILENT_AFTER_MS = 20_000;

/**
 * Whether a meter level is sound (above SILENT_LEVEL).
 *
 * @param level The meter level, 0…1.
 * @returns True for sound.
 * Called from: LivePage.tsx (each level update)
 */
export function isSound(level: number): boolean {
  return level > SILENT_LEVEL;
}

/**
 * Whether "Them" has been silent long enough to say so.
 *
 * @param lastSoundAt When "Them" last had sound, or when the call connected (ms).
 * @param now         The current time (ms).
 * @returns True after SILENT_AFTER_MS of silence.
 * Called from: LivePage.tsx (once a second while connected)
 */
export function themSilent(lastSoundAt: number, now: number): boolean {
  return now - lastSoundAt >= SILENT_AFTER_MS;
}
