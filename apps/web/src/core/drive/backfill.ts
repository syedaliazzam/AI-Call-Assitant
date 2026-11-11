/**
 * File: apps/web/src/core/drive/backfill.ts
 * Purpose: "Upload to Drive" for a session this device never saved (1.6.0, ADR-0072): works out its
 *          calls from what it kept (transcript lines, answers, notes and recording records; a call is
 *          split where nothing happened for 30 minutes, and starts at the exact time an answer or the
 *          notes recorded, so the notes PDF matches its call), queues them, and marks the session as
 *          emailed by hand only (an old call never emails the team by itself).
 * Used by: src/features/drive/DriveSessionStatus.tsx
 * Depends on: src/core/storage (utterances, answers, notes, recordings, driveUploads, migrate),
 *             src/core/drive/queue.ts
 * Architecture: ADR-0072
 */
import { listAnswers } from '../storage/answers';
import { getDriveJob, putDriveJob, queueDriveCall } from '../storage/driveUploads';
import { findCalls } from '../storage/migrate';
import { getNotes } from '../storage/notes';
import { listRecordings } from '../storage/recordings';
import type {
  DriveCall,
  StoredAnswer,
  StoredNotes,
  StoredRecording,
  StoredUtterance,
} from '../storage/types';
import { listUtterances } from '../storage/utterances';
import { announceDrive } from './queue';

/** A known call start may sit this long before the first thing it holds (connecting), ms. */
const START_SLACK_MS = 5_000;

/**
 * A session's calls from what it kept.
 *
 * @param data.lines      Its transcript lines.
 * @param data.answers    Its answers.
 * @param data.notes      Its notes, or null.
 * @param data.recordings Its recording records.
 * @returns The calls, oldest first (none when nothing was kept).
 * Called from: uploadSessionToDrive(); tests
 */
export function inferCalls(data: {
  lines: readonly StoredUtterance[];
  answers: readonly StoredAnswer[];
  notes: StoredNotes | null;
  recordings: readonly StoredRecording[];
}): DriveCall[] {
  const known = [
    ...data.answers.flatMap((answer) =>
      answer.callStartedAt !== undefined ? [answer.callStartedAt] : [],
    ),
    ...(data.notes ? [data.notes.callStartedAt] : []),
  ];
  const times = [
    ...data.lines.flatMap((line) => [line.tStart, line.tEnd]),
    ...data.answers.map((answer) => answer.createdAt),
    ...data.recordings.flatMap((recording) => [
      recording.startedAt,
      recording.startedAt + recording.durationMs,
    ]),
    ...known,
  ];
  const calls: DriveCall[] = [];
  for (const span of findCalls(times)) {
    // Each exact start inside the span begins a call; anything clearly before the first one is a call
    // of its own (its start not recorded).
    const starts = [...new Set(known.filter((at) => at >= span.start && at <= span.end))].sort(
      (a, b) => a - b,
    );
    if (starts.length === 0 || span.start < starts[0]! - START_SLACK_MS) starts.unshift(span.start);
    starts.forEach((startedAt, index) => {
      const next = starts[index + 1];
      calls.push({ startedAt, endedAt: next !== undefined ? next - 1 : span.end });
    });
  }
  return calls;
}

/**
 * Queues a session this device never saved, for Drive, and wakes the uploader. Its email is sent by
 * hand ("Send email" in Settings), never by itself.
 *
 * @param sessionId The session.
 * @returns How many calls were queued (0: nothing was kept to upload).
 * Called from: features/drive/DriveSessionStatus.tsx ("Upload to Drive")
 */
export async function uploadSessionToDrive(sessionId: string): Promise<number> {
  const [lines, answers, notes, recordings] = await Promise.all([
    listUtterances(sessionId),
    listAnswers(sessionId),
    getNotes(sessionId),
    listRecordings(),
  ]);
  const calls = inferCalls({
    lines,
    answers,
    notes,
    recordings: recordings.filter((recording) => recording.sessionId === sessionId),
  });
  for (const call of calls) await queueDriveCall(sessionId, call);
  const job = await getDriveJob(sessionId);
  if (job) await putDriveJob({ ...job, manualEmail: true });
  if (calls.length > 0) announceDrive('queued');
  return calls.length;
}
