/**
 * File: apps/web/src/core/stt/health.ts
 * Purpose: Turns the engine's once-a-second statistics into a simple status the UI can show:
 *          - 'ok';
 *          - 'slow' (a hint: combined real-time factor above 0.5 for 10 s; shown grey and
 *            dismissible: "Plug in your laptop for best results");
 *          - 'falling-behind' (a warning: above 0.8 for 5 s; decoding can barely keep up);
 *          - 'stalled' (no statistics for 3 s: the worker is stuck or has crashed).
 * Used by: src/features/dev/SttTest.tsx; the Connect and Live views (Day 2 Stage 4)
 * Depends on: src/core/stt/protocol.ts (EngineStats)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2, §13 (battery risk); ADR-0020
 *
 * Why two levels: 0.5 is the budget for both channels together, so above it there is no
 * headroom left, but the transcript still keeps up; on Day 2 a slow power state gave 0.57–0.65
 * while the status said "ok". 0.8 is where any extra load makes the backlog (and the lag) grow.
 * The cumulative real-time factor hides a recent slowdown, so the status uses the change between
 * consecutive statistics (about one second each).
 */
import type { EngineStats } from './protocol';

/** The engine's health, from best to worst. */
export type SttHealthStatus = 'ok' | 'slow' | 'falling-behind' | 'stalled';

/** How the UI should present a status. */
export type HealthTone = 'hint' | 'warning';

/** Thresholds. */
export interface HealthOptions {
  /** Real-time factor above which the "plug in" hint applies (default 0.5). */
  slowRtf?: number;
  /** How long it must stay above slowRtf before the hint, in ms (default 10000). */
  slowMs?: number;
  /** Real-time factor above which decoding counts as falling behind (default 0.8). */
  maxRtf?: number;
  /** How long it must stay above maxRtf before the warning, in ms (default 5000). */
  fallingBehindMs?: number;
  /** No statistics for this long means stalled, in ms (default 3000). */
  stalledMs?: number;
}

/** Watches statistics over time. */
export class SttHealthMonitor {
  /** Hint threshold. */
  private readonly slowRtf: number;
  /** Sustained time for the hint. */
  private readonly slowMs: number;
  /** Warning threshold. */
  private readonly maxRtf: number;
  /** Sustained time for the warning. */
  private readonly fallingBehindMs: number;
  /** Silence-from-the-worker time. */
  private readonly stalledMs: number;
  /** The previous statistics and when they arrived. */
  private previous: { at: number; decodeMs: number; audioMs: number } | null = null;
  /** Since when the real-time factor has stayed above slowRtf (null = it is not). */
  private aboveHintSince: number | null = null;
  /** Since when it has stayed above maxRtf (null = it is not). */
  private aboveWarningSince: number | null = null;

  /** @param options Thresholds (see HealthOptions). */
  constructor(options: HealthOptions = {}) {
    this.slowRtf = options.slowRtf ?? 0.5;
    this.slowMs = options.slowMs ?? 10_000;
    this.maxRtf = options.maxRtf ?? 0.8;
    this.fallingBehindMs = options.fallingBehindMs ?? 5_000;
    this.stalledMs = options.stalledMs ?? 3_000;
  }

  /**
   * Adds the latest statistics.
   *
   * @param stats The engine statistics.
   * @param at    When they arrived (ms, any steady clock such as performance.now()).
   * Called from: the engine's onStats callback in the UI
   */
  push(stats: EngineStats, at: number): void {
    const current = { at, decodeMs: stats.totalDecodeMs, audioMs: stats.totalAudioMs };
    if (this.previous) {
      const audio = current.audioMs - this.previous.audioMs;
      const decode = current.decodeMs - this.previous.decodeMs;
      // No new audio (nothing attached, or a paused stream) is not "slow".
      const rtf = audio > 0 ? decode / audio : 0;
      if (rtf > this.slowRtf) this.aboveHintSince ??= this.previous.at;
      else this.aboveHintSince = null;
      if (rtf > this.maxRtf) this.aboveWarningSince ??= this.previous.at;
      else this.aboveWarningSince = null;
    }
    this.previous = current;
  }

  /**
   * The current status (the worst that applies).
   *
   * @param now The same clock as push().
   * @returns 'stalled' if statistics stopped arriving, 'falling-behind' if decoding has been too
   *          slow for long enough, 'slow' if it has been over budget for long enough, otherwise
   *          'ok' (also before any statistics arrived).
   * Called from: the UI, on each render tick
   */
  status(now: number): SttHealthStatus {
    if (!this.previous) return 'ok';
    const last = this.previous.at;
    if (now - last >= this.stalledMs) return 'stalled';
    if (this.aboveWarningSince !== null && last - this.aboveWarningSince >= this.fallingBehindMs) {
      return 'falling-behind';
    }
    if (this.aboveHintSince !== null && last - this.aboveHintSince >= this.slowMs) return 'slow';
    return 'ok';
  }

  /** Forgets everything (for a new session or after the engine restarts). */
  reset(): void {
    this.previous = null;
    this.aboveHintSince = null;
    this.aboveWarningSince = null;
  }
}

/**
 * The message to show for a status.
 *
 * @param status The status.
 * @returns Text for the user, or null when everything is fine.
 * Called from: SttTest.tsx; the Connect and Live views (Stage 4)
 */
export function healthMessage(status: SttHealthStatus): string | null {
  switch (status) {
    case 'slow':
      return 'Plug in your laptop for best results.';
    case 'falling-behind':
      return 'Transcription is falling behind — plug in your laptop or close other apps.';
    case 'stalled':
      return 'Transcription has stopped responding. Reload the page if it does not recover.';
    default:
      return null;
  }
}

/**
 * How a status should look: 'hint' (grey, dismissible) or 'warning' (red, stays).
 *
 * @param status The status.
 * @returns The tone, or null for 'ok'.
 * Called from: SttTest.tsx; the Connect and Live views (Stage 4)
 */
export function healthTone(status: SttHealthStatus): HealthTone | null {
  if (status === 'ok') return null;
  return status === 'slow' ? 'hint' : 'warning';
}
