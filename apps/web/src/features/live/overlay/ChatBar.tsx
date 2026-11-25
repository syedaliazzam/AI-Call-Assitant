/**
 * File: apps/web/src/features/live/overlay/ChatBar.tsx
 * Purpose: ADR-0122: the overlay's chat bar, under bar 1 (above it on the bottom row), like ParakeetAI's: a
 *          text box "Enter a message…", Send (Enter) and × to close. Bar 1's Chat button and Ctrl+Alt+K (⌘⌥K on
 *          a Mac) during a call open it. It has no Screenshot button: the screenshot shortcuts (Ctrl+Shift+Enter,
 *          Ctrl+Alt+Enter) work as before, wherever the keyboard is. The bar never takes the keyboard by itself
 *          (no autofocus): typing stays in the meeting until the user clicks into the box, and Send gives the
 *          keyboard back. The question goes to the live page as a typed question ('chat'), for whoever the
 *          live page's chat switch says (Auto unless Ctrl+Alt+K set it otherwise); the reply shows in the answer
 *          panel with "Your question:". ADR-0082 had removed the earlier chat bar (spec S14, ADR-0055).
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/core/live/liveChannel.ts, ./parts.tsx, src/ui/icons.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Overlay, compact view); ADR-0122
 *
 * The typed text only goes to the live page; it is never logged.
 */
'use client';

import { useRef, useState } from 'react';
import type { CompactCommand } from '@/core/live/liveChannel';
import { CloseIcon } from '@/ui/icons';
import { ICON_BUTTON, KeyChip, PILL } from './parts';

/** The most a typed question may hold (the live channel refuses longer ones). */
export const CHAT_MAX_CHARS = 2_000;

/** Props for ChatBar. */
export interface ChatBarProps {
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Closes the bar (× or Escape in the box). */
  onClose: () => void;
  /**
   * Gives the keyboard back to the app that had it (the meeting) after a question is sent. Absent where the
   * window cannot (a browser's picture-in-picture window keeps it).
   */
  onReleaseFocus?: (() => void) | undefined;
  /** True once the call has ended (nothing can be sent). */
  disabled: boolean;
}

/**
 * The chat bar.
 *
 * @param props See ChatBarProps.
 * @returns The bar.
 * Rendered by: CompactView.tsx
 */
export function ChatBar({ onCommand, onClose, onReleaseFocus, disabled }: ChatBarProps) {
  const [question, setQuestion] = useState('');
  const box = useRef<HTMLInputElement>(null);
  const typed = question.trim();

  /**
   * Sends what is typed. The bar stays open for the next question (× closes it); the box lets go of the
   * keyboard, which goes back to the meeting.
   */
  const send = () => {
    if (!typed || disabled) return;
    onCommand({ type: 'chat', question: typed });
    setQuestion('');
    box.current?.blur();
    onReleaseFocus?.();
  };

  return (
    <div
      role="group"
      aria-label="Chat"
      data-chat-bar=""
      className="flex h-11 min-w-0 items-center gap-1.5 px-1.5 [-webkit-app-region:no-drag]"
    >
      <input
        ref={box}
        // ADR-0122: never autofocus. The meeting keeps the keyboard until the user clicks here.
        aria-label="Type a question"
        className="h-8 min-w-0 flex-1 rounded-[10px] border border-transparent bg-ui-field px-3 text-[15px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
        placeholder="Enter a message…"
        value={question}
        maxLength={CHAT_MAX_CHARS}
        disabled={disabled}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          // With Alt it is the screenshot and voice shortcut, which the window's own listener handles.
          if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            send();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            // Escape must not also reach the menus' or the voice question's listener.
            event.stopPropagation();
            setQuestion('');
            onClose();
          }
        }}
      />
      <button
        type="button"
        className={PILL}
        disabled={!typed || disabled}
        // ADR-0122: a click here gives the keyboard back to the meeting (CompactView's release effect).
        data-releases-focus=""
        onClick={send}
      >
        Send <KeyChip hotkey="chat-send" visibleAt="@min-[480px]/overlay:inline-flex" />
      </button>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label="Close chat"
        data-tip="Close chat"
        data-releases-focus=""
        onClick={() => {
          setQuestion('');
          onClose();
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
