/**
 * File: apps/web/src/core/storage/callNotes.ts
 * Purpose: Each call's AI notes (ADR-0077; the `callNotes` store, version 12, synced as 'callNotes'). The
 *          older `notes` store (one per session, notes.ts) stays as it is, read-only, for calls made before.
 *          Deleting the session deletes them (sessions.ts).
 * Used by: src/core/live/afterCall.ts (after a call), src/core/review/calls.ts and the session page
 *          (Regenerate), src/core/drive/callFiles.ts (the notes PDF)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: ADR-0077
 *
 * Notes text is never logged.
 */
import { getDb } from './db';
import type { StoredCallNotes } from './types';

/**
 * Saves a call's notes, replacing earlier ones of the same call.
 *
 * @param notes The notes.
 * @returns When saved.
 * Called from: core/live/afterCall.ts, core/notes/regenerate.ts; tests
 */
export async function saveCallNotes(notes: StoredCallNotes): Promise<void> {
  await getDb().callNotes.put(notes);
}

/**
 * One call's notes.
 *
 * @param callId The call.
 * @returns The notes, or null.
 * Called from: core/drive/callFiles.ts; tests
 */
export async function getCallNotes(callId: string): Promise<StoredCallNotes | null> {
  return (await getDb().callNotes.get(callId)) ?? null;
}

/**
 * Every call's notes in a session.
 *
 * @param sessionId The session.
 * @returns The notes (any order).
 * Called from: core/review/calls.ts; tests
 */
export async function listCallNotes(sessionId: string): Promise<StoredCallNotes[]> {
  return getDb().callNotes.where('sessionId').equals(sessionId).toArray();
}
