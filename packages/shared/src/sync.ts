/**
 * File: packages/shared/src/sync.ts
 * Purpose: The call-data sync API shared by the web client and the server (ADR-0049): which kinds of
 *          record sync, the operations a device pushes, what each returns, what a pull returns, and
 *          the size limits. The server is the source of truth; each device keeps a cache.
 * Used by: apps/web/src/server/calldata/* (routes /api/sync/*), apps/web/src/core/sync/* (Phase 3)
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4, §8.1; ADR-0049
 */

/**
 * The kinds of record that sync, one per IndexedDB store plus 'prefs' (the few account-level
 * preferences that used to be per device). Audio never syncs: it is never stored at all.
 */
export const SYNC_KINDS = [
  'session',
  'document',
  'utterance',
  'answer',
  'notes',
  'lesson',
  'library',
  'questionBank',
  'chat',
  'settings',
  'prefs',
] as const;

/** One kind of synced record. */
export type SyncKind = (typeof SYNC_KINDS)[number];

/**
 * Kinds that belong to one session: they carry its id and are deleted with it. Lessons are not
 * here on purpose: an approved lesson outlives the session it came from (architecture §7.4).
 */
export const SESSION_CHILD_KINDS = [
  'document',
  'utterance',
  'answer',
  'notes',
  'questionBank',
] as const satisfies readonly SyncKind[];

/** Size limits for the sync routes (the server enforces them; the client stays under them). */
export const SYNC_LIMITS = {
  /** Operations in one push. */
  opsPerPush: 200,
  /** Bytes in one push request (Vercel accepts up to 4.5 MB). */
  requestBytes: 4_000_000,
  /**
   * UTF-8 bytes of one record as JSON. A 250,000-character document (the largest, ADR-0067) is at
   * most about 750 KB, so it fits with room to spare.
   */
  recordBytes: 1_500_000,
  /** Records in one pull page. */
  pullRows: 300,
  /** Approximate bytes of records in one pull page; a page stops once it passes this. */
  pullBytes: 3_000_000,
} as const;

/**
 * What a record or session id may look like: client UUIDs, transcript line ids
 * (`<session>:<call>:<line>`), and the fixed ids 'defaults' and 'account'.
 */
export const SYNC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;

/**
 * How far back each pull reaches before the previous one's server time, in ms. A change is visible
 * to a pull only once its statement has committed; any statement finishes well inside this window,
 * so a pull from `serverTime - overlap` never misses one. Records seen twice are applied once (rev).
 */
export const SYNC_PULL_OVERLAP_MS = 60_000;

/** A record's fields, as the device stores them (the server keeps them encrypted). */
export type SyncRecordBody = Record<string, unknown>;

/** One change a device sends. */
export type SyncOp =
  | {
      /**
       * Create or change a record. Accepted when the server's copy is still at `baseRev` (the
       * copy this device last saw), or when there is none yet; otherwise 'conflict'.
       */
      op: 'put';
      /** The record's kind. */
      kind: SyncKind;
      /** The record's id. */
      id: string;
      /** The session it belongs to (required for SESSION_CHILD_KINDS). */
      sessionId?: string;
      /** The server revision this device last saw; null for a record it created. */
      baseRev: number | null;
      /** The whole record. */
      record: SyncRecordBody;
    }
  | {
      /** Add a record only when the account has none with this id (the one-time upload, Phase 4). */
      op: 'insert';
      /** The record's kind. */
      kind: SyncKind;
      /** The record's id. */
      id: string;
      /** The session it belongs to (required for SESSION_CHILD_KINDS). */
      sessionId?: string;
      /** The whole record. */
      record: SyncRecordBody;
    }
  | {
      /** Delete a record. A session takes its documents, lines, answers, notes and question bank. */
      op: 'delete';
      /** The record's kind. */
      kind: SyncKind;
      /** The record's id. */
      id: string;
    }
  | {
      /** Delete every transcript line of a session (Clear transcript, or Save transcript off). */
      op: 'clearLines';
      /** The session. */
      sessionId: string;
    }
  | {
      /** Delete everything this account has synced (Settings → Delete all my data). */
      op: 'deleteAll';
    };

/** What one operation did, in the same order as the request's operations. */
export type SyncOpResult =
  | {
      /** Stored; `rev` is the record's new revision. */
      status: 'ok';
      /** The new revision. */
      rev: number;
    }
  | {
      /** A bulk operation (clearLines, deleteAll) finished. */
      status: 'done';
    }
  | {
      /** An insert found the record already there (counted as "already there"). */
      status: 'exists';
    }
  | {
      /** The server's copy changed since `baseRev`; here it is, to merge and send again. */
      status: 'conflict';
      /** The server's revision. */
      rev: number;
      /** The server's copy. */
      record: SyncRecordBody;
    }
  | {
      /** The record was deleted on another device; this device removes its copy. */
      status: 'deleted';
    }
  | {
      /**
       * Not stored: 'transcript_off' (the session does not save its transcript, so no line may
       * reach the server), or 'unknown_session' (a line arrived before its session; send it again
       * once the session is stored).
       */
      status: 'refused';
      /** Why. */
      reason: 'transcript_off' | 'unknown_session';
    };

/** Body of POST /api/sync/push. */
export interface SyncPushRequest {
  /** The changes, oldest first. */
  ops: SyncOp[];
}

/** Response of POST /api/sync/push. */
export interface SyncPushResponse {
  /** One result per operation, in order. */
  results: SyncOpResult[];
}

/** One record in a pull. */
export interface SyncPulledRecord {
  /** Its kind. */
  kind: SyncKind;
  /** Its id. */
  id: string;
  /** The session it belongs to, or null. */
  sessionId: string | null;
  /** Its revision (higher is newer). */
  rev: number;
  /** True when it was deleted (then `record` is null). */
  deleted: boolean;
  /** The record, or null when deleted. */
  record: SyncRecordBody | null;
}

/** Response of GET /api/sync/pull. */
export interface SyncPullResponse {
  /** Changed records, oldest change first. */
  records: SyncPulledRecord[];
  /**
   * The server's time when the pull started (Unix ms). The next pull starts from this time minus
   * SYNC_PULL_OVERLAP_MS.
   */
  serverTime: number;
  /** Pass as `after` to read the next page; null when this was the last. */
  next: string | null;
}

/** Response of GET /api/sync/status. */
export interface SyncStatusResponse {
  /** True when this account syncs its call data (the accountSync switch, ADR-0049). */
  enabled: boolean;
}
