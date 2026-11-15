/**
 * File: apps/web/src/core/storage/wipe.ts
 * Purpose: "Delete all local data": deletes the signed-in account's own IndexedDB database on this
 *          device (the database the page uses, core/storage/db.ts; other accounts' databases and the old
 *          shared 'kite' one are not touched)
 *          (sessions, documents, transcripts, answers, notes, the Resume and Document
 *          libraries, Ask Kite chats, and the default preferences in the settings store) and reports how much was removed.
 * Used by: the Settings page (Day 3 Stage 3)
 * Depends on: src/core/storage/db.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (privacy), §8.1;
 *               day-03-sessions.md Stage 1; ADR-0024
 *
 * The speech-model cache (Cache Storage "kite-stt-v2", core/stt/download.ts) is deliberately
 * left alone: it holds only the public, checksum-pinned model files (no personal data), and
 * deleting it would make the next call download 204 MB again.
 */
import { forgetDb, getDb } from './db';

/** How many rows deleteAllLocalData() removed, per store. */
export interface DeletedCounts {
  /** Sessions removed. */
  sessions: number;
  /** Documents removed. */
  documents: number;
  /** Saved transcript lines removed. */
  utterances: number;
  /** Answers removed. */
  answers: number;
  /** Notes removed. */
  notes: number;
  /** Lesson decisions removed (Day 5 Stage 7): approved lessons are forgotten too. */
  lessons: number;
  /** Library items removed (Resumes and Documents, parity Phase 2). */
  library: number;
  /** Question banks removed (parity Phase 4). */
  questionBanks: number;
  /** Ask Kite chats removed (ADR-0030). */
  chats: number;
}

/**
 * Deletes Kite's local database and everything in it. The next use of the storage modules
 * creates a new, empty database.
 *
 * Other open Kite tabs: Dexie closes their connection when the database is deleted, so the
 * deletion is not blocked; those tabs see an empty database on their next query.
 *
 * @returns How many rows each store had (counted just before the deletion).
 * Called from: the Settings page's "Delete all local data" (Day 3 Stage 3); tests
 */
export async function deleteAllLocalData(): Promise<DeletedCounts> {
  const db = getDb();
  const counts: DeletedCounts = {
    sessions: await db.sessions.count(),
    documents: await db.documents.count(),
    utterances: await db.utterances.count(),
    answers: await db.answers.count(),
    notes: await db.notes.count(),
    lessons: await db.lessons.count(),
    library: await db.library.count(),
    questionBanks: await db.questionBanks.count(),
    chats: await db.chats.count(),
  };
  await db.delete();
  forgetDb();
  return counts;
}
