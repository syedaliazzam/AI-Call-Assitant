/**
 * File: apps/web/src/features/live/LiveAnswers.tsx
 * Purpose: The answer part of the live view: the top bar (Answer · Chat · Screenshot · Clear ·
 *          End), the chat box, and the answer panel, plus the hotkeys (through the platform
 *          adapter: in-page shortcuts, and the desktop app's global shortcuts from Stage 8).
 * Used by: src/features/live/LivePage.tsx (live view);
 *          tests/integration/harness/answers.tsx (the answer harness test)
 * Depends on: src/features/live (useLiveAnswers, TopBar, ChatBox, AnswerPanel), src/platform
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session), §7.3 (hotkeys);
 *               day-04-answers.md Stage 6
 */
'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Session, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';
import { getPlatform } from '@/platform';
import { AnswerPanel } from './AnswerPanel';
import { ChatBox } from './ChatBox';
import { TopBar } from './TopBar';
import { useLiveAnswers, type AnswerEntry } from './useLiveAnswers';

/** Props for LiveAnswers. */
export interface LiveAnswersProps {
  /** The session. */
  session: Session;
  /** Its documents. */
  documents: readonly StoredDocument[];
  /** The live transcript. */
  transcript: Transcript;
  /** When this call connected (Unix ms). */
  callStartedAt: number;
  /** True while End waits for the last line. */
  ending: boolean;
  /** Ends the call. */
  onEnd: () => void;
  /** Called when an answer finishes (Stage 7 saves it). */
  onFinished?: (entry: AnswerEntry) => void;
  /** Puts text on the clipboard (tests replace it). */
  copy?: (text: string) => Promise<void>;
}

/**
 * No-op subscription: the OS never changes while the page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Whether the shortcuts use ⌘ (macOS), for the labels. Server render: not a Mac.
 *
 * @returns True on macOS.
 */
const isMac = () => getPlatform().hotkeyModifier() === '⌘';

/**
 * The answer part of the live view.
 *
 * @param props See LiveAnswersProps.
 * @returns The top bar, chat box and answer panel.
 * Rendered by: LivePage.tsx; the answer harness page
 */
export function LiveAnswers(props: LiveAnswersProps) {
  const answers = useLiveAnswers({
    session: props.session,
    documents: props.documents,
    transcript: props.transcript,
    callStartedAt: props.callStartedAt,
    onFinished: props.onFinished,
  });
  const [chatOpen, setChatOpen] = useState(false);
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const entry = answers.index >= 0 ? (answers.entries[answers.index] ?? null) : null;
  const answering = answers.entries.some((candidate) => candidate.status === 'streaming');

  // The hotkeys call the latest actions (a ref, so the listener is added only once).
  const actions = useRef(answers);
  useEffect(() => {
    actions.current = answers;
  });
  useEffect(
    () =>
      getPlatform().onHotkey((action) => {
        if (action === 'answer') actions.current.answer();
        else if (action === 'clear') actions.current.clear();
        else if (action === 'prev') actions.current.prev();
        else if (action === 'next') actions.current.next();
        // 'screenshot' arrives on Day 5.
      }),
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <TopBar
        mac={mac}
        chatOpen={chatOpen}
        answering={answering}
        ending={props.ending}
        onAnswer={answers.answer}
        onToggleChat={() => setChatOpen((open) => !open)}
        onClear={answers.clear}
        onEnd={props.onEnd}
      />
      {chatOpen && <ChatBox onSend={answers.chat} />}
      <AnswerPanel
        entry={entry}
        index={answers.index}
        total={answers.entries.length}
        mac={mac}
        notice={answers.notice}
        onPrev={answers.prev}
        onNext={answers.next}
        onCancel={answers.clear}
        copy={props.copy}
      />
    </div>
  );
}
