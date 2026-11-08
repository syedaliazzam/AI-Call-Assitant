/**
 * File: apps/web/src/server/calldata/store.ts
 * Purpose: Reads and writes one account's synced call data in call_record (ADR-0049): applies a
 *          device's operations (put with a base revision, insert-if-missing, delete with the session's
 *          children, clear a transcript, delete everything), returns changes since a time, page by
 *          page, and reads one record. Every statement is filtered by the account's id, which comes
 *          from the signed-in session (api.ts), never from the request body. Records are encrypted
 *          before they are written and decrypted after they are read (crypto.ts).
 * Used by: src/server/calldata/api.ts; tests (against PGlite, a real Postgres in memory)
 * Depends on: drizzle-orm, src/server/schema.ts (callRecord), src/server/calldata/crypto.ts,
 *             @kite/shared (sync types and limits)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4, §8.1; ADR-0049
 *
 * Each statement is atomic by itself; no operation needs more than that. Neon's HTTP driver has no
 * multi-statement transactions, and every operation is safe to repeat: a device retries until it
 * gets a result, and a repeated write or delete changes nothing more.
 */
import 'server-only';
import {
  SESSION_CHILD_KINDS,
  SYNC_LIMITS,
  type SyncKind,
  type SyncOp,
  type SyncOpResult,
  type SyncPulledRecord,
  type SyncPullResponse,
  type SyncRecordBody,
} from '@kite/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { callRecord } from '../schema';
import { open, seal, type DataKeys } from './crypto';

/** Any Drizzle Postgres database: Neon over HTTP in the app, PGlite in tests. */
export type CallDataDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** What every store function works within: one account's data. */
export interface StoreContext {
  /** The database. */
  db: CallDataDb;
  /** The data keys. */
  keys: DataKeys;
  /** The signed-in account; every statement is limited to it. */
  userId: string;
}

/** The next revision, for a changed row. */
const NEXT_REV = sql`nextval('call_record_rev_seq')`;

/** The columns a tombstone keeps: content and key removed, flagged deleted, a new revision. */
const TOMBSTONE = {
  deleted: true,
  content: null,
  keyVersion: null,
  saveTranscript: null,
  rev: NEXT_REV,
  updatedAt: sql`now()`,
} as const;

/** One row as read back. */
interface StoredRow {
  /** Its kind. */
  kind: string;
  /** Its id. */
  id: string;
  /** Its session, or null. */
  sessionId: string | null;
  /** Its revision. */
  rev: number;
  /** True for a tombstone. */
  deleted: boolean;
  /** The key version, or null on a tombstone. */
  keyVersion: number | null;
  /** The ciphertext, or null on a tombstone. */
  content: string | null;
  /** When it was written. */
  updatedAt: Date;
}

/** The columns read back for a row. */
const ROW_COLUMNS = {
  kind: callRecord.kind,
  id: callRecord.id,
  sessionId: callRecord.sessionId,
  rev: callRecord.rev,
  deleted: callRecord.deleted,
  keyVersion: callRecord.keyVersion,
  content: callRecord.content,
  updatedAt: callRecord.updatedAt,
};

/**
 * The condition for one of this account's rows.
 *
 * @param ctx  The account.
 * @param kind The kind.
 * @param id   The id.
 * @returns A where clause.
 */
function rowOf(ctx: StoreContext, kind: string, id: string) {
  return and(eq(callRecord.userId, ctx.userId), eq(callRecord.kind, kind), eq(callRecord.id, id));
}

/**
 * Decrypts a row's record.
 *
 * @param ctx The account.
 * @param row The row (not a tombstone).
 * @returns The record.
 */
function decrypt(ctx: StoreContext, row: StoredRow): SyncRecordBody {
  const json = open(
    ctx.keys,
    { userId: ctx.userId, kind: row.kind, id: row.id },
    row.keyVersion!,
    row.content!,
  );
  return JSON.parse(json) as SyncRecordBody;
}

/**
 * Reads one of this account's rows, tombstones included.
 *
 * @param ctx  The account.
 * @param kind The kind.
 * @param id   The id.
 * @returns The row, or null when there is none.
 */
async function readRow(ctx: StoreContext, kind: string, id: string): Promise<StoredRow | null> {
  const rows = await ctx.db
    .select(ROW_COLUMNS)
    .from(callRecord)
    .where(rowOf(ctx, kind, id));
  return rows[0] ?? null;
}

/**
 * Whether a transcript line may be stored for a session, by the session's stored setting.
 *
 * @param ctx       The account.
 * @param sessionId The line's session.
 * @param cache     Answers already found in this push (a session put or delete clears its entry).
 * @returns null when allowed, else the result that refuses the line.
 */
async function lineRefusal(
  ctx: StoreContext,
  sessionId: string,
  cache: Map<string, SyncOpResult | null>,
): Promise<SyncOpResult | null> {
  if (cache.has(sessionId)) return cache.get(sessionId)!;
  const rows = await ctx.db
    .select({ deleted: callRecord.deleted, saveTranscript: callRecord.saveTranscript })
    .from(callRecord)
    .where(rowOf(ctx, 'session', sessionId));
  const session = rows[0];
  const refusal: SyncOpResult | null = !session
    ? { status: 'refused', reason: 'unknown_session' }
    : session.deleted
      ? { status: 'deleted' }
      : session.saveTranscript !== true
        ? { status: 'refused', reason: 'transcript_off' }
        : null;
  cache.set(sessionId, refusal);
  return refusal;
}

/**
 * Deletes every transcript line of a session (tombstones; their text is removed).
 *
 * @param ctx       The account.
 * @param sessionId The session.
 */
async function clearLines(ctx: StoreContext, sessionId: string): Promise<void> {
  await ctx.db
    .update(callRecord)
    .set(TOMBSTONE)
    .where(
      and(
        eq(callRecord.userId, ctx.userId),
        eq(callRecord.kind, 'utterance'),
        eq(callRecord.sessionId, sessionId),
        eq(callRecord.deleted, false),
      ),
    );
}

/**
 * Puts or inserts one record.
 *
 * @param ctx   The account.
 * @param op    The put or insert.
 * @param lines The per-push cache of whether a session takes lines.
 * @returns What happened.
 */
async function write(
  ctx: StoreContext,
  op: Extract<SyncOp, { op: 'put' | 'insert' }>,
  lines: Map<string, SyncOpResult | null>,
): Promise<SyncOpResult> {
  if (op.kind === 'utterance') {
    // Save transcript off: nothing about the session's lines reaches the database (ADR-0049).
    const refusal = await lineRefusal(ctx, op.sessionId!, lines);
    if (refusal) return refusal;
  }
  const sealed = seal(
    ctx.keys,
    { userId: ctx.userId, kind: op.kind, id: op.id },
    JSON.stringify(op.record),
  );
  const saveTranscript = op.kind === 'session' ? op.record.saveTranscript === true : null;
  const values = {
    userId: ctx.userId,
    kind: op.kind,
    id: op.id,
    sessionId: op.sessionId ?? null,
    keyVersion: sealed.keyVersion,
    content: sealed.content,
    saveTranscript,
  };
  if (op.kind === 'session') lines.delete(op.id);

  if (op.op === 'insert') {
    const inserted = await ctx.db
      .insert(callRecord)
      .values(values)
      .onConflictDoNothing()
      .returning({ rev: callRecord.rev });
    if (!inserted[0]) return { status: 'exists' };
    if (saveTranscript === false) await clearLines(ctx, op.id);
    return { status: 'ok', rev: inserted[0].rev };
  }

  // A put changes the stored copy only when it is still the one this device last saw (baseRev),
  // and never revives a deleted record: a delete on any device wins.
  const written = await ctx.db
    .insert(callRecord)
    .values(values)
    .onConflictDoUpdate({
      target: [callRecord.userId, callRecord.kind, callRecord.id],
      set: {
        sessionId: sql`excluded.session_id`,
        keyVersion: sql`excluded.key_version`,
        content: sql`excluded.content`,
        saveTranscript: sql`excluded.save_transcript`,
        rev: NEXT_REV,
        updatedAt: sql`now()`,
      },
      setWhere: and(eq(callRecord.deleted, false), eq(callRecord.rev, op.baseRev ?? -1)),
    })
    .returning({ rev: callRecord.rev });
  if (written[0]) {
    // Turning Save transcript off removes the lines already stored, on the server too.
    if (saveTranscript === false) await clearLines(ctx, op.id);
    return { status: 'ok', rev: written[0].rev };
  }
  const current = await readRow(ctx, op.kind, op.id);
  if (!current || current.deleted) return { status: 'deleted' };
  return { status: 'conflict', rev: current.rev, record: decrypt(ctx, current) };
}

/**
 * Deletes one record; a session also takes its documents, lines, answers, notes and question bank.
 * A record the server never had still gets a tombstone, so devices holding a copy remove it.
 *
 * @param ctx The account.
 * @param op  The delete.
 */
async function remove(ctx: StoreContext, op: Extract<SyncOp, { op: 'delete' }>): Promise<void> {
  if (op.kind === 'session') {
    // Children first: if the second statement fails, the device's retry finishes the job.
    await ctx.db
      .update(callRecord)
      .set(TOMBSTONE)
      .where(
        and(
          eq(callRecord.userId, ctx.userId),
          eq(callRecord.sessionId, op.id),
          inArray(callRecord.kind, [...SESSION_CHILD_KINDS]),
          eq(callRecord.deleted, false),
        ),
      );
  }
  await ctx.db
    .insert(callRecord)
    .values({ userId: ctx.userId, kind: op.kind, id: op.id, deleted: true })
    .onConflictDoUpdate({
      target: [callRecord.userId, callRecord.kind, callRecord.id],
      set: TOMBSTONE,
      setWhere: eq(callRecord.deleted, false),
    });
}

/**
 * Applies a device's operations in order.
 *
 * @param ctx The account.
 * @param ops The operations (already checked by validate.ts).
 * @returns One result per operation.
 * @throws What the database or a missing key throws; the device sends the whole push again, which
 *         is safe because every operation can be repeated.
 * Called from: handlePush() in api.ts; tests
 */
export async function applyOps(ctx: StoreContext, ops: readonly SyncOp[]): Promise<SyncOpResult[]> {
  const results: SyncOpResult[] = [];
  // Whether each session takes transcript lines, found once per push.
  const lines = new Map<string, SyncOpResult | null>();
  for (const op of ops) {
    switch (op.op) {
      case 'put':
      case 'insert':
        results.push(await write(ctx, op, lines));
        break;
      case 'delete':
        await remove(ctx, op);
        if (op.kind === 'session') lines.delete(op.id);
        results.push({ status: 'done' });
        break;
      case 'clearLines':
        await clearLines(ctx, op.sessionId);
        results.push({ status: 'done' });
        break;
      case 'deleteAll':
        await ctx.db
          .update(callRecord)
          .set(TOMBSTONE)
          .where(and(eq(callRecord.userId, ctx.userId), eq(callRecord.deleted, false)));
        lines.clear();
        results.push({ status: 'done' });
        break;
    }
  }
  return results;
}

/** Where a pull page starts: after this change. */
interface PullCursor {
  /** The change's time, Unix ms. */
  at: number;
  /** Its kind. */
  kind: string;
  /** Its id. */
  id: string;
}

/**
 * Writes a page token.
 *
 * @param cursor The last change on the page.
 * @returns The token.
 */
function encodeCursor(cursor: PullCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.kind, cursor.id])).toString('base64url');
}

/**
 * Reads a page token.
 *
 * @param token The token from a previous page.
 * @returns The cursor, or null when the token is not one this server wrote.
 * Called from: pullChanges(); tests
 */
export function decodeCursor(token: string): PullCursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      Number.isSafeInteger(value[0]) &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string'
    ) {
      return { at: value[0] as number, kind: value[1], id: value[2] };
    }
  } catch {
    // Not base64url JSON: treated as an invalid token below.
  }
  return null;
}

/**
 * A row as a pulled record (decrypted unless it is a tombstone).
 *
 * @param ctx The account.
 * @param row The row.
 * @returns The record.
 */
function toPulled(ctx: StoreContext, row: StoredRow): SyncPulledRecord {
  return {
    kind: row.kind as SyncKind,
    id: row.id,
    sessionId: row.sessionId,
    rev: row.rev,
    deleted: row.deleted,
    record: row.deleted ? null : decrypt(ctx, row),
  };
}

/**
 * Reads this account's changes since a time, oldest first, one page at a time.
 *
 * @param ctx   The account.
 * @param since Unix ms: changes written after this (the device passes its last serverTime minus
 *              SYNC_PULL_OVERLAP_MS; 0 reads everything).
 * @param after The previous page's token, or null for the first page.
 * @param now   The server's time now (tests pass one).
 * @returns The page, the server time and the next page's token.
 * @throws Error('BAD_CURSOR') for a token this server did not write.
 * Called from: handlePull() in api.ts; tests
 */
export async function pullChanges(
  ctx: StoreContext,
  since: number,
  after: string | null,
  now: number = Date.now(),
): Promise<SyncPullResponse> {
  const cursor = after === null ? { at: since, kind: '', id: '' } : decodeCursor(after);
  if (!cursor) throw new Error('BAD_CURSOR');
  const rows: StoredRow[] = await ctx.db
    .select(ROW_COLUMNS)
    .from(callRecord)
    .where(
      and(
        eq(callRecord.userId, ctx.userId),
        // Row order (time, kind, id), so a page boundary inside one millisecond loses nothing.
        sql`(${callRecord.updatedAt}, ${callRecord.kind}, ${callRecord.id}) > (${new Date(cursor.at).toISOString()}::timestamptz, ${cursor.kind}, ${cursor.id})`,
      ),
    )
    .orderBy(asc(callRecord.updatedAt), asc(callRecord.kind), asc(callRecord.id))
    .limit(SYNC_LIMITS.pullRows);

  const records: SyncPulledRecord[] = [];
  let bytes = 0;
  let last: StoredRow | null = null;
  for (const row of rows) {
    // A page stops once it is large; the next page carries on from here.
    if (records.length > 0 && bytes >= SYNC_LIMITS.pullBytes) break;
    records.push(toPulled(ctx, row));
    bytes += row.content?.length ?? 0;
    last = row;
  }
  const full = records.length < rows.length || rows.length === SYNC_LIMITS.pullRows;
  return {
    records,
    serverTime: now,
    next:
      full && last
        ? encodeCursor({ at: last.updatedAt.getTime(), kind: last.kind, id: last.id })
        : null,
  };
}

/**
 * Reads one of this account's records.
 *
 * @param ctx  The account.
 * @param kind The kind.
 * @param id   The id.
 * @returns The record, or null when this account has none (or it was deleted).
 * Called from: handleRecord() in api.ts; tests
 */
export async function readRecord(
  ctx: StoreContext,
  kind: SyncKind,
  id: string,
): Promise<SyncPulledRecord | null> {
  const row = await readRow(ctx, kind, id);
  return row && !row.deleted ? toPulled(ctx, row) : null;
}
