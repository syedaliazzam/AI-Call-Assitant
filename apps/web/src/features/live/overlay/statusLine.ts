/**
 * File: apps/web/src/features/live/overlay/statusLine.ts
 * Purpose: What the overlay's one status bar says (ADR-0082). The warning bar and the transcript bar
 *          became one bar: its line shows the most important message there is, with its button, or else
 *          the live words. In order: listening paused, "Still in a call?", a voice question listening, a
 *          channel that hears nothing (with its device list), another app holding the Answer key, a screen
 *          recording with Private off, the other call notices (catching up, cloud transcription), why the
 *          last voice question sent nothing, the answers' notice, and the one-time headphones hint.
 * Used by: src/features/live/overlay/StatusBar.tsx (and through it TranscriptPanel.tsx)
 * Depends on: src/core/live/liveChannel.ts (types), src/features/live/PrivateOffWarning.tsx (words)
 * Architecture: ADR-0082 (one status bar); ADR-0069 (call notices), ADR-0070 (Private off), ADR-0076 (G4)
 *
 * Pure: no React, no text from the call (only the app's own messages).
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
    | 'mic-silent'
    | 'them-silent'
    | 'answer-key'
    | 'private-off'
    | 'call-notice'
    | 'voice-notice'
    | 'notice'
    | 'headphones';
  /** The words (short: one line of the bar). */
  text: string;
  /** How it looks: an alert (red), a warning (amber), the listening state (red), or quiet (muted). */
  tone: 'alert' | 'warning' | 'listening' | 'muted';
  /** One more sentence, shown as the line's tooltip, or absent. */
  detail?: string;
  /** Its button, if any. */
  action?: StatusAction;
}

/** ADR-0082: what the status line says while a voice question listens. */
export const LISTENING_TEXT = 'Listening… (Esc cancels)';

/** ADR-0082: the short words for a channel that hears nothing (the call window keeps the long ones). */
export const SILENT_TEXT = {
  them: "Can't hear the other side",
  you: "Can't hear your microphone",
} as const;

/** ADR-0082: the headphones hint, short. */
export const HEADPHONES_TEXT = 'Speakers echoing — use headphones';

/**
 * The message the status line shows now, most important first.
 *
 * @param state      What the live page shows (null until it answers).
 * @param privateOff True while a screen recording runs with Private off (usePrivateOffWhileRecording()).
 * @returns The message, or null for none (the line then shows the live words).
 * Called from: StatusBar.tsx; tests
 */
export function statusMessage(
  state: CompactState | null,
  privateOff: boolean,
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
      text: LISTENING_TEXT,
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
