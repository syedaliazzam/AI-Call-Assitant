/**
 * File: apps/web/src/features/live/overlay/ChatInput.tsx
 * Purpose: The Chat input inside bar 1 (v1.1.0, ADR-0041; Ctrl+Shift+Space): type or speak a question,
 *          choose Auto, For the call or Ask Kite, and Enter sends it; the reply appears in the answer
 *          panel. Escape closes it. Three plain buttons rather than a dropdown: a browser's own list is
 *          a separate window that screen-share protection may not reach (ADR-0042).
 * Used by: src/features/live/overlay/ControlBar.tsx
 * Depends on: @kite/shared (TargetChoice), src/core/live/liveChannel.ts,
 *             src/features/live/ChatBox.tsx (the choices), ./parts.tsx, src/ui/icons.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0030, ADR-0038, ADR-0041
 *
 * The typed text only goes to the live page; it is never logged.
 */
'use client';

import { useState } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import { TARGET_OPTIONS } from '@/features/live/ChatBox';
import { CloseIcon, MicIcon } from '@/ui/icons';
import { ICON_BUTTON } from './parts';

/** Props for ChatInput. */
export interface ChatInputProps {
  /** What the live page shows. */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Closes the input. */
  onClose: () => void;
}

/**
 * The input.
 *
 * @param props See ChatInputProps.
 * @returns The input and its switch.
 * Rendered by: ControlBar.tsx
 */
export function ChatInput({ state, onCommand, onClose }: ChatInputProps) {
  const [question, setQuestion] = useState('');
  const target = state?.chatTarget ?? 'auto';
  const listening = state?.dictating ?? false;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 [-webkit-app-region:no-drag]">
      <div
        role="radiogroup"
        aria-label="Who the answer is for"
        className="hidden shrink-0 rounded-control bg-ui-overlay-button p-0.5 @min-[620px]:inline-flex"
      >
        {TARGET_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={target === option.value}
            onClick={() => onCommand({ type: 'chat-target', target: option.value })}
            className={`rounded-control px-1.5 py-1 text-[12px] font-medium focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] ${target === option.value ? 'bg-ui-primary text-ui-on-primary' : 'text-ui-text hover:bg-ui-overlay-button-hover'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <input
        autoFocus
        aria-label="Type a question"
        className="h-8 min-w-0 flex-1 rounded-control border border-ui-border bg-ui-input px-2 text-[14px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
        placeholder={listening ? 'Listening… speak your question' : 'Type a question, then Enter'}
        value={question}
        maxLength={2_000}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && question.trim()) {
            event.preventDefault();
            onCommand({ type: 'chat', question: question.trim() });
            setQuestion('');
            onClose();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setQuestion('');
            onClose();
          }
        }}
      />
      {state?.dictationSupported && (
        // Speak the question (ADR-0038): it becomes text only, sent on a pause.
        <button
          type="button"
          className={`${ICON_BUTTON} ${listening ? 'animate-pulse text-ui-danger' : ''}`}
          aria-label={listening ? 'Stop listening' : 'Speak a question'}
          aria-pressed={listening}
          onClick={() => onCommand({ type: 'dictate', on: !listening })}
        >
          <MicIcon />
        </button>
      )}
      <button type="button" className={ICON_BUTTON} aria-label="Close chat" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}
