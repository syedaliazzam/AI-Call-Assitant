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
 *          Batch C (P1-5; investigation A5): in an interview the other side is silent for as long as the user
 *          answers, so "Them" silent for 15 s while the user talked fired 15 times in one real call, every one
 *          of them meaningless. "Them" now counts as silent only after THEM_SILENT_FOR_MS (60 s) of no sound,
 *          and only while the user is not speaking (no sound for USER_PAUSE_MS), with the user heard at some
 *          point in that minute (so a call where nobody talks yet stays quiet). The microphone's rule is
 *          unchanged. ADR-0082: transcribed words count as sound too (heard()), so a channel whose meter
 *          stays under the silent level while its words arrive is never called silent.
 * Used by: src/features/live/LivePage.tsx (each meter update and once a second)
 * Depends on: src/core/audio/silence.ts (isSound: the meter's silent level)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); ADR-0069
 */
import { isSound } from './silence';

/** How long the microphone must hear nothing (while the other side talks) before Kite says so, ms. */
export const SILENT_FOR_MS = 15_000;

/** Batch C (P1-5): how long the other side must be silent before Kite says it hears nothing, ms. */
export const THEM_SILENT_FOR_MS = 60_000;

/** Batch C (P1-5): the user counts as speaking until their microphone has been quiet this long, ms. */
export const USER_PAUSE_MS = 2_000;

/** A call channel. */
export type CallChannel = 'you' | 'them';

/**
 * Watches both channels' levels.
 */
export class ChannelSilence {
  /** When each channel last had sound (or when watching started), ms. */
  private soundAt: Record<CallChannel, number>;

  /**
   * ADR-0082: when each channel's words last arrived (transcribed), ms; -Infinity before any. Words only
   * ever keep a channel from being called silent: they never make the other channel look silent.
   */
  private wordsAt: Record<CallChannel, number> = { you: -Infinity, them: -Infinity };

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
   * ADR-0082: words were transcribed on a channel (a grey or final line, or words held back for a voice
   * question), which proves it hears sound, whatever its meter says. A teammate's call (14 Nov 2026,
   * speakers on) showed "We can't hear the other side" while their lines were still arriving: the meeting's
   * sound reached the speech engine but stayed under the meter's silent level (0.1), so the meter alone
   * counted a minute of silence. Now no channel is ever called silent while its words keep arriving. Words only clear
   * a channel: the microphone rule still asks the meter whether the other side talked, so this never adds a
   * warning.
   *
   * @param channel The channel the words came from.
   * @param now     The time, ms.
   * Called from: LivePage.tsx (each non-empty grey or final line, on-device and cloud engines)
   */
  heard(channel: CallChannel, now: number): void {
    this.wordsAt[channel] = Math.max(this.wordsAt[channel], now);
  }

  /**
   * The channel that hears nothing: "Them" silent for THEM_SILENT_FOR_MS while the user is not speaking now
   * but was heard in that time (Batch C, P1-5); the microphone silent for SILENT_FOR_MS while the other side
   * talked in that time. ADR-0082: a channel whose words arrived in that time is never the silent one.
   *
   * @param now The time, ms.
   * @returns 'you', 'them', or null when both are fine (or nobody is talking).
   * Called from: LivePage.tsx (once a second)
   */
  silent(now: number): CallChannel | null {
    const youQuietFor = now - this.soundAt.you;
    // ADR-0082: the other side counts as heard when its meter had sound or its words arrived.
    const themHeardAt = Math.max(this.soundAt.them, this.wordsAt.them);
    if (
      now - themHeardAt >= THEM_SILENT_FOR_MS &&
      youQuietFor >= USER_PAUSE_MS &&
      youQuietFor < THEM_SILENT_FOR_MS
    ) {
      return 'them';
    }
    // ADR-0082: likewise the microphone, with its own words; whether the other side talked stays the meter's.
    const youHeardAt = Math.max(this.soundAt.you, this.wordsAt.you);
    if (now - youHeardAt >= SILENT_FOR_MS && now - this.soundAt.them < SILENT_FOR_MS) return 'you';
    return null;
  }
}
