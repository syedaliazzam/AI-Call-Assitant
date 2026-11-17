/**
 * File: apps/web/src/features/meetings/ConversationTab.tsx
 * Purpose: The Meetings library's Conversation tab (ADR-0096): the call as a timeline: the other person's
 *          turns (their questions), Paramount AI's answer cards (the answer line and its bullets, each card
 *          collapsible) right after the turn they answered, and what the user said, each with its speaker's
 *          name and its mm:ss in the call. "Questions & answers only" keeps each answer with the question
 *          before it. Built from the synced lines and answers, so it shows in any browser.
 * Used by: CallPane.tsx
 * Depends on: lucide-react, src/core/review/conversation.ts (conversationItems, conversationEntries,
 *             NO_OTHER_SIDE_TEXT), src/core/answer/format.ts (splitAnswer, cardQuestion),
 *             src/core/meetings/library.ts (questionsAndAnswers), src/core/transcript (turns, display)
 * Architecture: docs/decisions/ADR-0096-meetings-library.md; v1.3.2 answer placement (conversation.ts)
 *
 * Call words are shown on screen only; nothing is logged.
 */
'use client';

import { ChevronDown, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cardQuestion, splitAnswer } from '@/core/answer/format';
import { questionsAndAnswers } from '@/core/meetings/library';
import type { CallView } from '@/core/review/calls';
import {
  NO_OTHER_SIDE_TEXT,
  conversationEntries,
  conversationItems,
} from '@/core/review/conversation';
import type { StoredAnswer } from '@/core/storage/types';
import type { DisplayTerm } from '@/core/transcript/display';
import { formatElapsed, type SpeakerNames } from '@/core/transcript/turns';

/** The small tag beside "Paramount AI" for an answer that was not to something said ('' for none). */
const MODE_TAGS: Readonly<Record<StoredAnswer['mode'], string>> = {
  answer: '',
  chat: 'Typed question',
  screenshot: 'Screenshot',
};

/** Props for ConversationTab. */
export interface ConversationTabProps {
  /** The call. */
  call: CallView;
  /** The names on each side's turns. */
  names: SpeakerNames;
  /** The session's own spellings (displayTerms()). */
  terms: readonly DisplayTerm[];
}

/**
 * One of Paramount AI's answers, collapsible.
 *
 * @param props.answer  The answer.
 * @param props.elapsed Its time in the call, ms.
 * @param props.terms   The session's own spellings, for a question with no cleaned form.
 * @returns The card.
 * Rendered by: ConversationTab
 */
function AnswerCard({
  answer,
  elapsed,
  terms,
}: {
  /** The answer. */
  answer: StoredAnswer;
  /** Its time in the call, ms. */
  elapsed: number;
  /** The session's own spellings. */
  terms: readonly DisplayTerm[];
}) {
  const [open, setOpen] = useState(true);
  const parts = splitAnswer(answer.text, true);
  const question = cardQuestion(answer.question, answer.cleanQuestion, terms, '');
  const hasMore =
    parts.bullets.length > 0 || parts.code.length > 0 || Boolean(parts.say || parts.tip);
  const bodyId = `answer-${answer.id}`;
  return (
    <article
      aria-label="Paramount AI answer"
      className="rounded-card border border-ui-border bg-ui-surface shadow-card"
    >
      <header className="flex items-center gap-2 px-4 pt-3">
        <Sparkles aria-hidden="true" size={16} strokeWidth={1.75} className="text-ui-accent" />
        <span className="text-[13px] font-semibold text-ui-heading">Paramount AI</span>
        {MODE_TAGS[answer.mode] && (
          <span className="text-[12px] text-ui-muted">{MODE_TAGS[answer.mode]}</span>
        )}
        <span className="ml-auto text-[12px] tabular-nums text-ui-muted">
          {formatElapsed(elapsed)}
        </span>
      </header>
      <div className="px-4 pb-3 pt-1">
        {question && <p className="text-[13px] text-ui-muted">{question}</p>}
        <p className="mt-1 text-[15px] font-semibold text-ui-heading">
          {parts.headline || answer.text.trim() || 'No answer text'}
        </p>
        {hasMore && (
          <>
            {open && (
              <div id={bodyId} className="mt-2 flex flex-col gap-2 text-[13px] text-ui-text">
                {parts.bullets.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5">
                    {parts.bullets.map((bullet, index) => (
                      <li key={index}>{bullet}</li>
                    ))}
                  </ul>
                )}
                {parts.code.map((code, index) => (
                  <pre
                    key={index}
                    className="overflow-x-auto rounded-control bg-ui-subtle p-3 text-[12px] text-ui-text"
                  >
                    <code>{code.text}</code>
                  </pre>
                ))}
                {parts.say && (
                  <p>
                    <span className="font-semibold">Say:</span> {parts.say}
                  </p>
                )}
                {parts.tip && (
                  <p>
                    <span className="font-semibold">Tip:</span> {parts.tip}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen((value) => !value)}
              className="mt-2 inline-flex items-center gap-1 rounded-control text-[12px] font-medium text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
            >
              <ChevronDown
                aria-hidden="true"
                size={14}
                strokeWidth={1.75}
                className={open ? 'rotate-180' : ''}
              />
              {open ? 'Hide details' : 'Show details'}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/**
 * The Conversation tab.
 *
 * @param props See ConversationTabProps.
 * @returns The tab's content.
 * Rendered by: CallPane.tsx
 */
export function ConversationTab({ call, names, terms }: ConversationTabProps) {
  const [onlyQuestions, setOnlyQuestions] = useState(false);
  const entries = useMemo(
    () => conversationEntries(conversationItems(call.lines, call.answers), terms),
    [call.lines, call.answers, terms],
  );
  const shown = onlyQuestions ? questionsAndAnswers(entries) : entries;

  if (entries.length === 0) {
    return (
      <p className="rounded-card border border-ui-border bg-ui-surface p-6 text-center text-[13px] text-ui-muted">
        Nothing was saved from this call. The transcript is kept when &ldquo;Save transcript&rdquo;
        is on for the session, and answers are kept when Paramount AI answers.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex w-fit items-center gap-2 text-[13px] text-ui-text pointer-coarse:min-h-11">
        <input
          type="checkbox"
          checked={onlyQuestions}
          onChange={(event) => setOnlyQuestions(event.target.checked)}
          className="size-4 accent-[var(--ui-accent-fill)]"
        />
        Questions &amp; answers only
      </label>
      {shown.length === 0 ? (
        <p role="status" className="text-[13px] text-ui-muted">
          Paramount AI gave no answers in this call.
        </p>
      ) : (
        <ol aria-label="Conversation" className="flex flex-col gap-3">
          {shown.map((entry, index) => {
            if (entry.kind === 'call') {
              return entry.noOtherSide ? (
                <li key={`call-${index}`} className="text-[13px] text-ui-muted">
                  {NO_OTHER_SIDE_TEXT}
                </li>
              ) : null;
            }
            if (entry.kind === 'answer') {
              return (
                <li key={entry.answer.id}>
                  <AnswerCard answer={entry.answer} elapsed={entry.elapsed} terms={terms} />
                </li>
              );
            }
            const mine = entry.turn.speaker === 'you';
            return (
              <li key={entry.turn.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={[
                    'max-w-[85%] rounded-card px-4 py-2.5',
                    mine ? 'border border-ui-border bg-ui-surface' : 'bg-ui-subtle',
                  ].join(' ')}
                >
                  <p className="flex items-baseline gap-2 text-[12px]">
                    <span className={`font-semibold ${mine ? 'text-ui-you' : 'text-ui-heading'}`}>
                      {mine ? names.you : names.them}
                    </span>
                    {/* Body colour, not muted: muted text is under 4.5:1 on the subtle fill. */}
                    <span className="tabular-nums text-ui-text">
                      {formatElapsed(entry.elapsed)}
                    </span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[14px] text-ui-text">
                    {entry.turn.finalText}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
