/**
 * File: apps/web/src/core/review/load.ts
 * Purpose: Loads everything the session review page shows, from this device's IndexedDB, in
 *          one call: the session, its documents, the saved transcript lines, the answers (with
 *          ratings and notes) and the AI notes. Also formats call times for the page.
 * Used by: src/features/review/SessionReview.tsx; src/core/notes/regenerate.ts (types)
 * Depends on: src/core/storage (sessions, documents, utterances, answers, notes)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review), §7.4;
 *               day-05-overlay-screenshots-notes.md Stage 6
 *
 * Nothing here is logged: the page's content stays on this device.
 */
import { listAnswers } from '../storage/answers';
import { listDocuments } from '../storage/documents';
import { getNotes } from '../storage/notes';
import { getSession } from '../storage/sessions';
import type {
  Session,
  StoredAnswer,
  StoredDocument,
  StoredNotes,
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
  /** The AI notes of the latest call, or null when none were written. */
  notes: StoredNotes | null;
}

/**
 * Loads a session's review data.
 *
 * @param sessionId The session id (from the URL).
 * @returns The data, or null when this device has no such session.
 * Called from: SessionReview.tsx (on open, after Regenerate); tests
 */
export async function loadReview(sessionId: string): Promise<ReviewData | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const [documents, lines, answers, notes] = await Promise.all([
    listDocuments(sessionId),
    listUtterances(sessionId),
    listAnswers(sessionId),
    getNotes(sessionId),
  ]);
  return { session, documents, lines, answers, notes };
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
