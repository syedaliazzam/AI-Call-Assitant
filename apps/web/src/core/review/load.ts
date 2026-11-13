/**
 * File: apps/web/src/core/review/load.ts
 * Purpose: Loads everything the session review page shows, from this device's IndexedDB, in
 *          one call: the session, its documents, the saved transcript lines, the answers (with
 *          ratings and notes), the AI notes and the lesson decisions. Also formats call times.
 *          ADR-0077: and the session's calls, newest first, each with its own lines, answers, notes and
 *          recordings (core/review/calls.ts).
 * Used by: src/features/review/SessionReview.tsx; src/core/notes/regenerate.ts (types)
 * Depends on: src/core/storage (sessions, documents, utterances, answers, notes, lessons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review), §7.4;
 *               day-05-overlay-screenshots-notes.md Stage 6
 *
 * Nothing here is logged: the page's content stays on this device.
 */
import { listAnswers } from '../storage/answers';
import { listCallNotes } from '../storage/callNotes';
import { listCalls } from '../storage/calls';
import { listRecordings } from '../storage/recordings';
import { buildCallViews, type CallNotesView, type CallView } from './calls';
import { listDocuments } from '../storage/documents';
import { listLessonsForSession } from '../storage/lessons';
import { getNotes } from '../storage/notes';
import { getSession } from '../storage/sessions';
import type {
  Session,
  StoredAnswer,
  StoredDocument,
  StoredLesson,
  StoredUtterance,
} from '../storage/types';
import { listUtterances } from '../storage/utterances';

/** Everything the review page shows for one session. */
export interface ReviewData {
  /** The session. */
  session: Session;
  /** Its documents. */
  documents: StoredDocument[];
  /** The saved transcript lines, oldest first (none when "Save transcript" was off). */
  lines: StoredUtterance[];
  /** The saved answers, oldest first (kept even when "Save transcript" was off). */
  answers: StoredAnswer[];
  /** The AI notes of the newest call that has notes, or null when none were written (Ask AI reads them). */
  notes: CallNotesView | null;
  /**
   * The user's decisions on lessons this session's notes proposed (Day 5 Stage 7), stored
   * apart from the notes so Regenerate never loses them.
   */
  lessonDecisions: StoredLesson[];
  /** ADR-0077: the session's calls, newest first, each with its own lines, answers, notes and recordings. */
  calls: CallView[];
}

/**
 * Loads a session's review data.
 *
 * @param sessionId The session id (from the URL).
 * @returns The data, or null when this device has no such session.
 * Called from: SessionReview.tsx (on open, after Regenerate, after a sync); tests
 */
export async function loadReview(sessionId: string): Promise<ReviewData | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const [documents, lines, answers, legacyNotes, lessonDecisions, records, callNotes, recordings] =
    await Promise.all([
      listDocuments(sessionId),
      listUtterances(sessionId),
      listAnswers(sessionId),
      getNotes(sessionId),
      listLessonsForSession(sessionId),
      listCalls(sessionId),
      listCallNotes(sessionId),
      listRecordings(),
    ]);
  const calls = buildCallViews({
    sessionId,
    calls: records,
    lines,
    answers,
    callNotes,
    legacyNotes,
    recordings,
    now: Date.now(),
  });
  const notes = calls.find((call) => call.notes)?.notes ?? null;
  return { session, documents, lines, answers, notes, lessonDecisions, calls };
}

/**
 * A time within a call, from seconds since the call connected: "m:ss", or "h:mm:ss" from the
 * first hour on.
 *
 * @param seconds Seconds since the call connected (negative counts as 0).
 * @returns For example "4:05" or "1:02:09".
 * Called from: SessionReview.tsx (notes questions and unclear parts); tests
 */
export function formatCallTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3_600);
  const m = Math.floor((whole % 3_600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
