/**
 * File: apps/web/src/features/live/overlay/statusLine.ts
 * Purpose: What the overlay's warning line says (ADR-0082; ADR-0118: a slim line of its own under the
 *          transcript bar, shown only while a message applies; from ADR-0082 to ADR-0118 it replaced the live
 *          words on bar 2): the most important message there is, with its button. In order: listening paused, "Still in a call?", a voice question listening, a
 *          channel that hears nothing (with its device list), another app holding the Answer key, a screen
 *          recording with Private off, the other call notices (catching up, cloud transcription), why the
 *          last voice question sent nothing, the answers' notice, Private off during the call, the offer to
 *          rename the other person (ADR-0093: "Rename Them to Sarah?"), and the one-time headphones hint.
 * Used by: src/features/live/CompactView.tsx (it renders the message with overlay/WarningLine.tsx)
 * Depends on: src/core/live/liveChannel.ts (types), src/features/live/PrivateOffWarning.tsx (words)
 * Architecture: ADR-0082 (one status bar); ADR-0069 (call notices), ADR-0070 (Private off), ADR-0076 (G4)
 *
 * Pure: no React, no text from the call (only the app's own messages), except the other person's name
 * in the rename offer (ADR-0093), which is shown, never logged.
 */
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import { PRIVATE_OFF_TEXT } from '../PrivateOffWarning';

/** The button beside a message. */
export type StatusAction =
  | {
      /** Sends a command to the live page. */
      kind: 'command';
      /** The command. */
      command: CompactCommand;
      /** The button's words. */
      label: string;
    }
  | {
      /** Opens a device list on the overlay. */
      kind: 'list';
      /** Which list: the other side's source or the microphones. */
      list: 'audio' | 'mic';
      /** The button's words. */
      label: string;
    }
  | {
      /** Turns Private (screen-share protection) back on. */
      kind: 'private';
      /** The button's words. */
      label: string;
    };

/** One message on the status line. */
export interface StatusMessage {
  /** Which message (tests and data attributes). */
  key:
    | 'paused'
    | 'still-here'
    | 'listening'
    | 'voice-mode'
    | 'mic-silent'
    | 'them-silent'
    | 'answer-key'
    | 'private-off'
    | 'private-off-call'
    | 'rename-them'
    | 'call-notice'
    | 'voice-notice'
    | 'notice'
    | 'headphones';
  /** The words (short: one line of the bar). */
  text: string;
  /**
   * How it looks: an alert (red), a warning (amber), the listening state (red), quiet (muted), or an
   * offer (ADR-0093: plain text, nothing is wrong).
   */
  tone: 'alert' | 'warning' | 'listening' | 'muted' | 'offer';
  /** One more sentence, shown as the line's tooltip, or absent. */
  detail?: string;
  /** Its button, if any. */
  action?: StatusAction;
  /** ADR-0093: a second button that sends a command ("Not now"), if any. */
  dismiss?: {
    /** The command it sends. */
    command: CompactCommand;
    /** The button's words. */
    label: string;
  };
}

/** ADR-0082: what the status line says while a voice question listens. */
export const LISTENING_TEXT = 'Listening… (Esc cancels)';

/** ADR-0095: what the status line says while Voice mode listens. */
export const VOICE_MODE_TEXT =
  "Talking to Paramount AI — your words aren't sent to the interviewer transcript";

/** ADR-0095: what it says while Voice mode is paused because the other person is speaking. */
export const VOICE_PAUSED_TEXT =
  "Voice paused while they speak — your words aren't sent to the interviewer transcript";

/** ADR-0082: the short words for a channel that hears nothing (the call window keeps the long ones). */
export const SILENT_TEXT = {
  them: "Can't hear the other side",
  you: "Can't hear your microphone",
} as const;

/** ADR-0085: the line while Private is off during a call (no recording). Windows (and a browser). */
export const PRIVATE_OFF_CALL_TEXT = 'Private is off: the overlay shows in screen shares';

/**
 * ADR-0120: the same line on a Mac. There Private hides the overlay when the user shares one window or tab,
 * not the entire screen (apps that capture with ScreenCaptureKit can still show it in a whole-screen share;
 * ADR-0111 §7), so the Windows words would promise too much.
 */
export const PRIVATE_OFF_CALL_TEXT_MAC =
  'Private is off. On a Mac, Private hides the overlay when you share a window or tab, not your entire screen.';

/** ADR-0082: the headphones hint, short. */
export const HEADPHONES_TEXT = 'Speakers echoing — use headphones';

/**
 * The message the status line shows now, most important first.
 *
 * @param state      What the live page shows (null until it answers).
 * @param privateOff True while a screen recording runs with Private off (usePrivateOffWhileRecording()).
 * @param privateOffInCall ADR-0085: true while Private is off during the call (where it can be on); quieter
 *                         than the recording warning, after the call's own notices.
 * @param mac        ADR-0120: true on a Mac (the Private line says what Private does there).
 * @returns The message, or null for none (ADR-0118: then there is no warning line).
 * Called from: CompactView.tsx; tests
 */
export function statusMessage(
  state: CompactState | null,
  privateOff: boolean,
  privateOffInCall = false,
  mac = false,
): StatusMessage | null {
  if (!state || state.ended) return null;
  if (state.hygiene === 'paused') {
    return {
      key: 'paused',
      text: 'Listening is paused: no one has spoken for 30 minutes.',
      tone: 'warning',
      action: { kind: 'command', command: { type: 'resume' }, label: 'Resume' },
    };
  }
  if (state.hygiene === 'ask') {
    return {
      key: 'still-here',
      text: 'Still in a call?',
      tone: 'warning',
      action: { kind: 'command', command: { type: 'still-here' }, label: 'Yes' },
    };
  }
  if (state.dictating) {
    return {
      key: 'listening',
      // ADR-0101: in a browser, also where the shortcut works.
      text: state.voiceShortcutHint
        ? `${LISTENING_TEXT} ${state.voiceShortcutHint}`
        : LISTENING_TEXT,
      tone: 'listening',
      action: { kind: 'command', command: { type: 'voice-cancel' }, label: 'Cancel' },
    };
  }
  const notice = state.callNotice;
  if (notice?.kind === 'them-silent' || notice?.kind === 'mic-silent') {
    const them = notice.kind === 'them-silent';
    return {
      key: notice.kind,
      text: SILENT_TEXT[them ? 'them' : 'you'],
      tone: 'alert',
      ...(notice.detail ? { detail: notice.detail } : {}),
      action: {
        kind: 'list',
        list: notice.action?.list ?? (them ? 'audio' : 'mic'),
        label: notice.action?.label ?? (them ? 'Choose audio source' : 'Choose microphone'),
      },
    };
  }
  if (state.answerKeyTaken) {
    return {
      key: 'answer-key',
      text: `${state.answerKeyTaken} is used by another app`,
      tone: 'alert',
      action: { kind: 'command', command: { type: 'hotkey-settings' }, label: 'Hotkeys' },
    };
  }
  if (privateOff) {
    return {
      key: 'private-off',
      text: PRIVATE_OFF_TEXT,
      tone: 'alert',
      action: { kind: 'private', label: 'Turn on' },
    };
  }
  // ADR-0095: Voice mode is on: always visible after the alerts above (a silent microphone or an Answer key
  // held elsewhere matter more), with the button that turns it off.
  if (state.voiceMode === 'listening' || state.voiceMode === 'paused') {
    return {
      key: 'voice-mode',
      text: state.voiceMode === 'listening' ? VOICE_MODE_TEXT : VOICE_PAUSED_TEXT,
      tone: state.voiceMode === 'listening' ? 'listening' : 'muted',
      detail:
        'Each pause of about 1.5 s sends what you said to Paramount AI as a question. It pauses while the other person speaks, and for 2 s after. Esc turns it off.',
      action: { kind: 'command', command: { type: 'voice-mode', on: false }, label: 'Turn off' },
    };
  }
  if (notice) {
    return {
      key: 'call-notice',
      text: notice.text,
      tone: 'muted',
      ...(notice.detail ? { detail: notice.detail } : {}),
    };
  }
  if (state.dictationNotice) {
    return { key: 'voice-notice', text: state.dictationNotice, tone: 'warning' };
  }
  if (state.notice) return { key: 'notice', text: state.notice, tone: 'warning' };
  if (privateOffInCall) {
    return {
      key: 'private-off-call',
      text: mac ? PRIVATE_OFF_CALL_TEXT_MAC : PRIVATE_OFF_CALL_TEXT,
      tone: 'warning',
      action: { kind: 'private', label: 'Turn on' },
    };
  }
  // ADR-0093: one click renames the other person for this call; never applied by itself.
  if (state.nameOffer) {
    return {
      key: 'rename-them',
      text: `Rename ${state.themName || 'Them'} to ${state.nameOffer}?`,
      tone: 'offer',
      action: {
        kind: 'command',
        command: { type: 'rename-them', name: state.nameOffer },
        label: 'Rename',
      },
      dismiss: { command: { type: 'dismiss-name' }, label: 'Not now' },
    };
  }
  if (state.headphonesHint) {
    return {
      key: 'headphones',
      text: HEADPHONES_TEXT,
      tone: 'muted',
      action: { kind: 'command', command: { type: 'headphones-seen' }, label: 'OK' },
    };
  }
  return null;
}
