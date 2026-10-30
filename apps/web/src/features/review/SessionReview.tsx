/**
 * File: apps/web/src/features/review/SessionReview.tsx
 * Purpose: The session review page's content (Day 5 Stage 6): call details, the AI notes with
 *          Regenerate, every saved answer with its rating and note, the saved transcript, and
 *          Delete session (confirmed in an in-app dialog). Everything is read from this device.
 * Used by: src/features/review/ReviewPage.tsx; tests/integration/harness/review.tsx
 * Depends on: next/link, src/core/review/load.ts, src/core/notes/regenerate.ts,
 *             src/core/answer/unavailable.ts (notesFailureText), src/core/storage/sessions.ts
 *             (deleteSession), src/features/review/ReviewSections.tsx,
 *             src/features/session-setup/labels.ts, src/ui (Button, Dialog)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review), §7.4;
 *               day-05-overlay-screenshots-notes.md Stage 6
 *
 * Takes onDeleted instead of using the router, so the integration harness can render it
 * without Next.js; ReviewPage.tsx passes the router's "go to the dashboard".
 */
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { notesFailureText } from '@/core/answer/unavailable';
import { regenerateNotes } from '@/core/notes/regenerate';
import { loadReview, type ReviewData } from '@/core/review/load';
import { deleteSession } from '@/core/storage/sessions';
import {
  FORMAT_OPTIONS,
  LENGTH_OPTIONS,
  MODEL_OPTIONS,
  SESSION_TYPE_LABELS,
  TONE_OPTIONS,
} from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { AnswersSection, NotesSection, TranscriptSection } from './ReviewSections';

/** Props for SessionReview. */
export interface SessionReviewProps {
  /** The session to review (from the URL). */
  sessionId: string;
  /** Called after the session was deleted (the page goes back to the dashboard). */
  onDeleted: () => void;
}

/** Date and time format, in the user's locale (for example "28 Oct 2026, 14:05"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The label of a choice.
 *
 * @param options The choices.
 * @param value   The chosen value.
 * @returns Its label, or the value itself when unknown.
 * Called from: SessionReview (call details)
 */
function labelOf<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** The notes writing state on this page. */
interface NotesState {
  /** True while notes are being written. */
  writing: boolean;
  /** The status line ('' for none). */
  status: string;
  /** True when the status reports a failure. */
  failed: boolean;
}

/**
 * The session review.
 *
 * @param props See SessionReviewProps.
 * @returns The page content: loading, "not found", or the review.
 * Rendered by: ReviewPage.tsx; the review harness
 */
export function SessionReview({ sessionId, onDeleted }: SessionReviewProps) {
  // undefined while loading, null when this device has no such session.
  const [review, setReview] = useState<ReviewData | null | undefined>(undefined);
  const [notesState, setNotesState] = useState<NotesState>({
    writing: false,
    status: '',
    failed: false,
  });
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  /** Reads the session's data again (after Regenerate). */
  const reload = useCallback(async () => {
    setReview(await loadReview(sessionId).catch(() => null));
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    loadReview(sessionId)
      .catch(() => null)
      .then((data) => {
        if (!cancelled) setReview(data);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /** Writes the notes again from what was saved; replaces the notes only. */
  async function regenerate() {
    if (!review) return;
    setNotesState({ writing: true, status: 'Writing the notes…', failed: false });
    const outcome = await regenerateNotes(review);
    if (outcome.status === 'saved') {
      setNotesState({ writing: false, status: 'The new notes are saved.', failed: false });
      await reload();
    } else if (outcome.status === 'skipped') {
      setNotesState({
        writing: false,
        status: 'Nothing was saved from this session to write notes from.',
        failed: true,
      });
    } else {
      // On this page there is no "later from the session review" to offer.
      setNotesState({
        writing: false,
        status: notesFailureText(outcome.unavailable, false),
        failed: true,
      });
    }
  }

  /** Deletes the session and everything saved with it, then leaves the page. */
  async function confirmDelete() {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await deleteSession(sessionId);
      setConfirming(false);
      onDeleted();
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  if (review === undefined) {
    return <p className="px-8 py-6 text-sm text-slate-500">Loading the session…</p>;
  }
  if (review === null) {
    return (
      <div className="px-8 py-6">
        <h1 className="text-xl font-semibold text-slate-900">Session not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          This session is not on this computer. Sessions are stored on the device they were created
          on.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700">
          Back to the dashboard
        </Link>
      </div>
    );
  }

  const { session, notes, lines, answers } = review;
  const title = session.company || 'Untitled session';
  const style = session.preferences.style;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-8 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Session review
          </p>
          <h1 className="truncate text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{session.role}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Dashboard
          </Link>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete session
          </Button>
        </div>
      </header>

      <section
        aria-label="Call details"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <h2 className="text-base font-semibold text-slate-900">Call details</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Type</dt>
            <dd>{SESSION_TYPE_LABELS[session.type]}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Created</dt>
            <dd>{DATE_FORMAT.format(session.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Last call started</dt>
            <dd>{notes ? DATE_FORMAT.format(notes.callStartedAt) : 'Not known (no notes yet)'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Answers</dt>
            <dd>
              {labelOf(MODEL_OPTIONS, session.preferences.model)};{' '}
              {labelOf(FORMAT_OPTIONS, style.format)},{' '}
              {labelOf(LENGTH_OPTIONS, style.length).toLowerCase()},{' '}
              {labelOf(TONE_OPTIONS, style.tone).toLowerCase()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Documents</dt>
            <dd>
              {review.documents.length === 0
                ? 'None'
                : review.documents.map((document) => document.name).join(', ')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Save transcript</dt>
            <dd>{session.saveTranscript ? 'On' : 'Off'}</dd>
          </div>
        </dl>
        {session.description && (
          <p className="mt-3 text-sm text-slate-700">{session.description}</p>
        )}
      </section>

      <NotesSection
        notes={notes}
        canWrite={lines.length > 0 || answers.length > 0}
        writing={notesState.writing}
        status={notesState.status}
        failed={notesState.failed}
        onRegenerate={() => void regenerate()}
        sessionId={session.id}
        sessionType={session.type}
        lessonDecisions={review.lessonDecisions}
        onLessonsChanged={() => void reload()}
      />
      <AnswersSection answers={answers} />
      <TranscriptSection lines={lines} saveTranscript={session.saveTranscript} />

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this session?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          “{title}” and everything saved with it on this computer (documents, transcript, answers
          and notes) will be deleted. This cannot be undone. Lessons you approved from it stay in
          Settings.
        </p>
        {deleteFailed && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            The session could not be deleted. Try again.
          </p>
        )}
      </Dialog>
    </div>
  );
}
