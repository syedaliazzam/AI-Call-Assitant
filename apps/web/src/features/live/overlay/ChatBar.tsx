/**
 * File: apps/web/src/features/live/overlay/ChatBar.tsx
 * Purpose: The chat bar under bar 1 (spec S14; Ctrl+Shift+Space): type or speak a message, choose Auto,
 *          For the call or Ask AI, send it with a screenshot of the screen (Ctrl+Alt+Enter) or on its own
 *          (Enter); the reply appears in the answer panel. Escape closes it, and stops any dictation
 *          without sending. Three plain buttons rather than a dropdown: a browser's own list is a
 *          separate window that screen-share protection may not reach (ADR-0042).
 * Used by: src/features/live/CompactView.tsx
 * Depends on: lucide-react, @kite/shared (hotkeys), src/core/live/liveChannel.ts,
 *             src/features/live/ChatBox.tsx (the choices), ./parts.tsx, src/ui/icons.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S14); ADR-0030, ADR-0038, ADR-0041
 *
 * The typed text only goes to the live page; it is never logged.
 */
'use client';

import { hotkeyLabel, SCREENSHOT_SEND_HOTKEY } from '@kite/shared';
import { Scan } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import { TARGET_OPTIONS } from '@/features/live/ChatBox';
import { CloseIcon, MicIcon } from '@/ui/icons';
import { ICON_BUTTON, KeyChip, PILL } from './parts';

/** Props for ChatBar. */
export interface ChatBarProps {
  /** What the live page shows. */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Closes the bar. */
  onClose: () => void;
  /** True on macOS (for the shortcut's spoken name). */
  mac: boolean;
}

/** What the overlay can ask of the open bar. */
export interface ChatBarHandle {
  /** Sends what is typed with a screenshot, or just takes a screenshot when nothing is typed. */
  screenshotSend: () => void;
}

/**
 * The bar.
 *
 * @param props See ChatBarProps.
 * @param ref   Its handle: the shortcut reaches the bar through it, wherever the keyboard is.
 * @returns The bar.
 * Rendered by: CompactView.tsx
 */
export const ChatBar = forwardRef<ChatBarHandle, ChatBarProps>(function ChatBar(
  { state, onCommand, onClose, mac },
  ref,
) {
  const [question, setQuestion] = useState('');
  const target = state?.chatTarget ?? 'auto';
  const listening = state?.dictating ?? false;
  const typed = question.trim();

  /** Sends what is typed, and closes the bar. */
  const send = () => {
    if (!typed) return;
    onCommand({ type: 'chat', question: typed });
    setQuestion('');
    onClose();
  };

  /** Sends what is typed with a screenshot, and closes the bar. */
  const screenshotSend = () => {
    onCommand(typed ? { type: 'chat-screenshot', question: typed } : { type: 'screenshot' });
    setQuestion('');
    onClose();
  };
  useImperativeHandle(ref, () => ({ screenshotSend }));

  // Closing the bar, whichever way, cancels a dictation: nothing is sent after it has gone.
  const latest = useRef({ listening, onCommand });
  useEffect(() => {
    latest.current = { listening, onCommand };
  });
  useEffect(
    () => () => {
      if (latest.current.listening) latest.current.onCommand({ type: 'dictate', on: false });
    },
    [],
  );

  return (
    <div
      role="group"
      aria-label="Chat"
      className="flex h-11 min-w-0 items-center gap-1 px-1.5 [-webkit-app-region:no-drag]"
    >
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
        placeholder={listening ? 'Listening… speak your question' : 'Type a message…'}
        value={question}
        maxLength={2_000}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          // With Alt it is the screenshot shortcut, which the window's own listener handles.
          if (event.key === 'Enter' && !event.altKey) {
            event.preventDefault();
            send();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            // Listening stops when the bar goes (above); Escape must not reach the menus' listener.
            event.stopPropagation();
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
      <button
        type="button"
        className={PILL}
        aria-label="Send with a screenshot"
        aria-keyshortcuts={hotkeyLabel(SCREENSHOT_SEND_HOTKEY, mac)}
        disabled={state?.capturing ?? false}
        onClick={screenshotSend}
      >
        <Scan aria-hidden="true" size={16} />
        <KeyChip hotkey="screenshot-send" visibleAt="@min-[620px]:inline-flex" />
      </button>
      <button type="button" className={PILL} disabled={!typed} onClick={send}>
        Send <KeyChip hotkey="chat-send" visibleAt="@min-[620px]:inline-flex" />
      </button>
      <button type="button" className={ICON_BUTTON} aria-label="Close chat" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
});
