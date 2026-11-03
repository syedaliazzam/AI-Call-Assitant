/**
 * File: apps/web/src/features/live/ChatBox.tsx
 * Purpose: The message box of the live view (v1.0.2, reference layout: always shown, above the
 *          Answer and Screenshot buttons): who the answer is for (Auto, For the call or Ask Kite;
 *          ADR-0030), "Type a manual message…", × to clear it, the microphone to dictate it
 *          (ADR-0038; speech becomes text only), a screenshot attach switch (the message is then
 *          asked about a screenshot of the screen, Day 5), and Send. Enter sends; Escape clears
 *          the text (with none, it goes on to the window: back to the overlay, v1.0.4).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/ui (Button, icons), @kite/shared (TargetChoice)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); day-04-answers.md
 *               Stage 6
 *
 * The typed text is only sent to /api/answer; it is never logged.
 */
'use client';

import type { TargetChoice } from '@kite/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/Button';
import { CloseIcon, MicIcon, MonitorIcon } from '@/ui/icons';

/** The switch's choices, in the order shown. */
export const TARGET_OPTIONS: readonly { value: TargetChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'call', label: 'For the call' },
  { value: 'kite', label: 'Ask Kite' },
];

/** The dictation controls the box shows when speech can be dictated in this call. */
export interface ChatBoxDictation {
  /** True while listening. */
  listening: boolean;
  /** Why the last listen ended without a question (shown in the box), or null. */
  notice?: string | null;
  /** Starts or stops listening. */
  onToggle: () => void;
}

/** Props for ChatBox. */
export interface ChatBoxProps {
  /** Sends a typed question. */
  onSend: (question: string) => void;
  /** Sends the typed question about a screenshot of the screen (Day 5). */
  onAskScreen: (question: string) => void;
  /** Who answers are for. */
  target: TargetChoice;
  /** Changes who answers are for (remembered for this session). */
  onTarget: (target: TargetChoice) => void;
  /** Grows each time the Chat or Ask Kite shortcut is pressed: the box then takes the typing. */
  focusSignal?: number;
  /** The microphone button; absent when dictation is not available. */
  dictation?: ChatBoxDictation;
}

/** The look of the box's small icon buttons. */
const ICON_BUTTON =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ui-muted hover:bg-ui-hover hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11';

/**
 * The microphone while listening (v1.0.3): solid red and pulsing. Its own class list, without the
 * grey text and hover colours above, which would otherwise win over the red.
 */
const MIC_LISTENING =
  'inline-flex h-9 w-9 shrink-0 animate-pulse items-center justify-center rounded-control bg-ui-danger text-white focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11';

/**
 * The message box.
 *
 * @param props See ChatBoxProps.
 * @returns The box.
 * Rendered by: LiveAnswers.tsx
 */
export function ChatBox({
  onSend,
  onAskScreen,
  target,
  onTarget,
  focusSignal = 0,
  dictation,
}: ChatBoxProps) {
  const [text, setText] = useState('');
  // The next message goes with a screenshot of the screen.
  const [attach, setAttach] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Chat or Ask Kite pressed: the box takes the typing (only then; updates never take focus).
  useEffect(() => {
    if (focusSignal > 0) input.current?.focus();
  }, [focusSignal]);

  /** Sends the message, unless it is empty, and clears the box. */
  const send = () => {
    const question = text.trim();
    if (!question) return;
    if (attach) onAskScreen(question);
    else onSend(question);
    setText('');
    setAttach(false);
  };

  /**
   * Enter sends; Escape clears.
   *
   * @param event The key press in the box.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape' && text) {
      event.preventDefault();
      setText('');
    }
  };

  return (
    <form
      aria-label="Message"
      className="flex items-center gap-1 rounded-card border border-ui-border bg-ui-input p-1"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <button
        type="button"
        className={`${ICON_BUTTON} ${attach ? 'bg-ui-hover text-ui-accent' : ''}`}
        aria-label="Attach a screenshot of my screen"
        aria-pressed={attach}
        title={attach ? 'This message will be asked about a screenshot' : 'Attach a screenshot'}
        onClick={() => setAttach((on) => !on)}
      >
        <MonitorIcon />
      </button>
      <select
        aria-label="Who the answer is for"
        title="Auto decides for each question. For the call: words to say. Ask Kite: a private answer on any topic."
        value={target}
        onChange={(event) => onTarget(event.target.value as TargetChoice)}
        className="h-9 shrink-0 border-0 bg-transparent px-1 text-base text-ui-muted hover:text-ui-text focus:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 md:text-[13px]"
      >
        {TARGET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        ref={input}
        aria-label="Type a question"
        className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2 text-base text-ui-text placeholder:text-ui-muted focus:outline-none pointer-coarse:min-h-11 md:text-[15px]"
        placeholder={
          dictation?.listening
            ? 'Listening… speak your question'
            : (dictation?.notice ?? 'Type a manual message…')
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={2_000}
      />
      {text && (
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Clear the message"
          onClick={() => setText('')}
        >
          <CloseIcon />
        </button>
      )}
      {dictation && (
        <button
          type="button"
          // Listening (v1.0.3): solid red with a pulse, so the state is obvious at a glance.
          className={dictation.listening ? MIC_LISTENING : ICON_BUTTON}
          aria-label={dictation.listening ? 'Stop listening' : 'Speak a question'}
          aria-pressed={dictation.listening}
          title="Speak your question; it is sent when you pause (it becomes text only)"
          onClick={dictation.onToggle}
        >
          <MicIcon />
        </button>
      )}
      <Button type="submit" size="sm" disabled={!text.trim()}>
        Send
      </Button>
    </form>
  );
}
