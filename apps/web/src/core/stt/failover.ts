/**
 * File: apps/web/src/core/stt/failover.ts
 * Purpose: When one channel moves from Deepgram to the on-device engine and back (ADR-0076, investigation
 *          C9). Pure rules, one instance per channel; cloudStt.ts acts on them:
 *          - to the on-device engine: the socket errored or closed, no message for STALL_MS while this
 *            channel's level shows speech, the device is offline, the token could not be had, or the
 *            socket's send queue holds more than MAX_BUFFERED_MS of audio;
 *          - back to Deepgram: a new socket (tried after RETRY_DELAYS_MS) has been healthy for HEALTHY_MS,
 *            and both engines are at a pause (never mid-line).
 * Used by: src/core/stt/cloudStt.ts; tests/unit/core/stt/failover.test.ts
 * Depends on: nothing (pure; times are passed in)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C9; ADR-0076
 */

/** No Deepgram message for this long while the channel has speech: the socket is stalled, ms. */
export const STALL_MS = 3_000;

/** A socket that has been open and healthy this long may take the channel back, ms. */
export const HEALTHY_MS = 30_000;

/** More audio than this waiting to be sent means the connection cannot keep up, ms. */
export const MAX_BUFFERED_MS = 5_000;

/** Waits before each background retry, ms (the last one repeats). */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

/** Why a channel moved to the on-device engine. */
export type FailoverReason =
  'closed' | 'stalled' | 'offline' | 'token' | 'buffered' | 'open-failed';

/** Which engine a channel uses now. */
export type ChannelEngine = 'deepgram' | 'local';

/** One channel's failover state. */
export class ChannelFailover {
  /** The engine in use. */
  engine: ChannelEngine = 'deepgram';
  /** When Deepgram last sent anything on the active socket (or it opened), or null. */
  private lastMessageAt: number | null = null;
  /** The first speech heard after the last message, or null. */
  private soundSince: number | null = null;
  /** How many retries have failed since the switch. */
  private failures = 0;
  /** When the next retry is due (Unix ms), or null while one runs or the channel is on Deepgram. */
  private retryAt: number | null = null;
  /** When the probe socket opened (Unix ms), or null. */
  private probeOpenedAt: number | null = null;

  /**
   * The socket opened (at Connect, or a probe after a failover).
   *
   * @param now Unix ms.
   * Called from: cloudStt.ts
   */
  opened(now: number): void {
    this.lastMessageAt = now;
    this.soundSince = null;
    if (this.engine === 'local') {
      this.probeOpenedAt = now;
      this.retryAt = null;
    }
  }

  /**
   * A message arrived on the active socket.
   *
   * @param now Unix ms.
   * Called from: cloudStt.ts
   */
  message(now: number): void {
    this.lastMessageAt = now;
    this.soundSince = null;
  }

  /**
   * The channel's level showed speech.
   *
   * @param now Unix ms.
   * Called from: cloudStt.ts (from the capture's meters)
   */
  sound(now: number): void {
    if (this.soundSince === null) this.soundSince = now;
  }

  /**
   * Whether Deepgram has been silent for STALL_MS while speech kept arriving (only on Deepgram).
   *
   * @param now Unix ms.
   * @returns True when the channel should move to the on-device engine.
   * Called from: cloudStt.ts (once a second)
   */
  stalled(now: number): boolean {
    if (this.engine !== 'deepgram' || this.lastMessageAt === null || this.soundSince === null) {
      return false;
    }
    return now - this.soundSince >= STALL_MS && now - this.lastMessageAt >= STALL_MS;
  }

  /**
   * The channel moved to the on-device engine (or a probe failed): the next retry is scheduled.
   *
   * @param now Unix ms.
   * Called from: cloudStt.ts
   */
  failed(now: number): void {
    if (this.engine === 'local') this.failures += 1;
    this.engine = 'local';
    this.probeOpenedAt = null;
    this.lastMessageAt = null;
    this.soundSince = null;
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)]!;
    this.retryAt = now + delay;
  }

  /**
   * Whether a background retry should start now (on the on-device engine, no probe running).
   *
   * @param now Unix ms.
   * @returns True once the retry is due; it is then marked as running.
   * Called from: cloudStt.ts (once a second)
   */
  retryDue(now: number): boolean {
    if (this.engine !== 'local' || this.retryAt === null || now < this.retryAt) return false;
    this.retryAt = null;
    return true;
  }

  /**
   * Whether the probe has been healthy long enough to take the channel back.
   *
   * @param now   Unix ms.
   * @param pause True when both engines are at a pause on this channel.
   * @returns True to switch back now.
   * Called from: cloudStt.ts (once a second)
   */
  canReturn(now: number, pause: boolean): boolean {
    return (
      this.engine === 'local' &&
      this.probeOpenedAt !== null &&
      now - this.probeOpenedAt >= HEALTHY_MS &&
      pause
    );
  }

  /**
   * The channel is back on Deepgram.
   *
   * @param now Unix ms.
   * Called from: cloudStt.ts
   */
  returned(now: number): void {
    this.engine = 'deepgram';
    this.failures = 0;
    this.retryAt = null;
    this.probeOpenedAt = null;
    this.lastMessageAt = now;
    this.soundSince = null;
  }
}
