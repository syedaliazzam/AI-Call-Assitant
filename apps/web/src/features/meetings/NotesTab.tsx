/**
 * File: apps/web/src/features/meetings/NotesTab.tsx
 * Purpose: The Meetings library's AI notes tab (ADR-0096): the call's own notes, formatted: the summary,
 *          the other person's questions (each with its time and whether Paramount AI answered it), next
 *          steps with their owners, and the parts too unclear to summarise; with "Rewrite notes" (or
 *          "Write the notes"), which writes this call's notes again from its saved lines and answers exactly
 *          as the session page does (core/notes/regenerate.ts regenerateCallNotes). Proposed lessons stay on
 *          the session page. The notes show with the call's current name for the other person (ADR-0093).
 * Used by: CallPane.tsx
 * Depends on: src/core/notes/regenerate.ts, src/core/review/load.ts (loadReview, formatCallTime),
 *             src/core/answer/unavailable.ts (notesFailureText), src/core/live/afterCall.ts
 *             (notesUnavailableOf), src/core/transcript/theirName.ts (relabelNotes, theirLabel),
 *             src/ui (Button, Badge)
 * Architecture: docs/decisions/ADR-0096-meetings-library.md; ADR-0077 (notes per call)
 *
 * Notes text is shown on screen only; nothing is logged. "Rewrite notes" makes one Claude request (the
 * notes route), as on the session page.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { notesFailureText } from '@/core/answer/unavailable';
import { notesUnavailableOf } from '@/core/live/afterCall';
import { NOTES_CUT_OFF_TEXT } from '@/core/notes/cutOff';
import { regenerateCallNotes } from '@/core/notes/regenerate';
import type { CallView } from '@/core/review/calls';
import { formatCallTime, loadReview } from '@/core/review/load';
import type { Session } from '@/core/storage/types';
import {
  INTERVIEWER_LABEL,
  THEM_LABEL,
  relabelNotes,
  theirLabel,
  withTheirName,
} from '@/core/transcript/theirName';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { Button } from '@/ui/Button';

/** Props for NotesTab. */
export interface NotesTabProps {
  /** The session. */
  session: Session;
  /** The call. */
  call: CallView;
  /** Reads the library again after new notes were saved. */
  onChanged: () => void;
}

/** A notes question's "answered" state, in words and colour. */
const ANSWERED: Readonly<Record<'yes' | 'partly' | 'no', { label: string; tone: BadgeTone }>> = {
  yes: { label: 'Answered', tone: 'success' },
  partly: { label: 'Partly answered', tone: 'warning' },
  no: { label: 'Not answered', tone: 'danger' },
};

/** Date and time format, in the user's locale. */
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * What the tab says for a call without notes (as the session page).
 *
 * @param call           The call.
 * @param saveTranscript Whether the session saves its transcript.
 * @returns The words.
 */
function emptyText(call: CallView, saveTranscript: boolean): string {
  if (call.notesState === 'skipped') return 'No notes — nothing was heard.';
  if (call.notesState === 'writing') return 'Writing the notes…';
  if (call.notesState === 'failed') {
    if (call.record?.notesError === 'lines-lost') {
      return 'The notes could not be written: the call window closed before they were done, and the transcript was not saved.';
    }
    return notesFailureText(notesUnavailableOf(call.record?.notesError), saveTranscript);
  }
  return 'No notes were written for this call.';
}

/**
 * One titled part of the notes.
 *
 * @param props.title    Its heading.
 * @param props.children Its content.
 * @returns The part.
 * Rendered by: NotesTab
 */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ui-muted">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The AI notes tab.
 *
 * @param props See NotesTabProps.
 * @returns The tab's content.
 * Rendered by: CallPane.tsx
 */
export function NotesTab({ session, call, onChanged }: NotesTabProps) {
  const [writing, setWriting] = useState(false);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const named = withTheirName(session, call.record);
  const them = theirLabel(named);
  // ADR-0093: the notes read with the call's current name for the other person.
  const notes = call.notes
    ? relabelNotes(call.notes.notes, call.notes.writtenTheirName, them)
    : null;
  const canWrite = call.lines.length > 0 || call.answers.length > 0;

  /** Writes this call's notes again; the other calls' notes never change. */
  async function rewrite() {
    setWriting(true);
    setStatus({ text: 'Writing the notes…', failed: false });
    const review = await loadReview(session.id).catch(() => null);
    if (!review) {
      setWriting(false);
      setStatus({ text: 'The session could not be read. Reload the page.', failed: true });
      return;
    }
    const outcome = await regenerateCallNotes(review, call);
    setWriting(false);
    if (outcome.status === 'saved') {
      setStatus({ text: 'The new notes are saved.', failed: false });
      onChanged();
    } else if (outcome.status === 'skipped') {
      setStatus({ text: 'Nothing was saved from this call to write notes from.', failed: true });
    } else {
      setStatus({ text: notesFailureText(outcome.unavailable, false), failed: true });
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-card border border-ui-border bg-ui-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-[18px] font-semibold text-ui-heading">AI notes</h2>
          {call.notes && (
            <p className="text-[12px] text-ui-muted">
              Written {DATE_TIME.format(call.notes.createdAt)}
              {call.notes.fromAnswersOnly ? ' · from answers only' : ''}
            </p>
          )}
          {/* ADR-0121: the reply reached its length limit; what is shown is complete up to there. */}
          {call.notes?.notes.cutOff && (
            <p
              role="note"
              aria-label="Notes stop early"
              className="mt-1 text-[12px] text-ui-warning"
            >
              {NOTES_CUT_OFF_TEXT}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void rewrite()}
          disabled={writing || !canWrite}
        >
          {writing ? 'Writing…' : notes ? 'Rewrite notes' : 'Write the notes'}
        </Button>
      </div>
      {status && (
        <p
          role={status.failed ? 'alert' : 'status'}
          className={`text-[13px] ${status.failed ? 'text-ui-warning' : 'text-ui-muted'}`}
        >
          {status.text}
        </p>
      )}

      {!notes ? (
        <p className="text-[13px] text-ui-muted">
          {canWrite
            ? emptyText(call, session.saveTranscript)
            : 'Nothing was saved from this call to write notes from.'}
        </p>
      ) : (
        <>
          <Part title="Summary">
            <ul className="list-disc space-y-1.5 pl-5 text-[14px] text-ui-text">
              {notes.summary.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </Part>

          {notes.questions.length > 0 && (
            <Part
              title={
                them === THEM_LABEL || them === INTERVIEWER_LABEL
                  ? 'Questions'
                  : `Questions from ${them}`
              }
            >
              <ul className="flex flex-col divide-y divide-ui-border rounded-control border border-ui-border">
                {notes.questions.map((question, index) => {
                  const answered = ANSWERED[question.answered];
                  return (
                    <li
                      key={index}
                      className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5"
                    >
                      <span className="w-12 shrink-0 pt-0.5 text-[12px] tabular-nums text-ui-muted">
                        {formatCallTime(question.at)}
                      </span>
                      <span className="min-w-0 flex-1 text-[14px] text-ui-text">
                        {question.question}
                      </span>
                      <Badge tone={answered.tone}>{answered.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </Part>
          )}

          {notes.nextSteps.length > 0 && (
            <Part title="Next steps">
              <ul className="flex flex-col gap-1.5 text-[14px] text-ui-text">
                {notes.nextSteps.map((step, index) => (
                  <li key={index} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ui-accent-fill"
                    />
                    <span>
                      {step.step}
                      {step.owner && <span className="text-ui-muted"> — {step.owner}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Part>
          )}

          {notes.unclear.length > 0 && (
            <Part title="Unclear parts">
              <ul className="flex flex-col gap-1 text-[13px] text-ui-text">
                {notes.unclear.map((part, index) => (
                  <li key={index}>
                    <span className="tabular-nums text-ui-muted">
                      {formatCallTime(part.from)}–{formatCallTime(part.to)}
                    </span>{' '}
                    {part.reason}
                  </li>
                ))}
              </ul>
            </Part>
          )}
        </>
      )}
    </div>
  );
}
