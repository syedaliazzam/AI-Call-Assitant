/**
 * File: apps/web/src/core/stt/watchdog.ts
 * Purpose: Watches for a stuck speech engine: a worker that is alive but has stopped turning audio
 *          into transcript. The health monitor (health.ts) catches a worker that went silent (no
 *          statistics); this catches the other failure seen on Connect, where audio keeps arriving
 *          and statistics keep coming but no partial or final line is ever produced. When speech
 *          has been heard for STUCK_MS with no transcript progress, the live page restarts the
 *          engine and keeps the call (LivePage.tsx).
 * Used by: src/features/live/LivePage.tsx
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 (health); day-06 Stage 4
 *
 * It keeps two times only (never any transcript text): when transcript last made progress, and
 * when speech was last heard. "Stuck" means speech arrived after the last progress and no progress
 * has followed for STUCK_MS, so it never fires during a genuine silence.
 */

/** How long speech may arrive with no transcript progress before the engine is called stuck, in ms. */
export const STUCK_MS = 8_000;

/** Options for TranscriptWatchdog. */
export interface WatchdogOptions {
  /** The no-progress-with-speech time that counts as stuck (default STUCK_MS). */
  stuckMs?: number;
}

/**
 * Decides when the speech engine is stuck (audio in, no transcript out). The live page feeds it
 * transcript events and sound, and asks it once a second whether to restart.
 */
export class TranscriptWatchdog {
  /** The stuck threshold. */
  private readonly stuckMs: number;
  /** When transcript last made progress (a partial or final line), or null before the call starts. */
  private lastProgressAt: number | null = null;
  /** When speech was last heard, or null when none has been since the last progress. */
  private lastSoundAt: number | null = null;

  /** @param options See WatchdogOptions. */
  constructor(options: WatchdogOptions = {}) {
    this.stuckMs = options.stuckMs ?? STUCK_MS;
  }

  /**
   * Starts (or restarts) watching: the clock of "no progress" begins now, with no speech yet seen.
   * Called when the call connects and again right after a restart.
   *
   * @param now The current time (ms, any steady clock).
   * Called from: LivePage.tsx (connect, and after a restart)
   */
  start(now: number): void {
    this.lastProgressAt = now;
    this.lastSoundAt = null;
  }

  /**
   * Records that transcript made progress (a partial or final line arrived).
   *
   * @param now The current time.
   * Called from: the engine's onPartial and onFinal callbacks
   */
  noteProgress(now: number): void {
    this.lastProgressAt = now;
    this.lastSoundAt = null;
  }

  /**
   * Records that speech was heard (a channel's level was above the sound threshold).
   *
   * @param now The current time.
   * Called from: the capture's onLevels callback
   */
  noteSound(now: number): void {
    // Only speech that arrives after the last progress matters: that is audio the engine should
    // have turned into text and did not.
    if (this.lastProgressAt !== null && this.lastSoundAt === null) this.lastSoundAt = now;
  }

  /**
   * Whether the engine looks stuck: speech arrived after the last transcript progress, and no
   * progress has followed for stuckMs.
   *
   * @param now The current time.
   * @returns True when the engine should be restarted.
   * Called from: LivePage.tsx (the once-a-second check)
   */
  isStuck(now: number): boolean {
    if (this.lastProgressAt === null || this.lastSoundAt === null) return false;
    return now - this.lastSoundAt >= this.stuckMs && now - this.lastProgressAt >= this.stuckMs;
  }

  /**
   * Milliseconds since the last transcript progress (for the restart log; no transcript text).
   *
   * @param now The current time.
   * @returns The gap, or null before the call starts.
   */
  msSinceProgress(now: number): number | null {
    return this.lastProgressAt === null ? null : now - this.lastProgressAt;
  }

  /** Stops watching (the call ended or the page closed). */
  stop(): void {
    this.lastProgressAt = null;
    this.lastSoundAt = null;
  }
}

/**
 * ADR-0076 (P0-4): whether sound on a channel counts for the stuck-engine watchdog: only a channel the
 * on-device engine really decodes. Not a channel on Deepgram (cloud transcription), not "You" while the
 * worker sets it aside, and not "Them" while the worker skips it to catch up: the user speaking for 8 s
 * while "You" was set aside looked like a stuck engine and restarted it in the 13 Nov 2026 call.
 *
 * @param channel  Which channel had sound.
 * @param onDevice True when the on-device engine transcribes this channel now.
 * @param backlog  The worker's backlog state.
 * @returns True when the sound should have produced words.
 * Called from: LivePage.tsx (the capture's meters); tests
 */
export function soundCountsForWatchdog(
  channel: 'you' | 'them',
  onDevice: boolean,
  backlog: 'ok' | 'you-paused' | 'dropping',
): boolean {
  if (!onDevice) return false;
  return channel === 'them' ? backlog !== 'dropping' : backlog === 'ok';
}

/**
 * ADR-0076 (P0-4): whether a stuck-looking engine may be restarted now: never while the worker is behind.
 * That is load, not a stuck engine, and a restart loads a second model on a busy computer and throws away
 * the audio the worker was holding.
 *
 * @param backlog The worker's backlog state.
 * @returns True only when the worker keeps up.
 * Called from: LivePage.tsx (the once-a-second check); tests
 */
export function mayRestart(backlog: 'ok' | 'you-paused' | 'dropping'): boolean {
  return backlog === 'ok';
}
