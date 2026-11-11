/**
 * File: apps/web/src/core/audio/channelSilence.ts
 * Purpose: Notices a call channel that hears nothing while the other one is talking (1.5.1, ADR-0069):
 *          the microphone ("You") silent for SILENT_FOR_MS while the other side spoke in that time, or
 *          the call's sound ("Them") silent while the user spoke. A call ran on 11 Nov 2026 with no
 *          "Them" lines at all (the meeting played through a device the system sound capture does not
 *          hear); a muted or wrong microphone, a microphone another app holds, or Windows' privacy
 *          setting give the same silence on "You". Uses meter levels only; never audio or words.
 *          Replaces the older "Them silent for 20 s" rule (silence.ts themSilent), which also fired when
 *          nobody was talking at all.
 * Used by: src/features/live/LivePage.tsx (each meter update and once a second)
 * Depends on: src/core/audio/silence.ts (isSound: the meter's silent level)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); ADR-0069
 */
import { isSound } from './silence';

/** How long a channel must hear nothing (while the other talks) before Kite says so, ms. */
export const SILENT_FOR_MS = 15_000;

/** A call channel. */
export type CallChannel = 'you' | 'them';

/**
 * Watches both channels' levels.
 */
export class ChannelSilence {
  /** When each channel last had sound (or when watching started), ms. */
  private soundAt: Record<CallChannel, number>;

  /**
   * @param now When the call connected, ms.
   */
  constructor(now: number) {
    this.soundAt = { you: now, them: now };
  }

  /**
   * Takes a meter update.
   *
   * @param levels Both channels' meter levels (0…1).
   * @param now    The time, ms.
   * Called from: LivePage.tsx (onLevels)
   */
  levels(levels: Record<CallChannel, number>, now: number): void {
    if (isSound(levels.you)) this.soundAt.you = now;
    if (isSound(levels.them)) this.soundAt.them = now;
  }

  /**
   * Starts a channel's clock again (a new microphone or a new source was chosen).
   *
   * @param channel The channel.
   * @param now     The time, ms.
   * Called from: LivePage.tsx (device changes, reconnect)
   */
  reset(channel: CallChannel, now: number): void {
    this.soundAt[channel] = now;
  }

  /**
   * The channel that has heard nothing for SILENT_FOR_MS while the other one talked in that time.
   *
   * @param now The time, ms.
   * @returns 'you', 'them', or null when both are fine (or nobody is talking).
   * Called from: LivePage.tsx (once a second)
   */
  silent(now: number): CallChannel | null {
    for (const channel of ['them', 'you'] as const) {
      const other = channel === 'you' ? 'them' : 'you';
      const quietFor = now - this.soundAt[channel];
      const otherTalked = now - this.soundAt[other] < SILENT_FOR_MS;
      if (quietFor >= SILENT_FOR_MS && otherTalked) return channel;
    }
    return null;
  }
}
