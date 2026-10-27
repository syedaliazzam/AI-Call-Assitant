/**
 * File: apps/web/src/core/stt/health.ts
 * Purpose: Turns the engine's once-a-second statistics into a simple status the UI can show:
 *          'ok', 'falling-behind' (decoding cannot keep up: real-time factor above 0.8 for 5 s)
 *          or 'stalled' (no statistics for 3 s: the worker is stuck or has crashed).
 * Used by: src/features/dev/SttTest.tsx; the live page's TranscriptStrip (Day 2 Stage 4)
 * Depends on: src/core/stt/protocol.ts (EngineStats)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2, §13 (battery risk); ADR-0020
 *
 * Why 0.8 and not 1.0: at a real-time factor near 1 the backlog (and so the lag) grows with any
 * extra load. The cumulative real-time factor hides a recent slowdown, so the status uses the
 * change between consecutive statistics (about one second each).
 */
import type { EngineStats } from './protocol';

/** The engine's health. */
export type SttHealthStatus = 'ok' | 'falling-behind' | 'stalled';

/** Thresholds. */
export interface HealthOptions {
  /** Real-time factor above which decoding counts as too slow (default 0.8). */
  maxRtf?: number;
  /** How long it must stay too slow before reporting it, in ms (default 5000). */
  fallingBehindMs?: number;
  /** No statistics for this long means stalled, in ms (default 3000). */
  stalledMs?: number;
}

/** Watches statistics over time. */
export class SttHealthMonitor {
  /** Real-time factor threshold. */
  private readonly maxRtf: number;
  /** Sustained-slowness time. */
  private readonly fallingBehindMs: number;
  /** Silence-from-the-worker time. */
  private readonly stalledMs: number;
  /** The previous statistics and when they arrived. */
  private previous: { at: number; decodeMs: number; audioMs: number } | null = null;
  /** When decoding became too slow without a break (null = it is keeping up). */
  private slowSince: number | null = null;

  /** @param options Thresholds (see HealthOptions). */
  constructor(options: HealthOptions = {}) {
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
      if (rtf > this.maxRtf) this.slowSince ??= this.previous.at;
      else this.slowSince = null;
    }
    this.previous = current;
  }

  /**
   * The current status.
   *
   * @param now The same clock as push().
   * @returns 'stalled' if statistics stopped arriving, 'falling-behind' if decoding has been too
   *          slow for long enough, otherwise 'ok' (also before any statistics arrived).
   * Called from: the UI, on each render tick
   */
  status(now: number): SttHealthStatus {
    if (!this.previous) return 'ok';
    if (now - this.previous.at >= this.stalledMs) return 'stalled';
    if (this.slowSince !== null && this.previous.at - this.slowSince >= this.fallingBehindMs) {
      return 'falling-behind';
    }
    return 'ok';
  }

  /** Forgets everything (for a new session or after the engine restarts). */
  reset(): void {
    this.previous = null;
    this.slowSince = null;
  }
}

/**
 * The message to show for a status.
 *
 * @param status The status.
 * @returns Text for the user, or null when everything is fine.
 * Called from: SttTest.tsx; TranscriptStrip (Stage 4)
 */
export function healthMessage(status: SttHealthStatus): string | null {
  switch (status) {
    case 'falling-behind':
      return 'Transcription is falling behind — plug in your laptop or close other apps.';
    case 'stalled':
      return 'Transcription has stopped responding. Reload the page if it does not recover.';
    default:
      return null;
  }
}
