/**
 * File: apps/web/src/features/review/ConversationSection.tsx
 * Purpose: The Transcript section of the session window, with two tabs (v1.1.0). Conversation (v1.3.2,
 *          like an Otter export): each turn as "<Speaker name>  <mm:ss>" with its words under it, each
 *          answer right after the turn it answered as a collapsible "Paramount AI answered  <mm:ss>" with
 *          its Question and Answer, and a divider between calls. "You" shows the account's display name;
 *          the other person's name is renamable here (click it), stored on the session and synced. Answers: every answer as a card, with its time, thumbs and "Report this
 *          answer". Oldest first by default, with a toggle that is remembered. Also Download (TXT and
 *          PDF, always in time order) and Clear transcript (asks first).
 * Used by: src/features/review/SessionReview.tsx
 * Depends on: src/core/review/conversation.ts, src/core/answer/format.ts (splitAnswer),
 *             src/core/storage/answers.ts (rating, report), src/core/storage/utterances.ts (clear),
 *             src/core/storage/sessions.ts (updateSession: the other person's name),
 *             src/core/transcript/turns.ts (names, mm:ss), src/features/shell/AccountName.tsx,
 *             src/ui (Button, Dialog, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0029
 *
 * All of this stays on this device; reports are stored with the answer and sent nowhere.
 */
'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { cardQuestion } from '@/core/answer/format';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { AnswerTags } from '@/features/answers/AnswerTags';
import { getReviewOldestFirst, setReviewOldestFirst } from '@/core/storage/answerPrefs';
import {
  answerLabel,
  conversationEntries,
  conversationItems,
  orderEntries,
  transcriptFileName,
  transcriptPdf,
  transcriptText,
} from '@/core/review/conversation';
import { downloadFile } from '@/core/review/downloadTranscript';
import { rateAnswer, reportAnswer } from '@/core/storage/answers';
import type { Session, StoredAnswer, StoredUtterance } from '@/core/storage/types';
import { updateSession } from '@/core/storage/sessions';
import { clearTranscript } from '@/core/storage/utterances';
import type { DisplayTerm } from '@/core/transcript/display';
import { formatElapsed, speakerNames } from '@/core/transcript/turns';
import { useAccountName } from '@/features/shell/AccountName';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { ChevronDownIcon, FlagIcon, ThumbDownIcon, ThumbUpIcon } from '@/ui/icons';
import { Tabs } from '@/ui/Tabs';

/** Clock time of a line or answer, in the user's locale (for example "14:05:32"). */
const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

/** A call's date and time, on its divider. */
const CALL_CLOCK = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The section's tabs. */
const VIEWS = [
  { value: 'conversation', label: 'Conversation' },
  { value: 'answers', label: 'Answers' },
] as const;

/** How each answer was asked. */
const MODE_LABELS: Record<StoredAnswer['mode'], string> = {
  answer: 'Answer',
  chat: 'Typed question',
  screenshot: 'Screenshot',
};

/**
 * Nothing to subscribe to: only this page changes the setting.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: ConversationSection (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/** Words for a rating. */
const RATING_LABELS = { up: '👍 Helpful', down: '👎 Not helpful' } as const;

/** Props for ConversationSection. */
export interface ConversationSectionProps {
  /** The session. */
  session: Session;
  /** The saved lines, oldest first. */
  lines: readonly StoredUtterance[];
  /** The saved answers, oldest first. */
  answers: readonly StoredAnswer[];
  /** The session's own spellings to restore in each line (displayTerms()). */
  terms: readonly DisplayTerm[];
  /** Reads the data again after a change. */
  onChanged: () => void;
}

/**
 * One of Kite's answers in the conversation.
 *
 * @param props.answer      The answer.
 * @param props.sessionType The session's type.
 * @param props.terms     The session's own spellings, for a question with no cleaned form.
 * @param props.onChanged Reads the data again after a change.
 * @returns The card.
 * Rendered by: ConversationSection
 */
function AnswerCard({
  answer,
  sessionType,
  terms,
  onChanged,
  inline = false,
}: {
  /** The answer. */
  answer: StoredAnswer;
  /** The session's type, for the source tag's words. */
  sessionType: string;
  /** The session's own spellings, for a question with no cleaned form. */
  terms: readonly DisplayTerm[];
  /** Reads the data again after a change. */
  onChanged: () => void;
  /** v1.3.2: inside the Conversation tab, where the label above already names it: "Question:" and "Answer:". */
  inline?: boolean;
}) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');

  /**
   * Sets or removes a rating.
   *
   * @param rating The thumb pressed.
   */
  function rate(rating: 'up' | 'down') {
    void rateAnswer(answer.id, answer.rating === rating ? null : rating).then(onChanged);
  }

  /** Stores the report on this device. */
  function sendReport() {
    void reportAnswer(answer.id, reason.trim()).then(onChanged);
    setReporting(false);
  }

  return (
    <li
      aria-label="Saved answer"
      className="my-1 border border-ui-border rounded-card bg-ui-surface shadow-card p-3 text-[13px]"
    >
      <p className="text-[13px] text-ui-muted">
        {inline ? '' : `Paramount AI · ${MODE_LABELS[answer.mode]} · `}Question:{' '}
        <span className="text-ui-text" title={answer.question || undefined}>
          {cardQuestion(answer.question, answer.cleanQuestion, terms, 'the latest from Them')}
        </span>
      </p>
      <AnswerTags meta={answer.meta} sessionType={sessionType} />
      {inline && <p className="mt-1 text-[13px] text-ui-muted">Answer:</p>}
      <div className="mt-1">
        <AnswerBody
          text={answer.text}
          finished
          size="review"
          claims={answer.claims ?? []}
          {...(answer.meta?.target ? { target: answer.meta.target } : {})}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ui-muted">
        <span>{CLOCK.format(answer.createdAt)}</span>
        <button
          type="button"
          aria-label="Good answer"
          aria-pressed={answer.rating === 'up'}
          onClick={() => rate('up')}
          className={`p-1 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${answer.rating === 'up' ? 'text-ui-success' : ''}`}
        >
          <ThumbUpIcon />
        </button>
        <button
          type="button"
          aria-label="Bad answer"
          aria-pressed={answer.rating === 'down'}
          onClick={() => rate('down')}
          className={`p-1 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${answer.rating === 'down' ? 'text-ui-danger' : ''}`}
        >
          <ThumbDownIcon />
        </button>
        <button
          type="button"
          aria-label={answer.reported ? 'Reported' : 'Report this answer'}
          aria-pressed={answer.reported ?? false}
          onClick={() => setReporting((open) => !open)}
          className={`p-1 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${answer.reported ? 'text-ui-warning' : ''}`}
        >
          <FlagIcon />
        </button>
        {answer.rating && <span aria-label="Rating">{RATING_LABELS[answer.rating]}</span>}
        {answer.reported && <span>Reported</span>}
        {answer.note && <span aria-label="Your note">Your note: {answer.note}</span>}
      </div>
      {reporting && (
        <div className="mt-2 flex items-end gap-2">
          <input
            aria-label="What was wrong?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={2_000}
            placeholder="What was wrong? (optional)"
            className="h-9 min-w-0 flex-1 border border-ui-border bg-ui-input px-2 text-[15px] text-ui-text pointer-coarse:min-h-11"
          />
          <Button size="sm" variant="secondary" onClick={sendReport}>
            Report
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * One answer in the conversation (v1.3.2): "Paramount AI answered  <mm:ss>" right after the turn it
 * answered, which opens its Question and Answer in place, so the talk stays readable.
 *
 * @param props.label    "Paramount AI answered", with its type for chat and screenshot answers.
 * @param props.time     Its mm:ss since the call started.
 * @param props.children The card.
 * @returns The label and, once opened, the card.
 * Rendered by: ConversationSection
 */
function AnswerChip({
  label,
  time,
  children,
}: {
  /** The label. */
  label: string;
  /** Its mm:ss. */
  time: string;
  /** The card. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex w-fit items-center gap-2 rounded-control text-[13px] leading-5 hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
      >
        <span className="font-semibold text-ui-accent">{label}</span>
        <span className="tabular-nums text-ui-muted">{time}</span>
        <span aria-hidden="true" className={`text-ui-muted ${open ? '' : '-rotate-90'}`}>
          <ChevronDownIcon />
        </span>
      </button>
      {open && <ul className="mt-1 list-none">{children}</ul>}
    </li>
  );
}

/**
 * The other person's name on their turns (v1.3.2): a button; clicking it turns it into a box. Enter or
 * leaving the box saves the name on the session (it syncs with the session), Escape keeps the old one.
 * An empty name goes back to "Them".
 *
 * @param props.session   The session (its contactName).
 * @param props.name      The name shown now.
 * @param props.onChanged Reads the data again after a change.
 * @returns The name, or the box while editing.
 * Rendered by: ConversationSection
 */
function ThemName({
  session,
  name,
  onChanged,
}: {
  /** The session. */
  session: Session;
  /** The name shown now. */
  name: string;
  /** Reads the data again after a change. */
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  /** Saves the typed name, if it changed. */
  function save() {
    const next = (draft ?? '').trim().slice(0, 80);
    setDraft(null);
    if (next === (session.contactName?.trim() ?? '')) return;
    void updateSession(session.id, { contactName: next }).then(onChanged, () => undefined);
  }

  if (draft === null) {
    return (
      <button
        type="button"
        title="Rename"
        aria-label={`${name}: rename`}
        onClick={() => setDraft(session.contactName?.trim() ?? '')}
        className="rounded-control font-semibold text-ui-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
      >
        {name}
      </button>
    );
  }
  return (
    <input
      aria-label="The other person's name"
      // The user opened the box with a click: it takes the typing at once.
      autoFocus
      value={draft}
      maxLength={80}
      placeholder="Them"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save();
        else if (event.key === 'Escape') setDraft(null);
      }}
      className="h-7 w-44 rounded-control border border-ui-border bg-ui-input px-2 text-[13px] font-semibold text-ui-text pointer-coarse:min-h-11"
    />
  );
}

/**
 * A divider before a call, when a session has several.
 *
 * @param props.at When the call started (Unix ms).
 * @returns The divider.
 * Rendered by: ConversationSection
 */
function CallDivider({
  at,
}: {
  /** When the call started (Unix ms). */
  at: number;
}) {
  return (
    <li
      role="separator"
      aria-label={`Call of ${CALL_CLOCK.format(at)}`}
      className="my-2 flex items-center gap-2 text-[13px] font-medium text-ui-muted"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-ui-border" />
      Call of {CALL_CLOCK.format(at)}
      <span aria-hidden="true" className="h-px flex-1 bg-ui-border" />
    </li>
  );
}

/**
 * The transcript with answers inline.
 *
 * @param props See ConversationSectionProps.
 * @returns The section.
 * Rendered by: SessionReview.tsx
 */
export function ConversationSection({
  session,
  lines,
  answers,
  terms,
  onChanged,
}: ConversationSectionProps) {
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]['value']>('conversation');
  const items = conversationItems(lines, answers);
  // v1.3.2: turns, with each answer after the turn it answered; the downloads say the same.
  const entries = conversationEntries(items, terms);
  // Oldest first unless the user chose otherwise (remembered on this device; v1.1.0, was newest).
  const savedOldestFirst = useSyncExternalStore(subscribeNever, getReviewOldestFirst, () => true);
  const [oldestChoice, setOldestChoice] = useState<boolean | null>(null);
  const oldestFirst = oldestChoice ?? savedOldestFirst;
  const shown = orderEntries(entries, oldestFirst);
  // v1.3.2: the account's display name on the user's turns, the session's name for the other person.
  const accountName = useAccountName();
  const names = speakerNames(session, accountName);

  /**
   * One answer's card.
   *
   * @param answer The answer.
   * @param inline True inside the Conversation tab ("Question:" and "Answer:" lines).
   * @returns The card.
   */
  const card = (answer: StoredAnswer, inline = false) => (
    <AnswerCard
      key={answer.id}
      answer={answer}
      sessionType={session.type}
      terms={terms}
      onChanged={onChanged}
      inline={inline}
    />
  );

  /** Downloads the conversation as text. */
  function downloadText() {
    setNotice(null);
    downloadFile(
      transcriptFileName(session, 'txt'),
      'text/plain;charset=utf-8',
      transcriptText(session, items, terms, accountName),
    );
  }

  /** Downloads the conversation as a PDF, saying so if some letters cannot be shown in it. */
  function downloadPdf() {
    const { bytes, lossy } = transcriptPdf(session, items, terms, accountName);
    downloadFile(transcriptFileName(session, 'pdf'), 'application/pdf', bytes.slice());
    setNotice(
      lossy
        ? 'Some letters cannot be shown in the PDF and appear as "?". TXT keeps them all.'
        : null,
    );
  }

  /** Clears the saved lines, after the user confirmed. */
  async function confirmClear() {
    await clearTranscript(session.id);
    setConfirming(false);
    onChanged();
  }

  return (
    <section
      aria-label="Transcript"
      className="border border-ui-border rounded-card bg-ui-surface shadow-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[18px] font-semibold text-ui-heading">Transcript</h2>
        {items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1.5 text-[13px] text-ui-text pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={oldestFirst}
                onChange={(event) => {
                  setOldestChoice(event.target.checked);
                  setReviewOldestFirst(event.target.checked);
                }}
              />
              Oldest first
            </label>
            <Button variant="secondary" size="sm" onClick={downloadText}>
              Download TXT
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadPdf}>
              Download PDF
            </Button>
            {lines.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Clear transcript
              </Button>
            )}
          </div>
        )}
      </div>
      {notice && (
        <p role="status" className="mt-2 text-[13px] text-ui-muted">
          {notice}
        </p>
      )}
      {lines.length === 0 && (
        <p className="mt-2 text-[13px] text-ui-muted">
          {session.saveTranscript
            ? 'No transcript lines are saved for this session.'
            : 'Transcript not saved. "Save transcript" was off for this session, so only the answers and the notes were kept.'}
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-3">
          <Tabs label="Transcript view" options={VIEWS} value={view} onChange={setView} />
        </div>
      )}
      {items.length > 0 && view === 'conversation' && (
        // v1.3.2: like an export, a blank line between turns.
        <ol aria-label="Conversation" className="mt-3 flex flex-col gap-4">
          {shown.map((entry) => {
            if (entry.kind === 'call')
              return <CallDivider key={`call-${entry.at}`} at={entry.at} />;
            if (entry.kind === 'answer') {
              return (
                <AnswerChip
                  key={entry.answer.id}
                  label={answerLabel(entry.answer)}
                  time={formatElapsed(entry.elapsed)}
                >
                  {card(entry.answer, true)}
                </AnswerChip>
              );
            }
            // One turn: a speaker's consecutive lines, under "<name>  <mm:ss>".
            const you = entry.turn.speaker === 'you';
            return (
              <li
                key={entry.turn.id}
                aria-label={you ? 'You said' : 'Them said'}
                className="flex flex-col gap-0.5"
              >
                <span className="flex items-center gap-2 text-[13px] leading-5">
                  {you ? (
                    <span className="font-semibold text-ui-you">{names.you}</span>
                  ) : (
                    <ThemName session={session} name={names.them} onChanged={onChanged} />
                  )}
                  <span className="tabular-nums text-ui-muted">{formatElapsed(entry.elapsed)}</span>
                </span>
                <span className="text-[15px] leading-6 text-ui-text">{entry.turn.finalText}</span>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 0 && view === 'answers' && (
        <ol aria-label="Answers" className="mt-3 flex flex-col gap-1.5">
          {shown.flatMap((entry) => {
            if (entry.kind === 'call')
              return [<CallDivider key={`call-${entry.at}`} at={entry.at} />];
            return entry.kind === 'answer' ? [card(entry.answer)] : [];
          })}
          {!shown.some((entry) => entry.kind === 'answer') && (
            <li className="text-[13px] text-ui-muted">
              Paramount AI gave no answers in this session.
            </li>
          )}
        </ol>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear this transcript?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmClear()}>
              Clear transcript
            </Button>
          </>
        }
      >
        <p>
          The saved transcript of this session is deleted from this computer. Paramount AI&rsquo;s
          answers and the notes stay. This cannot be undone.
        </p>
      </Dialog>
    </section>
  );
}
