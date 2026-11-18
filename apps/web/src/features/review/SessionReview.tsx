/**
 * File: apps/web/src/features/review/SessionReview.tsx
 * Purpose: The session window (Day 5 Stage 6, parity Phase 3): a side menu of four sections, AI
 *          notes with Regenerate, the Transcript with Kite's answers inline, Ask AI, and Call
 *          details; and Delete session (confirmed in an in-app dialog). Everything is read from
 *          this device. ADR-0077: the session's calls are listed first, newest first; the notes,
 *          transcript and details are the picked call's own (the newest by default). With account sync
 *          it waits for the first pull ("Syncing…") and reads again after every pull, and while a call's
 *          notes are being written it pulls every few seconds, so a call finished elsewhere shows up.
 *          Batch D (P1-F, ADR-0079): Call details lists "Words Paramount AI listens for" (the session's
 *          keyterms, core/stt/sessionHotwords.ts buildKeyterms), with a link to edit the Key terms.
 * Used by: src/features/review/ReviewPage.tsx; tests/integration/harness/review.tsx
 * Depends on: next/link, src/core/review/load.ts, src/core/notes/regenerate.ts,
 *             src/core/answer/unavailable.ts (notesFailureText), src/core/storage/sessions.ts
 *             (deleteSession), src/features/review/ReviewSections.tsx,
 *             src/features/review/ConversationSection.tsx, src/features/review/AskSection.tsx,
 *             src/features/session-setup/labels.ts, src/ui (Button, Dialog)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review), §7.4;
 *               day-05-overlay-screenshots-notes.md Stage 6
 *
 * Takes onDeleted instead of using the router, so the integration harness can render it
 * without Next.js; ReviewPage.tsx passes the router's "go to the dashboard".
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { notesFailureText } from '@/core/answer/unavailable';
import { notesUnavailableOf } from '@/core/live/afterCall';
import { regenerateCallNotes } from '@/core/notes/regenerate';
import type { CallView } from '@/core/review/calls';
import { loadReview, type ReviewData } from '@/core/review/load';
import { refreshRenamedCall } from '@/core/drive/renamedCall';
import { updateCall } from '@/core/storage/calls';
import { deleteSession, updateSession } from '@/core/storage/sessions';
import { pullAccountSync } from '@/core/sync/client';
import { buildKeyterms } from '@/core/stt/sessionHotwords';
import { onSyncApplied } from '@/core/sync/events';
import { displayTerms } from '@/core/transcript/display';
import { relabelNotes, theirLabel, withTheirName } from '@/core/transcript/theirName';
import { modelEntry } from '@/core/session/modelChoices';
import { useAccountName } from '@/features/shell/AccountName';
import {
  FORMAT_OPTIONS,
  LENGTH_OPTIONS,
  SESSION_TYPE_LABELS,
  TONE_OPTIONS,
} from '@/features/session-setup/labels';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';
import { AskSection } from './AskSection';
import { CallsList, callDriveText, callLengthText, callNotesText } from './CallsList';
import { ConversationSection } from './ConversationSection';
import { NotesSection } from './ReviewSections';

/** The session window's sections. */
type SectionName = 'notes' | 'transcript' | 'ask' | 'details';

/** The side menu, in order. */
const SECTIONS: readonly { value: SectionName; label: string }[] = [
  { value: 'notes', label: 'AI notes' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'ask', label: 'Ask AI' },
  { value: 'details', label: 'Call details' },
];

/** Props for SessionReview. */
export interface SessionReviewProps {
  /** The session to review (from the URL). */
  sessionId: string;
  /** Called after the session was deleted (the page goes back to the dashboard). */
  onDeleted: () => void;
  /** Batch D (P1-F): the signed-in user's first name (one of the words listened for); default none. */
  accountFirstName?: string;
}

/** Date and time format, in the user's locale (for example "28 Oct 2026, 14:05"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** ADR-0077: while a call's notes are being written, how often the page looks again, ms. */
const PENDING_REFRESH_MS = 10_000;

/** ADR-0077: how a call was transcribed, in words. */
const ENGINE_LABELS: Readonly<Record<'deepgram' | 'local' | 'mixed', string>> = {
  deepgram: 'Cloud (Deepgram)',
  local: 'On this computer',
  mixed: 'Cloud, with on-device fallback',
};

/**
 * ADR-0077: what the notes section says for a call without notes.
 *
 * @param call           The call (null: the session has none).
 * @param saveTranscript Whether the session saves its transcript.
 * @returns The words, or undefined for the section's own.
 * Called from: SessionReview
 */
function notesEmptyText(call: CallView | null, saveTranscript: boolean): string | undefined {
  if (!call || call.notes) return undefined;
  if (call.notesState === 'skipped') return 'No notes — nothing was heard.';
  if (call.notesState === 'writing') return 'Writing the notes…';
  if (call.notesState === 'failed') {
    if (call.record?.notesError === 'lines-lost') {
      return 'The notes could not be written: the call window closed before they were done, and the transcript was not saved.';
    }
    return notesFailureText(notesUnavailableOf(call.record?.notesError), saveTranscript);
  }
  return undefined;
}

/**
 * ADR-0077: whether a call is still being finished (running, or its notes not written yet), so the page
 * keeps looking for it.
 *
 * @param call The call.
 * @returns True while it is.
 */
function stillFinishing(call: CallView): boolean {
  return call.record !== null && (call.record.phase !== 'ended' || call.notesState === 'writing');
}

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
export function SessionReview({ sessionId, onDeleted, accountFirstName = '' }: SessionReviewProps) {
  // undefined while loading, null when this device has no such session.
  const [review, setReview] = useState<ReviewData | null | undefined>(undefined);
  const [notesState, setNotesState] = useState<NotesState>({
    writing: false,
    status: '',
    failed: false,
  });
  const [section, setSection] = useState<SectionName>('notes');
  // ADR-0077: the call shown (null: the newest), and whether the first sync pull is still running.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // ADR-0093: what happened to the Drive files after the last rename of a call.
  const [renameStatus, setRenameStatus] = useState<string | null>(null);
  const accountName = useAccountName();

  /** Reads the session's data again (after Regenerate). */
  const reload = useCallback(async () => {
    setReview(await loadReview(sessionId).catch(() => null));
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      loadReview(sessionId)
        .catch(() => null)
        .then((data) => {
          if (!cancelled) setReview(data);
        });
    // ADR-0077: the account's newest data first (a call ended on another device), then this device's
    // copy; and again after every pull.
    void (async () => {
      setSyncing(true);
      await pullAccountSync().catch(() => undefined);
      if (cancelled) return;
      setSyncing(false);
      await load();
    })();
    const stop = onSyncApplied(() => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionId]);

  // ADR-0077: while a call is still being finished (here or on another device), look again every few
  // seconds, so its notes appear without a reload.
  const finishing = review?.calls.some(stillFinishing) ?? false;
  useEffect(() => {
    if (!finishing) return;
    const timer = window.setInterval(() => {
      void (async () => {
        await pullAccountSync().catch(() => undefined);
        setReview(await loadReview(sessionId).catch(() => null));
      })();
    }, PENDING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [finishing, sessionId]);

  /** Writes the shown call's notes again from what was saved; replaces that call's notes only. */
  async function regenerate() {
    const call = review?.calls.find((one) => one.id === selectedId) ?? review?.calls[0];
    if (!review || !call) return;
    setNotesState({ writing: true, status: 'Writing the notes…', failed: false });
    const outcome = await regenerateCallNotes(review, call);
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

  /**
   * ADR-0093: renames the other person for the shown call, for the whole call: its turns, its notes (shown
   * with the new name, no new notes request), its downloads, and its Drive transcript and notes PDFs,
   * which are made again and replaced when the call is already saved to Drive. A call made before call
   * records (no record to keep the name) renames the session's contact instead, as before.
   *
   * @param name The new name ('' goes back to the session's name, else the fallback label).
   */
  async function renameCall(name: string) {
    const call = review?.calls.find((one) => one.id === selectedId) ?? review?.calls[0];
    if (!review || !call) return;
    setRenameStatus(null);
    if (!call.record) {
      await updateSession(review.session.id, { contactName: name }).catch(() => undefined);
      await reload();
      return;
    }
    await updateCall(call.id, { themName: name || undefined }).catch(() => false);
    await reload();
    if (call.record.drive.state !== 'done') return;
    setRenameStatus('Updating the transcript and notes in Google Drive…');
    const outcome = await refreshRenamedCall(review.session.id, call.id, accountName);
    setRenameStatus(
      outcome === 'replaced'
        ? 'The transcript and notes in Google Drive now use the new name.'
        : outcome === 'failed'
          ? 'The files in Google Drive could not be updated. Rename again to retry.'
          : null,
    );
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
    return (
      <p className="px-4 py-8 text-[15px] text-ui-muted sm:px-8">
        {syncing ? 'Syncing…' : 'Loading the session…'}
      </p>
    );
  }
  if (review === null) {
    return (
      <div className="px-4 py-8 sm:px-8">
        <h1 className="text-[24px] font-semibold text-ui-heading">Session not found</h1>
        <p className="mt-2 max-w-prose text-[15px] text-ui-muted">
          This session is not on this computer. Sessions are stored on the device they were created
          on.
        </p>
        <LinkButton href="/" className="mt-4">
          Back to the dashboard
        </LinkButton>
      </div>
    );
  }

  const { session } = review;
  const title = session.company || 'Untitled session';
  const style = session.preferences.style;
  // ADR-0077: the shown call (the newest unless another was picked), and its own data.
  const call = review.calls.find((one) => one.id === selectedId) ?? review.calls[0] ?? null;
  const lines = call?.lines ?? [];
  const answers = call?.answers ?? [];
  // ADR-0093: the session as the shown call reads it (the call's name for the other person wins), and its
  // notes with that name in place of the one they were written with.
  const named = call ? withTheirName(session, call.record) : session;
  const notes = call?.notes
    ? {
        ...call.notes,
        notes: relabelNotes(call.notes.notes, call.notes.writtenTheirName, theirLabel(named)),
      }
    : null;
  const drive = call ? callDriveText(call) : null;
  // Batch D (P1-F): the words cloud transcription is told to listen for in this session's calls (the same
  // list the call sends), so missing names can be added under Key terms.
  const listensFor = buildKeyterms(session, review.documents, { accountFirstName });

  return (
    <PageShell
      showTitle
      title={title}
      description={session.role}
      width="lg"
      actions={
        <>
          <LinkButton href="/" variant="ghost">
            Dashboard
          </LinkButton>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete session
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <CallsList
          calls={review.calls}
          selectedId={call?.id ?? null}
          onSelect={(id) => {
            setSelectedId(id);
            setNotesState({ writing: false, status: '', failed: false });
          }}
        />
      </div>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <nav
          aria-label="Session sections"
          className="flex shrink-0 flex-wrap gap-1 md:w-40 md:flex-col"
        >
          {SECTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-current={section === item.value ? 'page' : undefined}
              onClick={() => setSection(item.value)}
              className={[
                'border px-3 py-2 text-left text-[15px] font-medium focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11',
                section === item.value
                  ? 'border-transparent bg-ui-subtle text-ui-heading'
                  : 'border-transparent text-ui-muted hover:bg-ui-surface',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {section === 'details' && (
            <section
              aria-label="Call details"
              className="border border-ui-border rounded-card bg-ui-surface shadow-card p-5"
            >
              <h2 className="text-[18px] font-semibold text-ui-heading">Call details</h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                <div>
                  <dt className="text-[13px] text-ui-muted">Type</dt>
                  <dd>{SESSION_TYPE_LABELS[session.type]}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ui-muted">Created</dt>
                  <dd>{DATE_FORMAT.format(session.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ui-muted">This call</dt>
                  <dd>
                    {call
                      ? `${DATE_FORMAT.format(call.startedAt)} · ${
                          call.record?.phase === 'live'
                            ? 'in progress'
                            : callLengthText(call.durationMs)
                        }`
                      : 'No call yet'}
                  </dd>
                </div>
                {call && (
                  <div>
                    <dt className="text-[13px] text-ui-muted">Notes</dt>
                    <dd>{callNotesText(call)}</dd>
                  </div>
                )}
                {call?.record?.sttEngine && (
                  <div>
                    <dt className="text-[13px] text-ui-muted">Transcription</dt>
                    <dd>{ENGINE_LABELS[call.record.sttEngine]}</dd>
                  </div>
                )}
                {drive && (
                  <div>
                    <dt className="text-[13px] text-ui-muted">Google Drive</dt>
                    <dd>{drive}</dd>
                  </div>
                )}
                {call && (
                  <div>
                    <dt className="text-[13px] text-ui-muted">Recordings</dt>
                    <dd>
                      {call.recordings.length === 0 ? (
                        'None'
                      ) : (
                        <ul aria-label="Recordings of this call">
                          {call.recordings.map((part) => (
                            <li key={part.id}>
                              Part {part.part} (
                              {part.kind === 'screen' ? 'screen and sound' : 'sound'},{' '}
                              {callLengthText(part.durationMs)}) · Saved on {part.deviceName}
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-[13px] text-ui-muted">Answers</dt>
                  <dd>
                    {/* ADR-0099: a Gemini or GPT model by its own name. */}
                    {modelEntry(session.preferences.model).title};{' '}
                    {labelOf(FORMAT_OPTIONS, style.format)},{' '}
                    {labelOf(LENGTH_OPTIONS, style.length).toLowerCase()},{' '}
                    {labelOf(TONE_OPTIONS, style.tone).toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ui-muted">Documents</dt>
                  <dd>
                    {review.documents.length === 0
                      ? 'None'
                      : review.documents.map((document) => document.name).join(', ')}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ui-muted">Save transcript</dt>
                  <dd>{session.saveTranscript ? 'On' : 'Off'}</dd>
                </div>
              </dl>
              {session.description && (
                <p className="mt-3 text-[13px] text-ui-text">{session.description}</p>
              )}
              {/* Batch D (P1-F): what cloud transcription listens for; edited through Key terms. */}
              <div className="mt-4 border-t border-ui-border pt-3">
                <h3 className="text-[15px] font-semibold text-ui-heading">
                  Words Paramount AI listens for
                </h3>
                <p className="mt-1 text-[13px] text-ui-muted">
                  Names and terms transcription is told to expect. Your Key terms come first; add
                  any name it gets wrong there.
                </p>
                {listensFor.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ui-text">None yet.</p>
                ) : (
                  <ul
                    aria-label="Words Paramount AI listens for"
                    className="mt-2 flex flex-wrap gap-1.5"
                  >
                    {listensFor.map((term) => (
                      <li
                        key={term}
                        className="rounded-full border border-ui-border px-2 py-0.5 text-[13px] text-ui-text"
                      >
                        {term}
                      </li>
                    ))}
                  </ul>
                )}
                <LinkButton
                  href={`/sessions/${session.id}/edit`}
                  variant="secondary"
                  className="mt-3"
                >
                  Edit key terms
                </LinkButton>
              </div>
            </section>
          )}

          {section === 'notes' && (
            <NotesSection
              notes={notes}
              canWrite={lines.length > 0 || answers.length > 0}
              {...(notesEmptyText(call, session.saveTranscript)
                ? { emptyText: notesEmptyText(call, session.saveTranscript) }
                : {})}
              writing={notesState.writing}
              status={notesState.status}
              failed={notesState.failed}
              onRegenerate={() => void regenerate()}
              sessionId={session.id}
              sessionType={session.type}
              lessonDecisions={review.lessonDecisions}
              onLessonsChanged={() => void reload()}
            />
          )}
          {section === 'transcript' && (
            <ConversationSection
              session={named}
              lines={lines}
              answers={answers}
              terms={displayTerms(session)}
              onChanged={() => void reload()}
              onRename={(name) => void renameCall(name)}
              renameStatus={renameStatus}
            />
          )}
          {section === 'ask' && <AskSection review={review} />}
        </div>
      </div>

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
          <p role="alert" className="mt-2 text-[13px] text-ui-danger">
            The session could not be deleted. Try again.
          </p>
        )}
      </Dialog>
    </PageShell>
  );
}
