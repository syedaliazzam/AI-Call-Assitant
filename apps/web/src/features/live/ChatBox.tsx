/**
 * File: apps/web/src/features/live/ChatBox.tsx
 * Purpose: The typed-question box of the live view: Enter sends the question (mode 'chat'),
 *          Escape clears it, and "Ask about my screen" sends it with a screenshot (Day 5).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); day-04-answers.md
 *               Stage 6
 *
 * The typed text is only sent to /api/answer; it is never logged.
 */
'use client';

import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/ui/Button';

/** Props for ChatBox. */
export interface ChatBoxProps {
  /** Sends a typed question. */
  onSend: (question: string) => void;
  /** Sends the typed question about a screenshot of the screen (Day 5). */
  onAskScreen: (question: string) => void;
}

/**
 * The typed-question box.
 *
 * @param props See ChatBoxProps.
 * @returns The box.
 * Rendered by: LiveAnswers.tsx (while Chat is open)
 */
export function ChatBox({ onSend, onAskScreen }: ChatBoxProps) {
  const [text, setText] = useState('');

  /** Sends the question, unless it is empty, and clears the box. */
  const send = () => {
    const question = text.trim();
    if (!question) return;
    onSend(question);
    setText('');
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
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setText('');
    }
  };

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <input
        aria-label="Type a question"
        // The box opens when the user presses Chat, so it should take the typing at once.
        autoFocus
        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        placeholder="Type a question for Kite, then press Enter"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={2_000}
      />
      <Button type="submit" variant="secondary" disabled={!text.trim()}>
        Send
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={!text.trim()}
        title="Ask this about a screenshot of your screen"
        onClick={() => {
          const question = text.trim();
          if (!question) return;
          onAskScreen(question);
          setText('');
        }}
      >
        Ask about my screen
      </Button>
    </form>
  );
}
