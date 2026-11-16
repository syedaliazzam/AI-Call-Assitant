/**
 * File: apps/web/src/core/storage/db.ts
 * Purpose: Kite's local database on the user's device: one IndexedDB database ("kite") opened
 *          with Dexie, with the stores of architecture §7.4 (sessions, documents, utterances,
 *          answers, notes; settings from version 2; lessons from version 3; recording records from
 *          version 10, ADR-0068) and the indexes the dashboard and per-session lookups need.
 * Used by: src/core/storage/sessions.ts, documents.ts, utterances.ts, lessons.ts, wipe.ts
 * Depends on: dexie; src/core/storage/types.ts; src/core/sync/capture.ts (account caches, ADR-0049)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (data model), §8.1;
 *               day-03-sessions.md Stage 1
 *
 * Every signed-in account has its own database on this device (privacy fix of 14 Nov 2026): the
 * account's cache ('kite-u-<id>', ADR-0049), whose changes the sync engine sends to the account. Every
 * account has account sync (ADR-0092). An account's own local database ('kite-l-<id>', made while it
 * had no account sync) is never selected any more: the one-time upload (core/sync/legacyUpload.ts)
 * reads it and offers to add it to the account, and nothing in it is sent otherwise. The old shared database 'kite'
 * (data from before account sync, with no owner recorded) is never opened by a signed-in page, never
 * offered for upload and never changed: its owner cannot be proven, so it stays hidden.
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
  DriveCallJob,
  DriveSessionJob,
  Session,
  StoredCall,
  StoredCallNotes,
  LibraryItem,
  StoredAnswer,
  StoredChat,
  StoredDocument,
  StoredLesson,
  StoredNotes,
  StoredQuestionBank,
  StoredRecording,
  StoredSettings,
  StoredUtterance,
} from './types';
import { captureMiddleware, type OutboxEntry } from '../sync/capture';

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
  /** Changes waiting to be sent to the account (version 9, ADR-0049; account caches only). */
  declare outbox: EntityTable<OutboxEntry, 'seq'>;
  /** The server revision of each synced record this device has (version 9, ADR-0049). */
  declare syncRevs: EntityTable<SyncRev, 'ref'>;
  /** Sync bookkeeping: the last pull's server time, pending account preferences (version 9). */
  declare syncMeta: EntityTable<SyncMetaRow, 'id'>;
  /** Recording parts (version 10, ADR-0068): small records; the files stay on the computer that made them. */
  declare recordings: EntityTable<StoredRecording, 'id'>;
  /**
   * Google Drive uploads, one per session (version 11, ADR-0072); this device only. ADR-0077: no new call
   * is added; the jobs finish their unfinished files.
   */
  declare driveUploads: EntityTable<DriveSessionJob, 'sessionId'>;
  /** Calls, one per start of a session (version 12, ADR-0077). */
  declare calls: EntityTable<StoredCall, 'id'>;
  /** Each call's AI notes (version 12, ADR-0077). */
  declare callNotes: EntityTable<StoredCallNotes, 'callId'>;
  /** Each call's Google Drive upload (version 12, ADR-0077); this device only. */
  declare driveCallJobs: EntityTable<DriveCallJob, 'callId'>;

  /**
   * Declares the schema. Only indexed fields are listed (Dexie stores every field of a row);
   * the first entry of each store is its primary key.
   *
   * How to change the schema later: never edit version(1). Add
   * `this.version(2).stores({ …only the stores that change… }).upgrade(tx => …)` below it,
   * where upgrade() rewrites existing rows if a field's meaning changes. Dexie runs it once on
   * each device that still has version 1, so users keep their sessions.
   *
   * @param name    The database: an account's cache (accountDbName(), ADR-0049), an account's local
   *                database (localAccountDbName()), or 'kite' (tests and harnesses only).
   * @param capture True to record every change to call data in the outbox (account caches).
   */
  constructor(name: string = DB_NAME, capture = false) {
    super(name);
    // Installed before the first query, so no change is ever missed.
    if (capture) this.use(captureMiddleware);
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
    // Version 9 (ADR-0049): sync bookkeeping, used only in an account's cache. outbox: changes
    // waiting to be sent, in order (ref: one record's entries, for merges); syncRevs: the server
    // revision of each record held here; syncMeta: small named values. Nothing existing changes.
    this.version(9).stores({
      outbox: '++seq, ref',
      syncRevs: 'ref',
      syncMeta: 'id',
    });
    // Version 10 (desktop 1.5.0, ADR-0068): one small record per recording part, by session and by
    // meeting. Nothing existing changes.
    this.version(10).stores({
      recordings: 'id, sessionId, meetingId, startedAt',
    });
    // Version 11 (desktop 1.6.0, ADR-0072): each session's Google Drive upload, on this device only
    // (not in SYNCED_STORES, so never in the outbox). Nothing existing changes.
    this.version(11).stores({
      driveUploads: 'sessionId, state, updatedAt',
    });
    // Version 12 (ADR-0077): every start of a session is a call. calls: one record per call (sessionId:
    // the session page; startedAt: its order); callNotes: each call's AI notes (synced, like calls);
    // driveCallJobs: each call's Google Drive upload, on this device only (not synced). New stores only:
    // nothing existing changes, and calls made before are worked out when read (core/review/calls.ts).
    this.version(12).stores({
      calls: 'id, sessionId, startedAt',
      callNotes: 'callId, sessionId',
      driveCallJobs: 'callId, sessionId, state, updatedAt',
    });
  }
}

/** The server revision of one synced record on this device (ADR-0049). */
export interface SyncRev {
  /** The record's reference (store|key, core/sync/mapping.ts). */
  ref: string;
  /** The newest server revision this device has applied or written. */
  rev: number;
}

/** One named sync value (ADR-0049). */
export interface SyncMetaRow {
  /** 'pull' (the last pull's server time) or 'prefs' (account preferences changed here). */
  id: string;
  /** The value: Unix ms for 'pull'; the time of the change for 'prefs'. */
  value: number;
}

/** The name of an account's cache database (ADR-0049). */
export const ACCOUNT_DB_PREFIX = 'kite-u-';

/**
 * The name prefix of an account's own local database on this device, used while accounts could be
 * without account sync (until ADR-0092; privacy fix of 14 Nov 2026: every signed-in account has its own database, so one account
 * never sees another account's sessions on a shared computer).
 */
export const LOCAL_ACCOUNT_DB_PREFIX = 'kite-l-';

/**
 * The cache database of an account.
 *
 * @param userId The account's id.
 * @returns For example 'kite-u-<id>'.
 * Called from: selectAccountDatabase(); tests
 */
export function accountDbName(userId: string): string {
  return `${ACCOUNT_DB_PREFIX}${userId}`;
}

/**
 * The local database an account had while it had no account sync (until ADR-0092). Nothing in it is
 * sent anywhere; the one-time upload (core/sync/legacyUpload.ts) offers to add it to the account.
 *
 * @param userId The account's id.
 * @returns For example 'kite-l-<id>'.
 * Called from: src/core/sync/legacyUpload.ts; src/core/sync/client.ts; tests
 */
export function localAccountDbName(userId: string): string {
  return `${LOCAL_ACCOUNT_DB_PREFIX}${userId}`;
}

/**
 * The database getDb() opens. It starts as the old shared device database ('kite') only so that unit
 * tests and the test harness pages (which render components without a signed-in account) keep working
 * unchanged. Every signed-in page renders SyncScope, which always selects the signed-in account's own
 * database (kite-u-<id>) before any child loads data, so a signed-in page never reads
 * 'kite'. That shared database holds data from before 9 Nov 2026 with no owner recorded, so it must
 * stay hidden: its owner cannot be proven.
 */
let activeName = DB_NAME;

/** True when the active database is an account's sync cache (its changes go to the outbox). */
let activeSync = false;

/**
 * Chooses which database the storage modules use from now on: the account's sync cache (ADR-0049,
 * 'kite-u-<id>'; every account has account sync since ADR-0092). Must run before the first query of a
 * page (SyncScope does it while rendering, before any child loads data). Does nothing on the server.
 *
 * @param userId The signed-in account's id. null selects the old shared device database ('kite'):
 *               only unit tests and test harnesses pass null; app pages always pass an account.
 * Called from: src/features/sync/SyncScope.tsx; tests and test harnesses
 */
export function selectAccountDatabase(userId: string | null): void {
  if (userId === null) selectDatabaseForTests(DB_NAME);
  else switchDatabase(accountDbName(userId), true);
}

/**
 * Tests and harnesses only: points the storage modules at a database the app itself never selects,
 * such as an account's local database from before account sync ('kite-l-<id>', to fill it for the
 * one-time upload's tests) or the old shared 'kite'. Nothing in it is recorded for sync.
 *
 * @param name The database's name.
 * Called from: selectAccountDatabase() (null); tests
 */
export function selectDatabaseForTests(name: string): void {
  switchDatabase(name, false);
}

/**
 * Switches the database the storage modules use (closing the open one when it changes).
 *
 * @param name The database's name.
 * @param sync True for an account's sync cache (its changes go to the outbox).
 * Called from: selectAccountDatabase(), selectDatabaseForTests()
 */
function switchDatabase(name: string, sync: boolean): void {
  if (typeof window === 'undefined' && typeof indexedDB === 'undefined') return;
  if (name === activeName) return;
  forgetDb();
  activeName = name;
  activeSync = sync;
}

/**
 * Whether the storage modules use an account's sync cache: true on every signed-in page; false only
 * in tests and harnesses that use another database.
 *
 * @returns True after selectAccountDatabase() with an account that syncs.
 * Called from: src/core/sync/client.ts; Settings.tsx; SessionReview.tsx
 */
export function usingAccountDatabase(): boolean {
  return activeSync;
}

/**
 * The name of the database the storage modules use now.
 *
 * @returns 'kite-u-<id>', 'kite-l-<id>', or 'kite' (tests and harnesses only).
 * Called from: tests (the privacy checks of SyncScope)
 */
export function activeDatabaseName(): string {
  return activeName;
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
  // An account's sync cache records every change to call data in its outbox (ADR-0049); the databases
  // only tests select (kite-l-<id>, the old shared one) do not.
  instance ??= new KiteDb(activeName, activeSync);
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
