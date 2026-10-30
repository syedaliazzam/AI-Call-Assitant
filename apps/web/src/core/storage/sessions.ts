/**
 * File: apps/web/src/core/storage/sessions.ts
 * Purpose: Create, read, list (search and type filter), update and delete call sessions on
 *          this device, and work out the status the dashboard shows (a 'live' session with no
 *          activity for 12 hours is shown as 'ended').
 * Used by: the dashboard, the Create/Edit session wizard and the live screen (Day 3 Stages 3–4)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4, §8.1; day-03-sessions.md
 *               Stage 1
 *
 * Session text (company, role, description, instructions, key terms) is the user's content and
 * is never logged.
 */
import { getDb } from './db';
import type { Session, SessionStatus, SessionType } from './types';

/**
 * How long a 'live' session may go without activity before the dashboard shows it as 'ended':
 * 12 hours. A crash, a closed window or a lost connection never runs the "end call" step, so
 * without this a session would stay "live" forever. 12 hours is longer than any real call.
 */
export const STALE_LIVE_MS = 12 * 60 * 60 * 1000;

/** What createSession() needs: everything the wizard collects. */
export type NewSessionInput = Omit<Session, 'id' | 'createdAt' | 'status' | 'lastActiveAt'>;

/** Fields updateSession() may change (the id and creation time never change). */
export type SessionChanges = Partial<Omit<Session, 'id' | 'createdAt'>>;

/** Filters for listSessions(). */
export interface SessionFilter {
  /**
   * Text to look for in company, role and description, ignoring case and surrounding spaces
   * (undefined or '' = no search).
   */
  search?: string;
  /** Only sessions of this type (undefined = all types). */
  type?: SessionType;
}

/** How many rows deleteSession() removed besides the session itself. */
export interface DeletedSessionData {
  /** Documents removed. */
  documents: number;
  /** Saved transcript lines removed. */
  utterances: number;
  /** Answers removed. */
  answers: number;
  /** Notes removed (0 or 1). */
  notes: number;
  /**
   * Rejected lesson decisions removed (Day 5 Stage 7). Approved lessons from the session stay:
   * they are the user's preferences now, managed in Settings.
   */
  rejectedLessons: number;
}

/**
 * Creates and stores a new session (status 'not-started').
 *
 * @param input Everything the wizard collected.
 * @param now   Creation time in Unix ms (tests pass a fixed time).
 * @returns The stored session, with its new id.
 * Called from: the Create session wizard (Day 3 Stage 3); tests
 */
export async function createSession(input: NewSessionInput, now = Date.now()): Promise<Session> {
  const session: Session = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    status: 'not-started',
    lastActiveAt: null,
  };
  await getDb().sessions.add(session);
  return session;
}

/**
 * Reads one session.
 *
 * @param id The session id.
 * @returns The session, or null when there is none with this id (deleted, or created in another
 *          browser or in the desktop app, which have their own data).
 * Called from: the live screen and the Edit wizard (Day 3 Stages 3–4); tests
 */
export async function getSession(id: string): Promise<Session | null> {
  return (await getDb().sessions.get(id)) ?? null;
}

/**
 * Lists sessions, newest first, optionally filtered by type and a search text.
 * The search runs in memory over the (few) sessions of one person; no text index is needed.
 *
 * @param filter Optional search text and type.
 * @returns The matching sessions, newest first.
 * Called from: the dashboard (Day 3 Stage 3); tests
 */
export async function listSessions(filter: SessionFilter = {}): Promise<Session[]> {
  const db = getDb();
  const rows = filter.type
    ? await db.sessions.where('type').equals(filter.type).toArray()
    : await db.sessions.toArray();
  const search = filter.search?.trim().toLowerCase() ?? '';
  return rows
    .filter(
      (session) =>
        search === '' ||
        [session.company, session.role, session.description].some((field) =>
          field.toLowerCase().includes(search),
        ),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Changes some fields of a session.
 *
 * @param id      The session id.
 * @param changes The fields to change.
 * @returns The session after the change.
 * @throws Error('SESSION_NOT_FOUND') when there is no session with this id.
 * Called from: the Edit wizard (Stage 3), the live screen (Stage 4); markSessionActive(); tests
 */
export async function updateSession(id: string, changes: SessionChanges): Promise<Session> {
  const db = getDb();
  return db.transaction('rw', db.sessions, async () => {
    const current = await db.sessions.get(id);
    if (!current) throw new Error('SESSION_NOT_FOUND');
    const next: Session = { ...current, ...changes, id: current.id, createdAt: current.createdAt };
    await db.sessions.put(next);
    return next;
  });
}

/**
 * Records that a session's call is running now: status 'live' and lastActiveAt = now.
 *
 * @param id  The session id.
 * @param now Current time in Unix ms.
 * @returns The updated session.
 * @throws Error('SESSION_NOT_FOUND') when there is no session with this id.
 * Called from: the live screen on Connect and while the call runs (Day 3 Stage 4); tests
 */
export async function markSessionActive(id: string, now = Date.now()): Promise<Session> {
  return updateSession(id, { status: 'live', lastActiveAt: now });
}

/**
 * The status to show for a session. A 'live' session whose last activity (or creation, if it
 * never connected) is more than STALE_LIVE_MS ago is shown as 'ended': the call cannot still be
 * running, its window was probably closed or crashed. The stored status is not changed.
 *
 * @param session The session.
 * @param now     Current time in Unix ms.
 * @returns The status for display.
 * Called from: the dashboard's session cards (Day 3 Stage 3); tests
 */
export function shownStatus(session: Session, now = Date.now()): SessionStatus {
  if (session.status !== 'live') return session.status;
  const lastActive = session.lastActiveAt ?? session.createdAt;
  return now - lastActive > STALE_LIVE_MS ? 'ended' : 'live';
}

/** A document to store with a session: its file name and extracted text. */
export interface DocumentText {
  /** Original file name, for example 'pricing.pdf'. */
  name: string;
  /** The extracted plain text. */
  text: string;
}

/**
 * Creates a session together with its documents in one transaction: either everything is
 * stored or nothing is (a half-created session would show up on the dashboard without its
 * documents).
 *
 * @param input     Everything the wizard collected.
 * @param documents The documents' names and extracted texts, in the order added.
 * @param now       Creation time in Unix ms (tests pass a fixed time).
 * @returns The stored session.
 * Called from: the Create session wizard (Day 3 Stage 3); tests
 */
export async function createSessionWithDocuments(
  input: NewSessionInput,
  documents: readonly DocumentText[],
  now = Date.now(),
): Promise<Session> {
  const db = getDb();
  return db.transaction('rw', db.sessions, db.documents, async () => {
    const session = await createSession(input, now);
    // One millisecond apart, so the documents keep the order they were added in.
    await db.documents.bulkAdd(
      documents.map((document, i) => ({
        id: crypto.randomUUID(),
        sessionId: session.id,
        name: document.name,
        text: document.text,
        chars: document.text.length,
        addedAt: now + i,
      })),
    );
    return session;
  });
}

/**
 * Saves the Edit wizard's changes in one transaction: the session's fields, new documents and
 * removed documents.
 *
 * @param id        The session id.
 * @param changes   Fields to change.
 * @param add       Documents added in the wizard, in the order added.
 * @param removeIds Ids of the session's documents the user removed.
 * @param now       Time of the change in Unix ms (new documents' addedAt).
 * @returns The session after the change.
 * @throws Error('SESSION_NOT_FOUND') when there is no session with this id (nothing changes).
 * Called from: the Edit session wizard (Day 3 Stage 3); tests
 */
export async function updateSessionWithDocuments(
  id: string,
  changes: SessionChanges,
  add: readonly DocumentText[],
  removeIds: readonly string[],
  now = Date.now(),
): Promise<Session> {
  const db = getDb();
  return db.transaction('rw', db.sessions, db.documents, async () => {
    const session = await updateSession(id, changes);
    // Only this session's documents can be removed, whatever ids are passed in.
    const removable = await db.documents
      .where('id')
      .anyOf([...removeIds])
      .filter((document) => document.sessionId === id)
      .primaryKeys();
    await db.documents.bulkDelete(removable);
    await db.documents.bulkAdd(
      add.map((document, i) => ({
        id: crypto.randomUUID(),
        sessionId: id,
        name: document.name,
        text: document.text,
        chars: document.text.length,
        addedAt: now + i,
      })),
    );
    return session;
  });
}

/**
 * Deletes a session and everything stored for it (documents, transcript lines, answers,
 * notes, and its rejected lesson decisions) in one transaction, so a failure part-way leaves
 * nothing half-deleted. Approved lessons it proposed stay (Settings manages them).
 *
 * @param id The session id.
 * @returns How many related rows were removed (all 0 when the session did not exist).
 * Called from: the dashboard's delete button (Day 3 Stage 3); tests
 */
export async function deleteSession(id: string): Promise<DeletedSessionData> {
  const db = getDb();
  return db.transaction(
    'rw',
    [db.sessions, db.documents, db.utterances, db.answers, db.notes, db.lessons],
    async () => {
      const documents = await db.documents.where('sessionId').equals(id).delete();
      const utterances = await db.utterances.where('sessionId').equals(id).delete();
      const answers = await db.answers.where('sessionId').equals(id).delete();
      const notes = (await db.notes.get(id)) ? 1 : 0;
      await db.notes.delete(id);
      const rejectedLessons = await db.lessons
        .where('sourceSessionId')
        .equals(id)
        .filter((lesson) => lesson.status === 'rejected')
        .delete();
      await db.sessions.delete(id);
      return { documents, utterances, answers, notes, rejectedLessons };
    },
  );
}
