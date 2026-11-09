/**
 * File: apps/web/src/features/live/overlay/ChatBar.tsx
 * Purpose: The chat bar under bar 1 (spec S14; Ctrl+Shift+Space), as in the reference (ADR-0055): a dark
 *          input "Enter a message…", the screenshot button [Ctrl Alt ↵] (sends what is typed with a
 *          screenshot), Send [↵] (muted until there is text) and ✕. The reply appears in the answer panel.
 *          Voice stays on Ctrl+Shift+Space pressed twice (ADR-0038): while it listens, a red microphone
 *          shows, which stops it. Escape closes the bar and stops any dictation without sending. Who the
 *          answer is for keeps the live page's choice (Auto, or Ask AI after Ctrl+Alt+K); the full call
 *          window's message box still has the switch.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: lucide-react, @kite/shared (hotkeys), src/core/live/liveChannel.ts, ./parts.tsx,
 *             src/ui/icons.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S14); ADR-0030, ADR-0038, ADR-0041
 *
 * The typed text only goes to the live page; it is never logged.
 */
'use client';

import { hotkeyLabel, SCREENSHOT_SEND_HOTKEY } from '@kite/shared';
import { Scan } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
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
      className="flex h-11 min-w-0 items-center gap-1.5 px-1.5 [-webkit-app-region:no-drag]"
    >
      <input
        autoFocus
        aria-label="Type a question"
        // The reference's dark field: as tall as the pills, rounded like them, no border until focused.
        className="h-8 min-w-0 flex-1 rounded-[10px] border border-transparent bg-ui-field px-3 text-[15px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
        placeholder={listening ? 'Listening… speak your question' : 'Enter a message…'}
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
      {listening && (
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
