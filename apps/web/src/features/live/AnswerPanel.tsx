/**
 * File: apps/web/src/features/live/AnswerPanel.tsx
 * Purpose: Shows one answer of the call: the question it answers (with "from N lines"), the
 *          headline as it streams, then the bullets; Cancel while it streams; Previous / Next
 *          through the session's answers; Copy; the time to the first word; and (Stage 7) 👍 / 👎
 *          and an optional "What was wrong / better answer" note; for a screenshot answer, a
 *          small thumbnail of the screenshot, from memory only (Day 5).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer/format.ts, src/features/answers (AnswerBody, AnswerTags),
 *             src/features/live/useLiveAnswers.ts (AnswerEntry), src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (answer panel), §6.1 step 6;
 *               day-04-answers.md Stage 6
 *
 * Question and answer text is only rendered (and copied when the user asks); never logged.
 */
'use client';

import type { AnswerType } from '@kite/shared';
import { useState } from 'react';
import type { AnswerRating } from '@/core/storage/types';
import { answerText, splitAnswer } from '@/core/answer/format';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { AnswerTags } from '@/features/answers/AnswerTags';
import { Button } from '@/ui/Button';
import type { AnswerEntry } from './useLiveAnswers';

/** Props for AnswerPanel. */
export interface AnswerPanelProps {
  /** The answer shown, or null (none yet, or cleared). */
  entry: AnswerEntry | null;
  /** Its position (0-based) among this call's answers. */
  index: number;
  /** How many answers this call has. */
  total: number;
  /** True on macOS (for the shortcut hint). */
  mac: boolean;
  /** A notice to show instead of an answer (for example "nothing to answer yet"). */
  notice: string | null;
  /** Shows the previous answer. */
  onPrev: () => void;
  /** Shows the next answer. */
  onNext: () => void;
  /** Stops the answer streaming. */
  onCancel: () => void;
  /** Rates an answer. */
  onRate: (id: string, rating: AnswerRating) => void;
  /** Opens the in-call sign-in (after a "Signed out" failure, Day 6 Stage 4e). */
  onSignInAgain?: () => void;
  /** Saves an answer's note. */
  onNote: (id: string, note: string) => void;
  /** Puts text on the clipboard (resolves when done). */
  copy?: (text: string) => Promise<void>;
  /** The session's type, for the source tag's words. */
  sessionType?: string;
  /** Answers again in another shape (the card's type menu). */
  onReanswer?: (id: string, answerType: AnswerType) => void;
  /** The call's answers, oldest first: the others are listed below, newest first (ADR-0030). */
  entries?: readonly AnswerEntry[];
  /** Shows one of them. */
  onShow?: (id: string) => void;
}

/** Props for RatingControls. */
interface RatingControlsProps {
  /** The answer being rated. */
  entry: AnswerEntry;
  /** Rates it. */
  onRate: (id: string, rating: AnswerRating) => void;
  /** Saves its note. */
  onNote: (id: string, note: string) => void;
}

/**
 * 👍 / 👎 (pressing the chosen one again removes the rating) and the note box.
 *
 * @param props See RatingControlsProps.
 * @returns The controls.
 * Rendered by: AnswerPanel (for a finished answer)
 */
function RatingControls({ entry, onRate, onNote }: RatingControlsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note);
  /**
   * Sets or toggles off a rating.
   *
   * @param rating The rating pressed.
   * @returns Nothing.
   */
  const toggle = (rating: 'up' | 'down') =>
    onRate(entry.id, entry.rating === rating ? null : rating);
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-ui-border pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ui-muted">
        <span>Was this answer good?</span>
        <Button
          size="sm"
          variant={entry.rating === 'up' ? 'primary' : 'secondary'}
          aria-pressed={entry.rating === 'up'}
          aria-label="Good answer"
          onClick={() => toggle('up')}
        >
          👍
        </Button>
        <Button
          size="sm"
          variant={entry.rating === 'down' ? 'primary' : 'secondary'}
          aria-pressed={entry.rating === 'down'}
          aria-label="Bad answer"
          onClick={() => toggle('down')}
        >
          👎
        </Button>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(entry.note);
              setEditing(true);
            }}
          >
            {entry.note ? 'Edit note' : 'Add a note'}
          </Button>
        )}
        {!editing && entry.note && (
          <span aria-label="Your note" className="text-ui-muted">
            “{entry.note}”
          </span>
        )}
      </div>
      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onNote(entry.id, draft);
            setEditing(false);
          }}
        >
          <textarea
            aria-label="What was wrong / better answer"
            className="border border-ui-border bg-ui-input px-3 py-2 text-base text-ui-text focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] md:text-sm"
            placeholder="What was wrong, or what would a better answer say?"
            rows={2}
            maxLength={2_000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit">
              Save note
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Status line under a finished, failed or cancelled answer. */
const STATUS_TEXT: Record<Exclude<AnswerEntry['status'], 'done'>, string> = {
  streaming: 'Answering…',
  error: 'The answer failed.',
  cancelled: 'Stopped.',
};

/**
 * The answer panel.
 *
 * @param props See AnswerPanelProps.
 * @returns The panel.
 * Rendered by: LiveAnswers.tsx
 */
export function AnswerPanel(props: AnswerPanelProps) {
  const { entry } = props;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = props.copy ?? ((text: string) => navigator.clipboard.writeText(text));

  if (!entry) {
    return (
      <section
        aria-label="Answer"
        className="flex min-h-[20rem] flex-col items-start justify-center gap-3 border border-dashed border-ui-border p-5 text-[15px] text-ui-muted"
      >
        {props.notice ??
          `Press Answer (${props.mac ? '⌘' : 'Ctrl+'}Enter) when they ask something, or type a question with Chat.`}
        {props.total > 0 && (
          <Button size="sm" variant="secondary" onClick={props.onPrev}>
            Show last answer
          </Button>
        )}
      </section>
    );
  }

  // A private answer is read as written; for the call, Copy leaves out the private note.
  const copyText = entry.meta?.target === 'kite' ? entry.text : answerText(entry.text);
  const others = [...(props.entries ?? [])]
    .reverse()
    .filter((other) => other.id !== entry.id && other.text.trim() !== '');
  const source = entry.earlier
    ? 'earlier'
    : entry.mode === 'screenshot'
      ? 'screenshot'
      : entry.mode === 'chat'
        ? 'typed question'
        : `from ${entry.fromLines} ${entry.fromLines === 1 ? 'line' : 'lines'}`;

  // Theme §6: a mono eyebrow, a 3 px cyan bar, a bold headline. A minimum height with the
  // footer pinned to the bottom: the footer does not move while the bullets stream in.
  return (
    <section
      aria-label="Answer"
      className="flex min-h-[20rem] flex-col border border-l-[3px] border-ui-border border-l-ui-accent bg-ui-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted">
          Answer
          {/* Kite answered by itself (auto-answer beta, Day 6 Stage 4f). */}
          {entry.auto ? (
            <span className="ml-2 border border-ui-primary px-1 text-ui-primary">Auto</span>
          ) : null}
          {entry.timeline ? (
            <>
              {' · '}
              <span aria-label="Time to first word">
                {(entry.timeline.toFirstWord / 1000).toFixed(2)} s
              </span>
            </>
          ) : entry.status === 'streaming' ? (
            ' · …'
          ) : null}
        </p>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onPrev}
            disabled={props.index <= 0}
            aria-label="Previous answer"
          >
            ←
          </Button>
          <span className="font-mono text-[11px] text-ui-muted">
            {props.index + 1} of {props.total}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onNext}
            disabled={props.index >= props.total - 1}
            aria-label="Next answer"
          >
            →
          </Button>
        </div>
      </div>
      <p className="mt-1 text-[13px] text-ui-muted">
        Question ({source}):{' '}
        <span aria-label="Question used" className="text-ui-text">
          {entry.question || 'the latest from Them'}
        </span>
      </p>
      <AnswerTags
        meta={entry.meta}
        {...(props.sessionType ? { sessionType: props.sessionType } : {})}
        {...(props.onReanswer && entry.status !== 'streaming'
          ? { onChangeType: (type: AnswerType) => props.onReanswer?.(entry.id, type) }
          : {})}
      />

      <div className="mt-3 flex-1">
        {entry.thumbnail && (
          // The screenshot, from memory (a data URL; never saved). Small, for context only.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.thumbnail}
            alt="Screenshot this answer is about"
            className="mb-3 max-h-24 border border-ui-border"
          />
        )}
        {/* No placeholder headline when Claude was unavailable or the answer has a problem box:
            the message says it all. */}
        <AnswerBody
          text={entry.text}
          size="panel"
          claims={entry.claims ?? []}
          hideEmptyHeadline={Boolean(entry.unavailable || entry.problem)}
          {...(entry.meta?.target ? { target: entry.meta.target } : {})}
          {...(props.copy ? { copy: props.copy } : {})}
        />

        {entry.unavailable && (
          // Claude is down for everyone (usage limit or overload): say so plainly, and that the
          // transcript keeps recording (core/answer/unavailable.ts).
          <div
            role="alert"
            className="mt-3 border-l-[3px] border-ui-warning bg-ui-warning-bg px-3 py-2"
          >
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-warning">
              Claude unavailable
            </p>
            <p className="mt-1 text-[14px] text-ui-text">{entry.error}</p>
          </div>
        )}

        {entry.problem && (
          // A failure the user can act on (Day 6 Stage 4e): signed out (sign in again here,
          // without leaving the call) or no connection. Same box as "Claude unavailable".
          <div
            role="alert"
            className="mt-3 border-l-[3px] border-ui-warning bg-ui-warning-bg px-3 py-2"
          >
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-warning">
              {entry.problem === 'signed-out' ? 'Signed out' : 'No connection'}
            </p>
            <p className="mt-1 text-[14px] text-ui-text">{entry.error}</p>
            {entry.problem === 'signed-out' && props.onSignInAgain && (
              <Button className="mt-2" variant="secondary" onClick={props.onSignInAgain}>
                Sign in again
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ui-muted">
        {entry.status !== 'done' && !entry.unavailable && !entry.problem && (
          <span role={entry.status === 'error' ? 'alert' : 'status'}>
            {entry.status === 'error' && entry.error ? entry.error : STATUS_TEXT[entry.status]}
          </span>
        )}
        <span className="flex-1" />
        {entry.status === 'streaming' ? (
          <Button size="sm" variant="secondary" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : (
          entry.text && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                copy(copyText)
                  .then(() => setCopiedId(entry.id))
                  .catch(() => undefined);
              }}
            >
              {copiedId === entry.id ? 'Copied' : 'Copy'}
            </Button>
          )
        )}
      </div>
      {entry.status === 'done' && (
        // key: a different answer starts with its own note draft.
        <RatingControls key={entry.id} entry={entry} onRate={props.onRate} onNote={props.onNote} />
      )}
      {others.length > 0 && props.onShow && (
        <div className="mt-3 border-t border-ui-border pt-2">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted">
            Other answers, newest first
          </p>
          <ul aria-label="Other answers" className="mt-1 flex flex-col gap-0.5">
            {others.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  className="w-full truncate py-0.5 text-left text-[13px] text-ui-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                  onClick={() => props.onShow?.(other.id)}
                >
                  {other.question || splitAnswer(other.text).headline}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
