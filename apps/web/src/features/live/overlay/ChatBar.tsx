/**
 * File: apps/web/src/features/live/overlay/ChatBar.tsx
 * Purpose: The chat bar under bar 1 (spec S14; Ctrl+Shift+Space). Two looks:
 *          - 'reference' (ADR-0055, accounts with account sync): as in the reference app, a dark input
 *            "Enter a message…", the screenshot button [Ctrl Alt ↵] (sends what is typed with a
 *            screenshot), Send [↵] (muted until there is text) and ✕. Voice stays on Ctrl+Shift+Space
 *            pressed twice (ADR-0038): while it listens a red microphone shows, which stops it. Who the
 *            answer is for keeps the live page's choice (Auto, or Ask AI after Ctrl+Alt+K).
 *          - 'classic' (everyone else, unchanged since v1.2.0): also Auto / For the call / Ask AI as three
 *            plain buttons (a browser's own list is a separate window that screen-share protection may
 *            not reach, ADR-0042) and the microphone button.
 *          The reply appears in the answer panel. Escape closes the bar and stops any dictation without
 *          sending.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: lucide-react, @kite/shared (hotkeys), src/core/live/liveChannel.ts,
 *             src/features/live/ChatBox.tsx (the choices), ./parts.tsx, src/ui/icons.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S14); ADR-0030, ADR-0038, ADR-0041, ADR-0055
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
  /** 'reference' (ADR-0055, accounts with account sync) or 'classic' (default). */
  look?: 'reference' | 'classic';
}

/** What the overlay can ask of the open bar. */
export interface ChatBarHandle {
  /**
   * The shortcut (Ctrl+Alt+Enter): sends what is typed with a screenshot. 1.5.1 (ADR-0069): nothing when
   * nothing is typed (the bar's button can still take a screenshot alone).
   */
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
  { state, onCommand, onClose, mac, look = 'classic' },
  ref,
) {
  const [question, setQuestion] = useState('');
  const target = state?.chatTarget ?? 'auto';
  const listening = state?.dictating ?? false;
  const typed = question.trim();
  const reference = look === 'reference';

  /** Sends what is typed, and closes the bar. */
  const send = () => {
    if (!typed) return;
    onCommand({ type: 'chat', question: typed });
    setQuestion('');
    onClose();
  };

  /**
   * Sends what is typed with a screenshot (the button: alone when nothing is typed), and closes the bar.
   */
  const screenshotSend = () => {
    onCommand(typed ? { type: 'chat-screenshot', question: typed } : { type: 'screenshot' });
    setQuestion('');
    onClose();
  };
  // 1.5.1 (ADR-0069): the shortcut (Ctrl+Alt+Enter, easy to press by mistake next to Ctrl+Enter) sends only
  // with something typed; an empty bar's shortcut used to take a bare screenshot answer, which a call on
  // 11 Nov 2026 got by mistake. The button, a deliberate click, still can.
  useImperativeHandle(ref, () => ({
    screenshotSend: () => {
      if (typed) screenshotSend();
    },
  }));

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
      className={`k-anim-menu flex h-11 min-w-0 items-center px-1.5 [-webkit-app-region:no-drag] ${reference ? 'gap-1.5' : 'gap-1'}`}
    >
      {!reference && (
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
      )}
      <input
        autoFocus
        aria-label="Type a question"
        className={
          reference
            ? // The reference's dark field: as tall as the pills, rounded like them, no border until focused.
              'h-8 min-w-0 flex-1 rounded-[10px] border border-transparent bg-ui-field px-3 text-[15px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11'
            : 'h-8 min-w-0 flex-1 rounded-control border border-ui-border bg-ui-input px-2 text-[14px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11'
        }
        placeholder={
          listening
            ? 'Listening… speak your question'
            : reference
              ? 'Enter a message…'
              : 'Type a message…'
        }
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
      {reference
        ? listening && (
            // Voice (ADR-0038; Ctrl+Shift+Space twice): shown only while it listens, so it can be stopped.
            <button
              type="button"
              className={`${ICON_BUTTON} animate-pulse text-ui-danger`}
              aria-label="Stop listening"
              aria-pressed
              onClick={() => onCommand({ type: 'dictate', on: false })}
            >
              <MicIcon />
            </button>
          )
        : state?.dictationSupported && (
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
