/**
 * File: apps/web/src/features/live/AnswerPanel.tsx
 * Purpose: The call's answers as a chat-style list, NEWEST AT THE TOP (v1.0.2; ADR-0030 order),
 *          in the main window and the browser split view. Each card: "Question: …" (Claude's
 *          cleaned question once it arrives, the raw words on hover), the answer (AnswerBody: the
 *          answer line large and bold, then the bullets, then the Tip on its own line), and a quiet
 *          footer with the type and source tags, how it was asked, the time and the time to the
 *          first word, then 👍 / 👎, Copy and Report (Cancel while it streams). The answer
 *          selected with ←/→ (or in the overlay) is outlined and scrolled into view. A screenshot
 *          answer shows a small thumbnail, from memory only (Day 5).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer/format.ts, src/features/answers (AnswerBody, AnswerTags),
 *             src/features/live/useLiveAnswers.ts (AnswerEntry), src/ui (Button, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (answer panel), §6.1 step 6;
 *               day-04-answers.md Stage 6; ADR-0037
 *
 * Question and answer text is only rendered (and copied when the user asks); never logged.
 */
'use client';

import type { AnswerType } from '@kite/shared';
import { useEffect, useRef, useState } from 'react';
import type { AnswerRating } from '@/core/storage/types';
import { answerText, cardQuestion } from '@/core/answer/format';
import { sentenceCase, type DisplayTerm } from '@/core/transcript/display';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { AnswerTags } from '@/features/answers/AnswerTags';
import { Button } from '@/ui/Button';
import { CopyIcon, FlagIcon, ThumbDownIcon, ThumbUpIcon } from '@/ui/icons';
import type { AnswerEntry } from './useLiveAnswers';

/** Props for AnswerPanel. */
export interface AnswerPanelProps {
  /** The call's answers, oldest first (shown newest first). */
  entries: readonly AnswerEntry[];
  /** The answer selected (outlined; ←/→ and the overlay move it), or null. */
  shownId: string | null;
  /**
   * Clear hides the answers asked up to this time (Unix ms; 0: none hidden). The selected answer
   * always shows.
   */
  hiddenBefore: number;
  /** Shows the answers Clear hid. */
  onShowHidden: () => void;
  /** The session's spellings for the question's sentence-case display (displayTerms()). */
  terms?: readonly DisplayTerm[];
  /** True on macOS (for the shortcut hint). */
  mac: boolean;
  /** A notice to show above the answers (for example "nothing to answer yet"), or null. */
  notice: string | null;
  /** Stops the answer streaming. */
  onCancel: () => void;
  /** Rates an answer. */
  onRate: (id: string, rating: AnswerRating) => void;
  /** Reports an answer, with what was wrong (stays on this device). */
  onReport: (id: string, note: string) => void;
  /** Opens the in-call sign-in (after a "Signed out" failure, Day 6 Stage 4e). */
  onSignInAgain?: () => void;
  /** Puts text on the clipboard (resolves when done). */
  copy?: (text: string) => Promise<void>;
  /** The session's type, for the source tag's words. */
  sessionType?: string;
  /** Answers again in another shape (the type menu in the footer). */
  onReanswer?: (id: string, answerType: AnswerType) => void;
  /** Selects an answer (clicking a card). */
  onShow?: (id: string) => void;
}

/** Status line under a failed, cancelled or streaming answer. */
const STATUS_TEXT: Record<Exclude<AnswerEntry['status'], 'done'>, string> = {
  streaming: 'Answering…',
  error: 'The answer failed.',
  cancelled: 'Stopped.',
};

/** A quiet icon button in a card's footer; the caller adds its colour. */
const FOOTER_BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-control hover:bg-ui-hover disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11';

/**
 * Whether an answer was stopped before any words arrived, so its card must say so instead of
 * showing the "…" placeholder of an answer still on its way.
 *
 * @param entry The answer.
 * @returns True for a cancelled answer with no text.
 * Called from: AnswerCard
 */
export function stoppedEmpty(entry: Pick<AnswerEntry, 'status' | 'text'>): boolean {
  return entry.status === 'cancelled' && entry.text.trim() === '';
}

/**
 * How an answer was asked, for its footer.
 *
 * @param entry The answer.
 * @returns For example "Auto", "Answer", "Typed", "Screenshot" or "Earlier".
 * Called from: AnswerCard
 */
function askedHow(entry: AnswerEntry): string {
  if (entry.earlier) return 'Earlier';
  if (entry.auto) return 'Auto';
  if (entry.mode === 'chat') return 'Typed';
  if (entry.mode === 'screenshot') return 'Screenshot';
  return 'Answer';
}

/** Props for AnswerCard. */
interface AnswerCardProps extends Omit<
  AnswerPanelProps,
  'entries' | 'shownId' | 'hiddenBefore' | 'onShowHidden' | 'notice' | 'mac'
> {
  /** The answer. */
  entry: AnswerEntry;
  /** True when it is the selected answer. */
  selected: boolean;
}

/**
 * One answer card.
 *
 * @param props See AnswerCardProps.
 * @returns The card.
 * Rendered by: AnswerPanel
 */
function AnswerCard(props: AnswerCardProps) {
  const { entry } = props;
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const card = useRef<HTMLElement>(null);
  const copy = props.copy ?? ((text: string) => navigator.clipboard.writeText(text));

  // The selected answer comes into view (←/→, or chosen in the overlay); never steals focus.
  useEffect(() => {
    if (props.selected) card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [props.selected]);

  // A private answer is read as written; for the call, Copy leaves out the private note.
  const copyText = entry.meta?.target === 'kite' ? entry.text : answerText(entry.text);
  const fallback = entry.mode === 'screenshot' ? 'What is on screen' : 'The latest from Them';
  const rawQuestion = entry.question ? sentenceCase(entry.question, props.terms) : '';

  /** Sends the report, with what the user wrote. */
  const sendReport = () => {
    props.onReport(entry.id, reportNote);
    setReporting(false);
    setReportNote('');
  };

  return (
    <article
      ref={card}
      aria-label="Answer"
      aria-current={props.selected ? 'true' : undefined}
      onClick={() => props.onShow?.(entry.id)}
      className={`rounded-card border bg-ui-surface p-4 shadow-card ${props.selected ? 'border-ui-accent' : 'border-ui-border'}`}
    >
      <p aria-label="Question" className="text-[14px] leading-5 text-ui-muted">
        <strong className="font-semibold text-ui-text">Question:</strong>{' '}
        {/* Claude's cleaned question once it arrives; the raw words stay on hover (ADR-0037). */}
        <span title={rawQuestion || undefined}>
          {cardQuestion(entry.question, entry.cleanQuestion, props.terms, fallback)}
        </span>
      </p>

      <div className="mt-2">
        {entry.thumbnail && (
          // The screenshot, from memory (a data URL; never saved). Small, for context only.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.thumbnail}
            alt="Screenshot this answer is about"
            className="mb-2 max-h-20 border border-ui-border"
          />
        )}
        {/* No placeholder answer line when Claude was unavailable, the answer has a problem box,
            or it was stopped before any words arrived: the message says it all. */}
        <AnswerBody
          text={entry.text}
          size="panel"
          answerLabel
          headlineLabel="Answer line"
          claims={entry.claims ?? []}
          hideEmptyHeadline={Boolean(entry.unavailable || entry.problem || stoppedEmpty(entry))}
          {...(entry.meta?.target ? { target: entry.meta.target } : {})}
          {...(props.copy ? { copy: props.copy } : {})}
        />
        {stoppedEmpty(entry) && (
          // Fail safe (v1.0.0): a stopped answer must never look like one still on its way.
          <p className="text-[15px] text-ui-muted">
            Stopped before any words arrived. Press Answer to ask again.
          </p>
        )}
        {(entry.unavailable || entry.problem) && (
          // Claude down for everyone, the daily limit, signed out, or no connection: one box that
          // says so plainly (core/answer/unavailable.ts); the transcript keeps recording.
          <div
            role="alert"
            className="mt-2 rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2"
          >
            <p className="text-[13px] font-medium text-ui-warning">
              {entry.problem === 'signed-out'
                ? 'Signed out'
                : entry.problem === 'offline'
                  ? 'No connection'
                  : 'Claude unavailable'}
            </p>
            <p className="mt-1 text-[15px] text-ui-text">{entry.error}</p>
            {entry.problem === 'signed-out' && props.onSignInAgain && (
              <Button className="mt-2" variant="secondary" onClick={props.onSignInAgain}>
                Sign in again
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The quiet footer: tags, how and when, then the actions (v1.0.2, reference layout). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ui-muted">
        <AnswerTags
          compact
          meta={entry.meta}
          {...(props.sessionType ? { sessionType: props.sessionType } : {})}
          {...(props.onReanswer && entry.status !== 'streaming'
            ? { onChangeType: (type: AnswerType) => props.onReanswer?.(entry.id, type) }
            : {})}
        />
        {entry.meta && <span aria-hidden="true">·</span>}
        <span>{askedHow(entry)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {new Date(entry.askedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {entry.timeline && entry.text && (
          <span aria-label="Time to first word">
            · {(entry.timeline.toFirstWord / 1000).toFixed(1)} s
          </span>
        )}
        {entry.status !== 'done' && !entry.unavailable && !entry.problem && (
          <span role={entry.status === 'error' ? 'alert' : 'status'}>
            · {entry.status === 'error' && entry.error ? entry.error : STATUS_TEXT[entry.status]}
          </span>
        )}
        <span className="min-w-2 flex-1" />
        {entry.status === 'streaming' ? (
          <Button size="sm" variant="secondary" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : (
          <>
            <button
              type="button"
              className={`${FOOTER_BUTTON} ${entry.rating === 'up' ? 'text-ui-success' : ''}`}
              aria-label="Good answer"
              aria-pressed={entry.rating === 'up'}
              onClick={(event) => {
                event.stopPropagation();
                props.onRate(entry.id, entry.rating === 'up' ? null : 'up');
              }}
            >
              <ThumbUpIcon />
            </button>
            <button
              type="button"
              className={`${FOOTER_BUTTON} ${entry.rating === 'down' ? 'text-ui-danger' : ''}`}
              aria-label="Bad answer"
              aria-pressed={entry.rating === 'down'}
              onClick={(event) => {
                event.stopPropagation();
                props.onRate(entry.id, entry.rating === 'down' ? null : 'down');
              }}
            >
              <ThumbDownIcon />
            </button>
            {entry.text && (
              <button
                type="button"
                className={FOOTER_BUTTON}
                aria-label={copied ? 'Copied' : 'Copy the answer'}
                title={copied ? 'Copied' : 'Copy'}
                onClick={(event) => {
                  event.stopPropagation();
                  copy(copyText)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1_500);
                    })
                    .catch(() => undefined);
                }}
              >
                <CopyIcon />
              </button>
            )}
            <button
              type="button"
              className={`${FOOTER_BUTTON} ${entry.reported ? 'text-ui-warning' : ''}`}
              aria-label={entry.reported ? 'Reported' : 'Report this answer'}
              aria-pressed={reporting}
              disabled={entry.reported}
              onClick={(event) => {
                event.stopPropagation();
                setReporting((open) => !open);
              }}
            >
              <FlagIcon />
            </button>
          </>
        )}
      </div>
      {entry.note && (
        <p aria-label="Your note" className="mt-1 text-[12px] text-ui-muted">
          “{entry.note}”
        </p>
      )}
      {reporting && !entry.reported && (
        <form
          className="mt-2 flex gap-2"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            sendReport();
          }}
        >
          <input
            autoFocus
            aria-label="What was wrong?"
            className="min-w-0 flex-1 border border-ui-border bg-ui-input px-3 py-1.5 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 md:text-[13px]"
            placeholder="What was wrong, or what would a better answer say? (optional)"
            value={reportNote}
            maxLength={2_000}
            onChange={(event) => setReportNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setReporting(false);
            }}
          />
          <Button size="sm" type="submit">
            Report
          </Button>
        </form>
      )}
    </article>
  );
}

/**
 * The answer list.
 *
 * @param props See AnswerPanelProps.
 * @returns The list, newest first.
 * Rendered by: LiveAnswers.tsx
 */
export function AnswerPanel(props: AnswerPanelProps) {
  const visible = props.entries.filter(
    (entry) => entry.askedAt > props.hiddenBefore || entry.id === props.shownId,
  );
  const hidden = props.entries.length - visible.length;
  const newestId = props.entries.at(-1)?.id;
  const list = useRef<HTMLDivElement>(null);
  // A new answer starts at the top, wherever the list was scrolled to.
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [newestId]);

  return (
    <section aria-label="Answers" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={list}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5"
      >
        {props.notice && (
          <p
            role="status"
            className="rounded-control bg-ui-subtle px-3 py-2 text-[13px] text-ui-text"
          >
            {props.notice}
          </p>
        )}
        {visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-[15px] text-ui-muted">
            <p>No answers yet.</p>
            <p>
              Press Answer ({props.mac ? '⌘' : 'Ctrl+'}Enter) when they ask something, or type a
              message below.
            </p>
          </div>
        ) : (
          [...visible]
            .reverse()
            .map((entry) => (
              <AnswerCard
                key={entry.id}
                entry={entry}
                selected={entry.id === props.shownId}
                onCancel={props.onCancel}
                onRate={props.onRate}
                onReport={props.onReport}
                {...(props.terms ? { terms: props.terms } : {})}
                {...(props.onSignInAgain ? { onSignInAgain: props.onSignInAgain } : {})}
                {...(props.copy ? { copy: props.copy } : {})}
                {...(props.sessionType ? { sessionType: props.sessionType } : {})}
                {...(props.onReanswer ? { onReanswer: props.onReanswer } : {})}
                {...(props.onShow ? { onShow: props.onShow } : {})}
              />
            ))
        )}
        {hidden > 0 && (
          <Button size="sm" variant="ghost" className="self-center" onClick={props.onShowHidden}>
            Show {hidden} cleared {hidden === 1 ? 'answer' : 'answers'}
          </Button>
        )}
      </div>
    </section>
  );
}
