/**
 * File: apps/web/src/core/audio/levels.ts
 * Purpose: Turns raw audio into a 0…1 level for the audio meters ("You" and "Them" in the
 *          Connect view): root-mean-square loudness, mapped on a decibel scale (so quiet speech
 *          still moves the bar), smoothed so the bar rises fast and falls slowly instead of
 *          flickering.
 * Used by: src/core/audio/capture.ts
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect: audio test meters)
 */

/** Level 0 at this loudness and below (dBFS; about a quiet room). */
export const MIN_DB = -60;

/** Level 1 at this loudness and above (dBFS; loud speech close to the microphone). */
export const MAX_DB = -10;

/**
 * Root-mean-square loudness of some samples.
 *
 * @param samples Samples (-1…1).
 * @returns RMS, 0…1 (0 for no samples).
 * Called from: capture.ts (meter timer); tests
 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += (samples[i] ?? 0) ** 2;
  return Math.sqrt(sum / samples.length);
}

/**
 * Maps an RMS value to a 0…1 meter level on a decibel scale between MIN_DB and MAX_DB.
 *
 * @param value RMS (0…1).
 * @returns 0…1.
 * Called from: capture.ts; tests
 */
export function rmsToLevel(value: number): number {
  if (value <= 0) return 0;
  const db = 20 * Math.log10(value);
  return Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
}

/** Settings for LevelSmoother. */
export interface SmootherOptions {
  /** Share of a rise applied at once, 0…1 (default 0.6: the bar jumps up). */
  attack?: number;
  /** Share of a fall applied each update, 0…1 (default 0.15: the bar sinks slowly). */
  release?: number;
}

/** Smooths a stream of levels for display. */
export class LevelSmoother {
  /** Rise factor. */
  private readonly attack: number;
  /** Fall factor. */
  private readonly release: number;
  /** The current displayed level. */
  private value = 0;

  /** @param options See SmootherOptions. */
  constructor(options: SmootherOptions = {}) {
    this.attack = options.attack ?? 0.6;
    this.release = options.release ?? 0.15;
  }

  /**
   * Moves the displayed level towards a new reading.
   *
   * @param level The new reading, 0…1.
   * @returns The level to display, 0…1.
   * Called from: capture.ts (each meter tick); tests
   */
  update(level: number): number {
    const factor = level > this.value ? this.attack : this.release;
    this.value += (level - this.value) * factor;
    return this.value;
  }
}
