/**
 * File: apps/web/src/core/storage/notes.ts
 * Purpose: Save and read a session's call notes on this device (one set per session: the
 *          latest call's). Deleting the session deletes them (sessions.ts).
 * Used by: src/core/notes/generate.ts (saves after a call); the review page (Day 5 Stage 6)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (notes), §8.1;
 *               day-05-overlay-screenshots-notes.md Stage 5
 *
 * Notes text is never logged. Proposed lessons inside them are suggestions only.
 */
import { getDb } from './db';
import type { StoredNotes } from './types';

/**
 * Saves a session's notes, replacing earlier ones (the latest call's notes are kept).
 *
 * @param notes The notes.
 * Called from: generateNotes() in core/notes/generate.ts; tests
 */
export async function saveNotes(notes: StoredNotes): Promise<void> {
  await getDb().notes.put(notes);
}

/**
 * Reads a session's notes.
 *
 * @param sessionId The session id.
 * @returns The notes, or null when none were written yet.
 * Called from: the review page (Stage 6); tests
 */
export async function getNotes(sessionId: string): Promise<StoredNotes | null> {
  return (await getDb().notes.get(sessionId)) ?? null;
}
