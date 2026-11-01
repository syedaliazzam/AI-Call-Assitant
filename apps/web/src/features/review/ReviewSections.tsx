/**
 * File: apps/web/src/features/review/ReviewSections.tsx
 * Purpose: The three content sections of the session review page: the AI notes (with their
 *          Regenerate button and status), every saved answer (question, rating, note), and the
 *          saved transcript (You/Them with clock times, or a note when it was not saved).
 * Used by: src/features/review/SessionReview.tsx
 * Depends on: src/core/review/load.ts (formatCallTime), src/core/answer/format.ts (splitAnswer),
 *             src/features/review/ProposedLessons.tsx (Stage 7),
 *             src/core/storage/types.ts, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review);
 *               day-05-overlay-screenshots-notes.md Stage 6
 */
'use client';

import { splitAnswer } from '@/core/answer/format';
import { formatCallTime } from '@/core/review/load';
import type {
  SessionType,
  StoredAnswer,
  StoredLesson,
  StoredNotes,
  StoredUtterance,
} from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { ProposedLessons } from './ProposedLessons';

/** Clock time of a line or answer, in the user's locale (for example "14:05:32"). */
const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

/** Date and time, for when the notes' call started and when they were written. */
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Shared look of a review section. */
const SECTION_CLASSES = 'rounded-lg border border-slate-200 bg-white p-5';

/** Labels for the answered field of a notes question. */
const ANSWERED_LABELS: Record<'yes' | 'partly' | 'no', string> = {
  yes: 'Answered',
  partly: 'Partly answered',
  no: 'Not answered',
};

/** Labels for how an answer was asked. */
const MODE_LABELS: Record<StoredAnswer['mode'], string> = {
  answer: 'Answer',
  chat: 'Typed question',
  screenshot: 'Screenshot',
};

/**
 * A rating as shown on the page.
 *
 * @param rating The rating.
 * @returns "👍 Helpful", "👎 Not helpful" or "Not rated".
 * Called from: NotesSection, AnswersSection
 */
function ratingLabel(rating: 'up' | 'down' | null | undefined): string {
  if (rating === 'up') return '👍 Helpful';
  if (rating === 'down') return '👎 Not helpful';
  return 'Not rated';
}

/** Props for NotesSection. */
export interface NotesSectionProps {
  /** The saved notes, or null. */
  notes: StoredNotes | null;
  /** True when there is something saved to write notes from (lines or answers). */
  canWrite: boolean;
  /** True while notes are being written. */
  writing: boolean;
  /** The status line under the button ('' for none). */
  status: string;
  /** True when the status line reports a failure. */
  failed: boolean;
  /** Writes the notes again (Regenerate) or for the first time. */
  onRegenerate: () => void;
  /** The session (for lesson decisions). */
  sessionId: string;
  /** Its type (the default lesson scope). */
  sessionType: SessionType;
  /** The decisions on this session's proposed lessons. */
  lessonDecisions: readonly StoredLesson[];
  /** Called after a lesson decision changed (the page reloads). */
  onLessonsChanged: () => void;
}

/**
 * The AI notes: summary, questions, next steps, unclear parts and proposed lessons, with
 * Regenerate. Proposed lessons are suggestions with Approve / Edit / Reject (ProposedLessons).
 *
 * @param props See NotesSectionProps.
 * @returns The section.
 * Rendered by: SessionReview.tsx
 */
export function NotesSection(props: NotesSectionProps) {
  const { notes } = props;
  return (
    <section aria-label="AI notes" className={SECTION_CLASSES}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">AI notes</h2>
          {notes?.fromAnswersOnly && (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
              Written from answers only
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={props.onRegenerate}
          disabled={props.writing || !props.canWrite}
        >
          {props.writing ? 'Writing…' : notes ? 'Regenerate' : 'Write the notes'}
        </Button>
      </div>
      {props.status && (
        <p
          role={props.failed ? 'alert' : 'status'}
          className={`mt-2 text-sm ${props.failed ? 'text-amber-900' : 'text-slate-600'}`}
        >
          {props.status}
        </p>
      )}
      {!props.canWrite && !notes && (
        <p className="mt-2 text-sm text-slate-500">
          Nothing was saved from this session to write notes from.
        </p>
      )}

      {notes ? (
        <div className="mt-4 space-y-4 text-sm text-slate-800">
          <p className="text-xs text-slate-500">
            Notes of the call that started {DATE_TIME.format(notes.callStartedAt)}; written{' '}
            {DATE_TIME.format(notes.createdAt)}.
          </p>
          <div>
            <h3 className="font-medium text-slate-900">Summary</h3>
            <ul aria-label="Summary" className="mt-1 list-disc space-y-1 pl-5">
              {notes.notes.summary.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          </div>
          {notes.notes.questions.length > 0 && (
            <div>
              <h3 className="font-medium text-slate-900">Questions asked</h3>
              <ul aria-label="Questions asked" className="mt-1 space-y-1">
                {notes.notes.questions.map((question, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-slate-500">
                      {formatCallTime(question.at)}
                    </span>{' '}
                    {question.question}{' '}
                    <span className="text-xs text-slate-500">
                      ({ANSWERED_LABELS[question.answered]}
                      {question.rating ? `, ${ratingLabel(question.rating)}` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.notes.nextSteps.length > 0 && (
            <div>
              <h3 className="font-medium text-slate-900">Next steps</h3>
              <ul aria-label="Next steps" className="mt-1 list-disc space-y-1 pl-5">
                {notes.notes.nextSteps.map((step, i) => (
                  <li key={i}>
                    {step.step}
                    {step.owner && <span className="text-slate-500"> ({step.owner})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.notes.unclear.length > 0 && (
            <div>
              <h3 className="font-medium text-slate-900">Too unclear to summarise</h3>
              <ul aria-label="Unclear parts" className="mt-1 space-y-1">
                {notes.notes.unclear.map((part, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-slate-500">
                      {formatCallTime(part.from)}–{formatCallTime(part.to)}
                    </span>{' '}
                    {part.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.notes.lessons.length > 0 && (
            <ProposedLessons
              sessionId={props.sessionId}
              sessionType={props.sessionType}
              proposals={notes.notes.lessons}
              decisions={props.lessonDecisions}
              onChanged={props.onLessonsChanged}
            />
          )}
        </div>
      ) : (
        props.canWrite && (
          <p className="mt-2 text-sm text-slate-500">
            No notes have been written for this session.
          </p>
        )
      )}
    </section>
  );
}

/** Props for AnswersSection. */
export interface AnswersSectionProps {
  /** The saved answers, oldest first. */
  answers: readonly StoredAnswer[];
}

/**
 * Every saved answer: when, how it was asked, the question, the answer, rating and note.
 *
 * @param props See AnswersSectionProps.
 * @returns The section.
 * Rendered by: SessionReview.tsx
 */
export function AnswersSection({ answers }: AnswersSectionProps) {
  return (
    <section aria-label="Answers" className={SECTION_CLASSES}>
      <h2 className="text-base font-semibold text-slate-900">Answers ({answers.length})</h2>
      {answers.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Kite gave no answers in this session.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {answers.map((answer) => {
            const parts = splitAnswer(answer.text);
            return (
              <li
                key={answer.id}
                aria-label="Saved answer"
                className="rounded-md border border-slate-100 p-3 text-sm"
              >
                <p className="text-xs text-slate-500">
                  {CLOCK.format(answer.createdAt)} · {MODE_LABELS[answer.mode]} · Question:{' '}
                  <span className="text-slate-700">
                    {answer.question || 'the latest from Them'}
                  </span>
                </p>
                <p className="mt-1 font-medium text-slate-900">{parts.headline}</p>
                {parts.bullets.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-800">
                    {parts.bullets.map((bullet, i) => (
                      <li key={i}>{bullet}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-slate-600">
                  <span aria-label="Rating">{ratingLabel(answer.rating)}</span>
                  {answer.note && (
                    <>
                      {' · '}
                      <span aria-label="Your note">Your note: {answer.note}</span>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Props for TranscriptSection. */
export interface TranscriptSectionProps {
  /** The saved lines, oldest first. */
  lines: readonly StoredUtterance[];
  /** The session's "Save transcript" setting. */
  saveTranscript: boolean;
}

/**
 * The saved transcript, or a note that it was not saved (only answers and notes were kept).
 *
 * @param props See TranscriptSectionProps.
 * @returns The section.
 * Rendered by: SessionReview.tsx
 */
export function TranscriptSection({ lines, saveTranscript }: TranscriptSectionProps) {
  return (
    <section aria-label="Transcript" className={SECTION_CLASSES}>
      <h2 className="text-base font-semibold text-slate-900">Transcript</h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          {saveTranscript
            ? 'No transcript lines were saved for this session.'
            : 'The transcript was not saved for this session ("Save transcript" was off). Only the answers and the notes were kept.'}
        </p>
      ) : (
        <ol aria-label="Transcript lines" className="mt-3 space-y-1 text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex gap-3">
              <span className="w-20 shrink-0 font-mono text-xs leading-5 text-slate-400">
                {CLOCK.format(line.tStart)}
              </span>
              <span
                className={`w-12 shrink-0 font-medium ${line.speaker === 'you' ? 'text-brand-700' : 'text-slate-700'}`}
              >
                {line.speaker === 'you' ? 'You' : 'Them'}
              </span>
              <span className="text-slate-800">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
