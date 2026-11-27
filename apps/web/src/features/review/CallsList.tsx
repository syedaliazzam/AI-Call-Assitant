/**
 * File: apps/web/src/features/review/CallsList.tsx
 * Purpose: The session page's list of calls (ADR-0077): every start of the session is its own call, listed
 *          newest first with its date and time, length, notes state ("No notes — nothing was heard" when
 *          there was nothing to write about), answers, transcript lines, recordings and Google Drive state.
 *          Picking a call shows its notes, transcript and details in the sections below.
 * Used by: src/features/review/SessionReview.tsx
 * Depends on: @kite/shared (driveFolderUrl), src/core/review/calls.ts (CallView), src/core/drive/reasons.ts,
 *             src/core/drive/waitWords.ts (a recorded call's unfinished upload, ADR-0106)
 * Architecture: ADR-0077; docs/architecture/kite-architecture-v3.1.md §5 (Session review)
 *
 * Shows counts and states only; the call's words are in the sections below.
 */
'use client';

import { driveFolderUrl } from '@kite/shared';
import { pendingUpload, UPLOAD_PAUSED_OPEN_APP, WAITING_FOR_DESKTOP } from '@/core/drive/waitWords';
import { driveReasonText } from '@/core/drive/reasons';
import type { CallView } from '@/core/review/calls';

/** A call's date and time, in the user's locale ("13 Nov 2026, 00:49"). */
const CALL_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A call's length: "42 min", "1 h 05 min", "under a minute".
 *
 * @param ms The length, ms.
 * @returns The words.
 * Called from: CallsList, SessionReview.tsx (call details); tests
 */
export function callLengthText(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/**
 * A call's notes, in a few words.
 *
 * @param call The call.
 * @returns For example "Notes", "Writing notes…", "No notes — nothing was heard".
 * Called from: CallsList, SessionReview.tsx; tests
 */
export function callNotesText(call: Pick<CallView, 'notes' | 'notesState'>): string {
  if (call.notes) return call.notes.fromAnswersOnly ? 'Notes (from answers only)' : 'Notes';
  if (call.notesState === 'writing') return 'Writing notes…';
  if (call.notesState === 'skipped') return 'No notes — nothing was heard';
  if (call.notesState === 'failed') return 'Notes could not be written';
  return 'No notes';
}

/**
 * A call's Google Drive state, in a few words (a call made before call records has none).
 *
 * @param call The call.
 * @param now  The clock (Unix ms; ADR-0106: a recorded call's upload silent for a day reads as paused).
 * @returns The words, or null when nothing is known.
 * Called from: CallsList, SessionReview.tsx; tests
 */
export function callDriveText(
  call: Pick<CallView, 'record' | 'recordings'>,
  now: number = Date.now(),
): string | null {
  const drive = call.record?.drive;
  if (!drive) return null;
  // ADR-0106: a recording is only on the computer that made it, so only its desktop app can finish the
  // upload: the words say so, and what to do when that app has not worked on it for a day.
  const recorded = call.record!.recording !== 'off' || call.recordings.length > 0;
  const pending = recorded ? pendingUpload(call.record!, now) : null;
  if (pending === 'stalled') return UPLOAD_PAUSED_OPEN_APP;
  if (pending === 'waiting' && drive.state !== 'paused') return WAITING_FOR_DESKTOP;
  switch (drive.state) {
    case 'waiting':
      return drive.reason ? driveReasonText(drive.reason) : 'Drive: after the notes';
    case 'off':
      return 'Not uploaded to Drive';
    case 'queued':
      // ADR-0131: the same quiet words as the session's status line.
      return 'Uploading…';
    case 'uploading':
      return 'Uploading…';
    case 'paused':
      return 'Uploading… paused for a call';
    case 'done':
      return 'Saved to Drive ✓';
    case 'error':
      return `Upload failed — ${driveReasonText(drive.reason)}`;
  }
}

/**
 * How many of something, in words.
 *
 * @param countOf The number.
 * @param one     The word for one.
 * @param many    The word for several.
 * @returns For example "1 answer", "3 answers".
 */
function count(countOf: number, one: string, many: string): string {
  return `${countOf} ${countOf === 1 ? one : many}`;
}

/** Props for CallsList. */
export interface CallsListProps {
  /** The calls, newest first. */
  calls: readonly CallView[];
  /** The call shown below. */
  selectedId: string | null;
  /**
   * Shows a call below.
   * @param id The call.
   */
  onSelect: (id: string) => void;
}

/**
 * The list.
 *
 * @param props See CallsListProps.
 * @returns The list, or a line when the session has no call yet.
 * Rendered by: SessionReview.tsx
 */
export function CallsList({ calls, selectedId, onSelect }: CallsListProps) {
  return (
    <section
      aria-label="Calls"
      className="border border-ui-border rounded-card bg-ui-surface shadow-card p-5"
    >
      <h2 className="text-[18px] font-semibold text-ui-heading">Calls</h2>
      {calls.length === 0 ? (
        <p className="mt-2 text-[13px] text-ui-muted">No call has been made in this session yet.</p>
      ) : (
        <ul aria-label="Calls, newest first" className="mt-3 flex flex-col gap-2">
          {calls.map((call) => {
            const selected = call.id === selectedId;
            const live = call.record?.phase === 'live';
            const drive = callDriveText(call);
            const folderId = call.record?.drive.folderId;
            return (
              <li key={call.id}>
                <div
                  className={[
                    'flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2',
                    selected ? 'border-ui-accent bg-ui-subtle' : 'border-ui-border',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(call.id)}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                  >
                    <span className="block text-[15px] font-medium text-ui-heading">
                      Call of {CALL_TIME.format(call.startedAt)}
                      <span className="font-normal text-ui-muted">
                        {' · '}
                        {live ? 'in progress' : callLengthText(call.durationMs)}
                      </span>
                    </span>
                    <span className="block text-[13px] text-ui-muted">
                      {[
                        callNotesText(call),
                        count(call.lines.length, 'transcript line', 'transcript lines'),
                        count(call.answers.length, 'answer', 'answers'),
                        ...(call.recordings.length > 0
                          ? [count(call.recordings.length, 'recording part', 'recording parts')]
                          : []),
                      ].join(' · ')}
                    </span>
                  </button>
                  {drive &&
                    (call.record?.drive.state === 'done' && folderId ? (
                      <a
                        href={driveFolderUrl(folderId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-ui-link underline-offset-2 hover:underline"
                      >
                        {drive} ↗
                      </a>
                    ) : (
                      <span className="text-[13px] text-ui-muted">{drive}</span>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
