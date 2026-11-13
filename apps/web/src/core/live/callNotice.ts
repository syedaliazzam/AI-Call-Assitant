/**
 * File: apps/web/src/core/live/callNotice.ts
 * Purpose: The one notice a call shows about what it hears (1.5.1, ADR-0069), in order of importance:
 *          a channel that hears nothing while the other talks (with a button to its device list), the
 *          speech worker catching up (some of the other side's words skipped), and the user's own lines
 *          set aside while the computer is busy ("filled in after the call"). Shown in the overlay's bars
 *          and in the call window.
 * Used by: src/features/live/LivePage.tsx (and through LiveAnswers.tsx the overlay, CompactView.tsx)
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); ADR-0069
 */

/** Which notice. */
export type CallNoticeKind =
  | 'mic-silent'
  | 'them-silent'
  | 'catching-up'
  | 'you-deferred'
  // ADR-0076: cloud transcription could not be reached; the on-device engine writes the lines.
  | 'cloud-fallback';

/** A call notice. */
export interface CallNotice {
  /** Which notice. */
  kind: CallNoticeKind;
  /** The short line (fits the overlay's bar). */
  text: string;
  /** One more sentence for the call window, or ''. */
  detail: string;
  /** The button that opens the right device list, if any. */
  action?: CallNoticeAction;
}

/** A call notice's button. */
export interface CallNoticeAction {
  /** The device list it opens: 'mic' (microphones) or 'audio' (the other side's source). */
  list: 'mic' | 'audio';
  /** The button's words. */
  label: string;
}

/** What callNoticeFor() needs. */
export interface CallNoticeInput {
  /** The channel that hears nothing while the other talks (core/audio/channelSilence.ts), or null. */
  silent: 'you' | 'them' | null;
  /** The speech worker's backlog state (core/stt/backlog.ts). */
  backlog: 'ok' | 'you-paused' | 'dropping';
  /** 'desktop' or 'browser' (the advice differs). */
  platform: string;
  /** ADR-0076: true while a channel of a cloud-transcribed call uses the on-device engine instead. */
  cloudFallback?: boolean;
}

/**
 * The notice to show now.
 *
 * @param input What the call hears and how the speech worker keeps up.
 * @returns The notice, or null for none.
 * Called from: LivePage.tsx; tests
 */
export function callNoticeFor(input: CallNoticeInput): CallNotice | null {
  const desktop = input.platform === 'desktop';
  if (input.silent === 'you') {
    return {
      kind: 'mic-silent',
      text: "We can't hear your microphone — check the 🎤 picker.",
      detail: desktop
        ? 'Pick the microphone you are using. On Windows, also check Settings › Privacy › Microphone (desktop apps allowed), and that no other app holds the microphone on its own.'
        : 'Pick the microphone you are using, and check that the browser may use it.',
      action: { list: 'mic', label: 'Choose microphone' },
    };
  }
  if (input.silent === 'them') {
    return {
      kind: 'them-silent',
      text: "We can't hear the other side — check the audio source.",
      detail: desktop
        ? "Paramount AI hears your computer's default speaker. If the meeting plays through a headset or device that is not the default, make it the default in Windows sound settings."
        : 'Share the meeting tab with “Also share tab audio” on, and check that it is playing sound.',
      action: { list: 'audio', label: 'Choose audio source' },
    };
  }
  // ADR-0076: after a silent channel (which needs the user), before the on-device engine's own backlog.
  if (input.cloudFallback) {
    return {
      kind: 'cloud-fallback',
      text: 'Cloud transcription unavailable — using on-device transcription.',
      detail:
        'Paramount AI keeps trying the cloud in the background and switches back by itself. On-device transcription is a little slower and less accurate.',
    };
  }
  if (input.backlog === 'dropping') {
    return {
      kind: 'catching-up',
      text: 'Catching up — the computer is busy; a few words may be missing.',
      detail: 'Closing other busy apps helps.',
    };
  }
  if (input.backlog === 'you-paused') {
    return {
      kind: 'you-deferred',
      text: 'Your lines will be filled in after the call.',
      detail: 'The computer is busy, so the other side’s words come first.',
    };
  }
  return null;
}
