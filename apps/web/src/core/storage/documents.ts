/**
 * File: apps/web/src/core/storage/documents.ts
 * Purpose: Store, list and remove a session's documents (their extracted text, never the
 *          original file) on this device, and add up their size for the character cap.
 * Used by: the Create/Edit session wizard (Day 3 Stage 3), the warm-up (Stage 5)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4, §8.1; day-03-sessions.md
 *               Stage 1
 *
 * Document text is the user's content and is never logged. The character cap itself is checked
 * by core/documents/limits.ts (Stage 2) before a document is added.
 */
import { joinDocumentParts } from '../documents/parts';
import { getDb } from './db';
import { liveQuery } from 'dexie';
import type { Session, StoredDocument } from './types';

/** What addDocument() needs. */
export interface NewDocumentInput {
  /** The session the document belongs to. */
  sessionId: string;
  /** Original file name, for example 'pricing.pdf'. */
  name: string;
  /** The extracted plain text. */
  text: string;
}

/**
 * Stores a document's text for a session.
 *
 * @param input The session, file name and extracted text.
 * @param now   Time added, in Unix ms (tests pass a fixed time).
 * @returns The stored document, with its id and character count.
 * @throws Error('SESSION_NOT_FOUND') when the session does not exist (nothing is stored).
 * Called from: the Create/Edit session wizard (Day 3 Stage 3); tests
 */
export async function addDocument(
  input: NewDocumentInput,
  now = Date.now(),
): Promise<StoredDocument> {
  const db = getDb();
  return db.transaction('rw', db.sessions, db.documents, async () => {
    // Checked inside the transaction, so a session deleted at the same moment cannot end up
    // with an orphan document.
    if (!(await db.sessions.get(input.sessionId))) throw new Error('SESSION_NOT_FOUND');
    const document: StoredDocument = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      name: input.name,
      text: input.text,
      chars: input.text.length,
      addedAt: now,
    };
    await db.documents.add(document);
    return document;
  });
}

/**
 * Lists a session's documents, oldest first (the order they were added).
 *
 * @param sessionId The session id.
 * @returns The documents ([] when there are none).
 * Called from: the wizard, the live screen and the warm-up (Day 3 Stages 3–5); tests
 */
export async function listDocuments(sessionId: string): Promise<StoredDocument[]> {
  // 1.5.1 (ADR-0069): the parts of a long document come back as one document.
  return joinDocumentParts(
    await getDb().documents.where('sessionId').equals(sessionId).sortBy('addedAt'),
  );
}

/**
 * Batch C (P1-3): keeps a session and its documents up to date while its live screen is open. Dexie reports
 * a change made in any window of this browser profile (the session edited, a document added) and by account
 * sync, so the call can update its keyterms and document parts without reconnecting.
 *
 * @param sessionId The session id.
 * @param onChange  Called with the session (null once deleted) and its documents, now and after every change.
 * @returns A function that stops watching.
 * Called from: LiveSession.tsx; tests
 */
export function watchSessionDocuments(
  sessionId: string,
  onChange: (session: Session | null, documents: StoredDocument[]) => void,
): () => void {
  const subscription = liveQuery(async () => {
    const [session, documents] = await Promise.all([
      getDb().sessions.get(sessionId),
      listDocuments(sessionId),
    ]);
    return { session: session ?? null, documents };
  }).subscribe({
    next: ({ session, documents }) => onChange(session, documents),
    // A read that fails leaves the call with what it loaded: nothing to do.
    error: () => undefined,
  });
  return () => subscription.unsubscribe();
}

/**
 * Removes one document.
 *
 * @param id The document id.
 * @returns True when a document was removed, false when there was none with this id.
 * Called from: the wizard's remove button (Day 3 Stage 3); tests
 */
export async function removeDocument(id: string): Promise<boolean> {
  const db = getDb();
  return db.transaction('rw', db.documents, async () => {
    if (!(await db.documents.get(id))) return false;
    await db.documents.delete(id);
    return true;
  });
}

/**
 * Total size of a session's documents, for the per-session character cap.
 *
 * @param sessionId The session id.
 * @returns The sum of the documents' `chars` (0 when there are none).
 * Called from: the wizard's "room left" display (Day 3 Stage 3); tests
 */
export async function totalChars(sessionId: string): Promise<number> {
  const documents = await listDocuments(sessionId);
  return documents.reduce((sum, document) => sum + document.chars, 0);
}
