/**
 * File: apps/web/src/features/ask-kite/VoiceControls.tsx
 * Purpose: The Ask Kite page's voice controls (item 8, ADR-0038): the microphone button (press to
 *          talk; the message sends when you pause), "Read replies aloud" with a Stop button while a
 *          reply is read, and "Hands-free" (listen again after each reply). Presentational: the
 *          page owns the microphone, the speaker and the two preferences.
 * Used by: src/features/ask-kite/AskKitePage.tsx
 * Depends on: src/ui/Button.tsx, src/ui/icons.tsx (MicIcon), src/core/voice/micSession.ts (MicState)
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md
 */
'use client';

import type { MicState } from '@/core/voice/micSession';
import { Button } from '@/ui/Button';
import { MicIcon } from '@/ui/icons';

/** Props for MicButton. */
export interface MicButtonProps {
  /** The microphone's state. */
  state: MicState;
  /** True while a reply is arriving (the microphone waits for it). */
  disabled: boolean;
  /** Starts listening. */
  onStart: () => void;
  /** Stops listening without sending. */
  onStop: () => void;
}

/**
 * The microphone button, next to Send.
 *
 * @param props See MicButtonProps.
 * @returns The button.
 * Rendered by: AskKitePage.tsx
 */
export function MicButton({ state, disabled, onStart, onStop }: MicButtonProps) {
  if (state === 'listening') {
    return (
      <Button type="button" variant="secondary" onClick={onStop} aria-pressed="true">
        {/* A dot that pulses while the microphone is open, so it is clear Kite is listening. */}
        <span
          aria-hidden="true"
          className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-ui-danger"
        />
        Listening… (stop)
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onStart}
      disabled={disabled || state === 'loading'}
      title="Talk instead of typing: Kite sends your message when you pause"
    >
      <span aria-hidden="true" className="mr-1.5 inline-flex">
        <MicIcon />
      </span>
      {state === 'loading' ? 'Starting…' : 'Talk'}
    </Button>
  );
}

/** Props for VoiceOptions. */
export interface VoiceOptionsProps {
  /** True when this browser can read text aloud. */
  canSpeak: boolean;
  /** "Read replies aloud". */
  readAloud: boolean;
  /** Turns reading aloud on or off. */
  onReadAloud: (on: boolean) => void;
  /** "Hands-free": listen again after each reply. */
  handsFree: boolean;
  /** Turns hands-free on or off. */
  onHandsFree: (on: boolean) => void;
  /** True while a reply is being read. */
  speaking: boolean;
  /** Stops reading the reply. */
  onStopSpeaking: () => void;
}

/**
 * The two voice switches and the Stop button for reading.
 *
 * @param props See VoiceOptionsProps.
 * @returns The options row.
 * Rendered by: AskKitePage.tsx
 */
export function VoiceOptions(props: VoiceOptionsProps) {
  return (
    <div
      role="group"
      aria-label="Voice"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ui-text"
    >
      {props.canSpeak && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.readAloud}
            onChange={(event) => props.onReadAloud(event.target.checked)}
          />
          Read replies aloud
        </label>
      )}
      <label className="flex items-center gap-2" title="After each reply, Kite listens again">
        <input
          type="checkbox"
          checked={props.handsFree}
          onChange={(event) => props.onHandsFree(event.target.checked)}
        />
        Hands-free
      </label>
      {props.speaking && (
        <Button type="button" size="sm" variant="ghost" onClick={props.onStopSpeaking}>
          Stop reading
        </Button>
      )}
    </div>
  );
}
