/**
 * File: apps/web/src/core/storage/db.ts
 * Purpose: Kite's local database on the user's device: one IndexedDB database ("kite") opened
 *          with Dexie, with the stores of architecture §7.4 (sessions, documents, utterances,
 *          answers, notes) and the indexes the dashboard and per-session lookups need.
 * Used by: src/core/storage/sessions.ts, documents.ts, utterances.ts, wipe.ts
 * Depends on: dexie; src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (data model), §8.1;
 *               day-03-sessions.md Stage 1
 *
 * Nothing here is sent anywhere: the data stays on this device. The browser and the desktop app
 * each have their own database (separate browser profiles too).
 *
 * The database opens lazily (getDb()), so importing this module during server rendering never
 * touches IndexedDB, which only exists in the browser.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { Session, StoredAnswer, StoredDocument, StoredNotes, StoredUtterance } from './types';

/** Name of the IndexedDB database. Changing it would orphan every user's existing data. */
export const DB_NAME = 'kite';

/** Kite's IndexedDB database. */
export class KiteDb extends Dexie {
  // `declare`: the tables are created by Dexie in the constructor (version().stores()); a
  // normal class field would emit an extra assignment for them.
  /** Call sessions (one row per session). */
  declare sessions: EntityTable<Session, 'id'>;
  /** Extracted document texts, several per session. */
  declare documents: EntityTable<StoredDocument, 'id'>;
  /** Saved final transcript lines (only for sessions with saveTranscript on). */
  declare utterances: EntityTable<StoredUtterance, 'id'>;
  /** Claude answers. Declared now; written from Day 4. */
  declare answers: EntityTable<StoredAnswer, 'id'>;
  /** AI notes, one per session (keyed by sessionId). Declared now; written from Day 5. */
  declare notes: EntityTable<StoredNotes, 'sessionId'>;

  /**
   * Declares the schema. Only indexed fields are listed (Dexie stores every field of a row);
   * the first entry of each store is its primary key.
   *
   * How to change the schema later: never edit version(1). Add
   * `this.version(2).stores({ …only the stores that change… }).upgrade(tx => …)` below it,
   * where upgrade() rewrites existing rows if a field's meaning changes. Dexie runs it once on
   * each device that still has version 1, so users keep their sessions.
   */
  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      // createdAt: dashboard order (newest first); type: the filter tabs; status: future views.
      sessions: 'id, createdAt, type, status',
      // sessionId: a session's documents, and the cascade delete.
      documents: 'id, sessionId',
      utterances: 'id, sessionId',
      answers: 'id, sessionId',
      // One set of notes per session, so the session id is the key.
      notes: 'sessionId',
    });
  }
}

/** The open database, created on first use; null before that and after forgetDb(). */
let instance: KiteDb | null = null;

/**
 * Returns the database, creating it on first use (Dexie opens it on the first query).
 *
 * @returns The shared KiteDb instance.
 * Called from: the repositories in src/core/storage (sessions, documents, utterances, wipe)
 */
export function getDb(): KiteDb {
  instance ??= new KiteDb();
  return instance;
}

/**
 * Closes and forgets the shared instance, so the next getDb() starts a new one. Used after the
 * database has been deleted, and by tests to start each test with an empty database.
 *
 * Called from: deleteAllLocalData() in wipe.ts; tests
 */
export function forgetDb(): void {
  instance?.close();
  instance = null;
}
