/**
 * File: apps/web/src/core/storage/db.ts
 * Purpose: Kite's local database on the user's device: one IndexedDB database ("kite") opened
 *          with Dexie, with the stores of architecture §7.4 (sessions, documents, utterances,
 *          answers, notes; settings from version 2; lessons from version 3) and the indexes the
 *          dashboard and per-session lookups need.
 * Used by: src/core/storage/sessions.ts, documents.ts, utterances.ts, lessons.ts, wipe.ts
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
import { normaliseKeyTerms } from '@kite/shared';
import Dexie, { type EntityTable } from 'dexie';
import {
  callStartOf,
  currentLessonScope,
  currentSessionType,
  currentTone,
  findCalls,
} from './migrate';
import type {
  Session,
  LibraryItem,
  StoredAnswer,
  StoredChat,
  StoredDocument,
  StoredLesson,
  StoredNotes,
  StoredQuestionBank,
  StoredSettings,
  StoredUtterance,
} from './types';

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
  /** App settings on this device (version 2): the default preferences for new sessions. */
  declare settings: EntityTable<StoredSettings, 'id'>;
  /** Lesson decisions, approved or rejected (version 3, Day 5 Stage 7). */
  declare lessons: EntityTable<StoredLesson, 'id'>;
  /** The Resume and Document libraries (version 4, parity Phase 2). */
  declare library: EntityTable<LibraryItem, 'id'>;
  /** Question banks, one per session (version 5, parity Phase 4). */
  declare questionBanks: EntityTable<StoredQuestionBank, 'sessionId'>;
  /** Ask Kite chats (version 6, ADR-0030). */
  declare chats: EntityTable<StoredChat, 'id'>;

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
    // Version 2 (Day 3 Stage 3): adds the settings store (default preferences for new
    // sessions). Only the new store is listed; the version-1 stores carry over unchanged, and
    // no upgrade() is needed because no existing row changes.
    this.version(2).stores({
      settings: 'id',
    });
    // Version 3 (Day 5 Stage 7): adds the lessons store. sourceSessionId: a session's
    // decisions (the review page, and removing rejected ones with the session); status: the
    // approved lessons sent with answers. No existing row changes, so no upgrade().
    this.version(3).stores({
      lessons: 'id, sourceSessionId, status',
    });
    // Version 4 (parity Phase 2): adds the libraries (kind: one library's items), and moves
    // stored values to the new session types and tones (core/storage/migrate.ts). Everything
    // else about a session stays as it was.
    this.version(4)
      .stores({
        library: 'id, kind',
      })
      .upgrade(async (tx) => {
        await tx
          .table<Session, string>('sessions')
          .toCollection()
          .modify((session) => {
            session.type = currentSessionType(session.type);
            session.preferences.style.tone = currentTone(session.preferences.style.tone);
          });
        await tx
          .table<StoredSettings, string>('settings')
          .toCollection()
          .modify((row) => {
            row.defaults.style.tone = currentTone(row.defaults.style.tone);
          });
        await tx
          .table<StoredLesson, string>('lessons')
          .toCollection()
          .modify((lesson) => {
            lesson.scope = currentLessonScope(lesson.scope);
          });
      });
    // Version 5 (parity Phase 4): adds the question banks. No existing row changes.
    this.version(5).stores({
      questionBanks: 'sessionId',
    });
    // Version 6 (ADR-0030): adds the Ask Kite chats (updatedAt: the page's order). No existing row
    // changes: new fields on answers (meta, claims) are optional and not indexed.
    this.version(6).stores({
      chats: 'id, updatedAt',
    });
    // Version 7 (v1.0.1): no new store. Key terms pasted as one comma-separated line were stored
    // as one over-long term; rewrite every session's key terms as one clean term per line (split on
    // commas, semicolons and new lines, trimmed, deduplicated, each at most 60 characters). Only
    // that field changes, and only when it differs. An older build can still open this database
    // (Dexie opens a newer version as installed; checked for the v1.0.0 rollback).
    this.version(7)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table<Session, string>('sessions')
          .toCollection()
          .modify((session) => {
            const clean = normaliseKeyTerms(session.preferences.keyTerms ?? '');
            if (clean !== session.preferences.keyTerms) session.preferences.keyTerms = clean;
          });
      });
    // Version 8 (v1.1.0, ADR-0041): no new store and no new index. Answers record their call, so a
    // session's calls stay apart in the history, and sessions record how long the latest call lasted,
    // for the home panel. Older data never recorded calls, so they are estimated from long gaps
    // (core/storage/migrate.ts). Nothing else about any row changes, and nothing is removed.
    this.version(8)
      .stores({})
      .upgrade(async (tx) => {
        const sessions = tx.table<Session, string>('sessions');
        const answers = tx.table<StoredAnswer, string>('answers');
        const utterances = tx.table<StoredUtterance, string>('utterances');
        for (const session of await sessions.toArray()) {
          const lines = await utterances.where('sessionId').equals(session.id).toArray();
          const rows = await answers.where('sessionId').equals(session.id).toArray();
          const calls = findCalls([
            ...lines.flatMap((line) => [line.tStart, line.tEnd]),
            ...rows.map((row) => row.createdAt),
          ]);
          const last = calls.at(-1);
          if (!last) continue;
          await answers
            .where('sessionId')
            .equals(session.id)
            .modify((row) => {
              row.callStartedAt = callStartOf(calls, row.createdAt);
            });
          if (last.end > last.start) {
            await sessions.update(session.id, { lastCallMs: last.end - last.start });
          }
        }
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
