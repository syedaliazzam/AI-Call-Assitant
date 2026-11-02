/**
 * File: apps/web/src/features/review/ReviewSections.tsx
 * Purpose: The AI notes section of the session window, with its Regenerate button and status.
 * Used by: src/features/review/SessionReview.tsx
 * Depends on: src/core/review/load.ts (formatCallTime),
 *             src/features/review/ProposedLessons.tsx (Stage 7),
 *             src/core/storage/types.ts, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review);
 *               day-05-overlay-screenshots-notes.md Stage 6
 */
'use client';

import { formatCallTime } from '@/core/review/load';
import type { SessionType, StoredLesson, StoredNotes } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { ProposedLessons } from './ProposedLessons';

/** Date and time, for when the notes' call started and when they were written. */
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Shared look of a review section. */
const SECTION_CLASSES = 'border border-ui-border bg-ui-surface p-5';

/** Labels for the answered field of a notes question. */
const ANSWERED_LABELS: Record<'yes' | 'partly' | 'no', string> = {
  yes: 'Answered',
  partly: 'Partly answered',
  no: 'Not answered',
};

/**
 * A rating as shown on the page.
 *
 * @param rating The rating.
 * @returns "👍 Helpful", "👎 Not helpful" or "Not rated".
 * Called from: NotesSection
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
          <h2 className="text-[20px] text-ui-subheading">AI notes</h2>
          {notes?.fromAnswersOnly && (
            <span className="bg-ui-warning-bg px-2 py-0.5 text-xs font-semibold text-ui-warning">
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
          className={`mt-2 text-sm ${props.failed ? 'text-ui-warning' : 'text-ui-muted'}`}
        >
          {props.status}
        </p>
      )}
      {!props.canWrite && !notes && (
        <p className="mt-2 text-sm text-ui-muted">
          Nothing was saved from this session to write notes from.
        </p>
      )}

      {notes ? (
        <div className="mt-4 space-y-4 text-sm text-ui-text">
          <p className="text-xs text-ui-muted">
            Notes of the call that started {DATE_TIME.format(notes.callStartedAt)}; written{' '}
            {DATE_TIME.format(notes.createdAt)}.
          </p>
          <div>
            <h3 className="font-semibold text-ui-heading">Summary</h3>
            <ul aria-label="Summary" className="mt-1 list-disc space-y-1 pl-5">
              {notes.notes.summary.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          </div>
          {notes.notes.questions.length > 0 && (
            <div>
              <h3 className="font-semibold text-ui-heading">Questions asked</h3>
              <ul aria-label="Questions asked" className="mt-1 space-y-1">
                {notes.notes.questions.map((question, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-ui-muted">
                      {formatCallTime(question.at)}
                    </span>{' '}
                    {question.question}{' '}
                    <span className="text-xs text-ui-muted">
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
              <h3 className="font-semibold text-ui-heading">Next steps</h3>
              <ul aria-label="Next steps" className="mt-1 list-disc space-y-1 pl-5">
                {notes.notes.nextSteps.map((step, i) => (
                  <li key={i}>
                    {step.step}
                    {step.owner && <span className="text-ui-muted"> ({step.owner})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.notes.unclear.length > 0 && (
            <div>
              <h3 className="font-semibold text-ui-heading">Too unclear to summarise</h3>
              <ul aria-label="Unclear parts" className="mt-1 space-y-1">
                {notes.notes.unclear.map((part, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-ui-muted">
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
          <p className="mt-2 text-sm text-ui-muted">No notes have been written for this session.</p>
        )
      )}
    </section>
  );
}
