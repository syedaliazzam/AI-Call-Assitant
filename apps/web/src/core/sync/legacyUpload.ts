/**
 * File: apps/web/src/core/sync/legacyUpload.ts
 * Purpose: The one-time upload of an account's own local data into the account (ADR-0049, Phase 4).
 *          Privacy fix of 14 Nov 2026: the source is ONLY the signed-in account's own local database
 *          ('kite-l-<id>', what this account made on this device while it had no account sync). The old
 *          shared database 'kite' (from before 9 Nov 2026) records no owner, so on a shared computer it
 *          may hold another person's sessions: it is never offered, never read, never changed.
 *          After the person agrees ("Add them to <email>?"), this reads the account's local database (it
 *          is never written to) and adds each session, with its documents, lines, answers, notes and
 *          question bank, then lessons, library items, Ask AI chats and the default preferences, to
 *          the account. Each record is added only when the account has none with its id
 *          ("already there"), so running it twice, or on two devices holding the same session, adds
 *          nothing twice. A lesson the account already has (same wording key) and a library item with
 *          the same kind, name and text are skipped. Afterwards the account's changes are pulled.
 * Used by: src/features/sync/LegacyUploadCard.tsx
 * Depends on: dexie, @kite/shared (sync limits), src/core/storage/db.ts, src/core/sync/engine.ts,
 *             src/core/sync/size.ts
 * Architecture: ADR-0049 (migration)
 *
 * Logs counts only, never ids or content.
 */
import {
  SESSION_CHILD_KINDS,
  SYNC_ID_PATTERN,
  SYNC_LIMITS,
  type SyncKind,
  type SyncOp,
} from '@kite/shared';
import Dexie from 'dexie';
import {
  accountDbName,
  activeDatabaseName,
  getDb,
  KiteDb,
  localAccountDbName,
} from '../storage/db';
import type { LibraryItem, Session, StoredLesson } from '../storage/types';
import { httpTransport, pullAll, type SyncTransport } from './engine';
import { jsonBytes } from './size';

/** What this account's local database on this device holds that the account may not have. */
export interface LegacySummary {
  /** Sessions in the account's local database. */
  sessions: number;
  /** Library items, lessons and Ask AI chats. */
  other: number;
}

/** What the upload did. */
export interface LegacyUploadResult {
  /** Sessions added to the account. */
  added: number;
  /** Sessions the account already had. */
  existing: number;
  /** Sessions that cannot sync (an id the server would refuse); they stay on this device only. */
  skipped: number;
  /** Sessions the account's local database held. */
  total: number;
}

/**
 * The local storage key prefix that remembers the upload was done (or found unnecessary) for an
 * account on this address ('kite.localUpload.done.<id>'). New on 14 Nov 2026: the older
 * 'kite.legacyUpload.<id>' flags were about the shared 'kite' database and no longer apply.
 */
const DONE_PREFIX = 'kite.localUpload.done.';

/**
 * Whether the upload is done (or was found unnecessary) for an account on this address.
 *
 * @param userId The account.
 * @returns True when it must not be offered again.
 * Called from: LegacyUploadCard.tsx; tests
 */
export function legacyUploadDone(userId: string): boolean {
  try {
    return localStorage.getItem(`${DONE_PREFIX}${userId}`) === 'done';
  } catch {
    return false;
  }
}

/**
 * Remembers that the upload is done for an account on this address.
 *
 * @param userId The account.
 * Called from: LegacyUploadCard.tsx (after an upload whose counts match, or when there is nothing)
 */
export function markLegacyUploadDone(userId: string): void {
  try {
    localStorage.setItem(`${DONE_PREFIX}${userId}`, 'done');
  } catch {
    // Storage blocked: the card may be offered again; adding twice adds nothing.
  }
}

/**
 * Opens the account's own local database for reading, if it exists (never creates it). Only this
 * account's database can be opened here: the name is built from the signed-in account's id.
 *
 * @param userId The signed-in account.
 * @returns The database, or null when this account has none on this device.
 */
async function openLegacy(userId: string): Promise<KiteDb | null> {
  const name = localAccountDbName(userId);
  if (!(await Dexie.exists(name))) return null;
  const legacy = new KiteDb(name, false);
  await legacy.open();
  return legacy;
}

/**
 * Counts what the account's own local database holds.
 *
 * @param userId The signed-in account.
 * @returns The counts, or null when there is no such database or it is empty.
 * Called from: LegacyUploadCard.tsx; tests
 */
export async function legacySummary(userId: string): Promise<LegacySummary | null> {
  const legacy = await openLegacy(userId);
  if (!legacy) return null;
  try {
    const sessions = await legacy.sessions.count();
    const other =
      (await legacy.library.count()) +
      (await legacy.lessons.count()) +
      (await legacy.chats.count());
    return sessions + other > 0 ? { sessions, other } : null;
  } finally {
    legacy.close();
  }
}

/**
 * SHA-256 of a text, as hex (to recognise the same library item uploaded from two devices).
 *
 * @param text The text.
 * @returns The hash.
 */
async function hashOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * An insert for one record, or null when it cannot sync (an id or size the server refuses).
 *
 * @param kind      The record kind.
 * @param id        Its id.
 * @param record    The record.
 * @param sessionId Its session, for session children.
 * @returns The operation, or null.
 */
function insertOf(kind: SyncKind, id: string, record: object, sessionId?: string): SyncOp | null {
  if (!SYNC_ID_PATTERN.test(id)) return null;
  if (sessionId !== undefined && !SYNC_ID_PATTERN.test(sessionId)) return null;
  if (jsonBytes(record) > SYNC_LIMITS.recordBytes) return null;
  const child = (SESSION_CHILD_KINDS as readonly string[]).includes(kind);
  return {
    op: 'insert',
    kind,
    id,
    ...(child && sessionId ? { sessionId } : {}),
    record: record as Record<string, unknown>,
  };
}

/**
 * Sends inserts in batches that fit one push.
 *
 * @param transport The server.
 * @param ops       The inserts.
 * @returns Each operation's result status, in order.
 */
async function sendAll(transport: SyncTransport, ops: SyncOp[]): Promise<string[]> {
  const statuses: string[] = [];
  let batch: SyncOp[] = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const response = await transport.push(batch);
    statuses.push(...response.results.map((result) => result.status));
    batch = [];
    bytes = 0;
  };
  for (const op of ops) {
    const size = jsonBytes(op); // UTF-8 bytes, as the server counts (ADR-0067)
    if (
      batch.length >= SYNC_LIMITS.opsPerPush ||
      (batch.length > 0 && bytes + size > SYNC_LIMITS.requestBytes - 500_000)
    ) {
      await flush();
    }
    batch.push(op);
    bytes += size;
  }
  await flush();
  return statuses;
}

/**
 * Adds the account's own local data to the account (its sync cache must be the active database).
 *
 * @param userId     The signed-in account (whose local database is read).
 * @param onProgress Called after each session: sessions done and the total.
 * @param transport  The server (tests pass one).
 * @returns How many sessions were added and how many the account already had.
 * @throws SyncHttpError or a network error; what was added stays added, and running again adds the
 *         rest (and counts the rest as already there).
 * @throws Error('NOT_ACCOUNT_CACHE') when the page's database is not this account's sync cache (the
 *         data would otherwise land in some other database); nothing is read or sent.
 * Called from: LegacyUploadCard.tsx; tests
 */
export async function uploadLegacyData(
  userId: string,
  onProgress: (done: number, total: number) => void = () => undefined,
  transport: SyncTransport = httpTransport,
): Promise<LegacyUploadResult> {
  // Only into the same account's sync cache: never one account's local data into another account.
  if (activeDatabaseName() !== accountDbName(userId)) throw new Error('NOT_ACCOUNT_CACHE');
  const legacy = await openLegacy(userId);
  if (!legacy) return { added: 0, existing: 0, skipped: 0, total: 0 };
  try {
    // The account's current state first: lessons and library items it has are not added again.
    const cache = getDb();
    await pullAll(cache, transport);
    const knownLessons = new Set((await cache.lessons.toArray()).map((lesson) => lesson.sourceKey));
    const knownItems = new Set(
      await Promise.all(
        (await cache.library.toArray()).map(
          async (item: LibraryItem) => `${item.kind}|${item.name}|${await hashOf(item.text)}`,
        ),
      ),
    );

    const sessions: Session[] = await legacy.sessions.orderBy('createdAt').toArray();
    let added = 0;
    let existing = 0;
    let skipped = 0;
    for (const [index, session] of sessions.entries()) {
      const sessionOp = insertOf('session', session.id, session);
      if (!sessionOp) {
        skipped += 1;
        onProgress(index + 1, sessions.length);
        continue;
      }
      const ops: (SyncOp | null)[] = [sessionOp];
      for (const document of await legacy.documents
        .where('sessionId')
        .equals(session.id)
        .toArray()) {
        ops.push(insertOf('document', document.id, document, session.id));
      }
      // Lines only for a session that saves its transcript (the server refuses the others anyway).
      if (session.saveTranscript) {
        for (const line of await legacy.utterances
          .where('sessionId')
          .equals(session.id)
          .toArray()) {
          ops.push(insertOf('utterance', line.id, line, session.id));
        }
      }
      for (const answer of await legacy.answers.where('sessionId').equals(session.id).toArray()) {
        ops.push(insertOf('answer', answer.id, answer, session.id));
      }
      const notes = await legacy.notes.get(session.id);
      if (notes) ops.push(insertOf('notes', session.id, notes, session.id));
      const bank = await legacy.questionBanks.get(session.id);
      if (bank) ops.push(insertOf('questionBank', session.id, bank, session.id));
      const valid = ops.filter((op): op is SyncOp => op !== null);
      // The session is the first operation: its result says whether the account already had it.
      const statuses = await sendAll(transport, valid);
      if (statuses[0] === 'ok') added += 1;
      else existing += 1;
      onProgress(index + 1, sessions.length);
    }

    const rest: (SyncOp | null)[] = [];
    for (const lesson of await legacy.lessons.toArray()) {
      if (knownLessons.has((lesson as StoredLesson).sourceKey)) continue;
      rest.push(insertOf('lesson', lesson.id, lesson));
    }
    for (const item of await legacy.library.toArray()) {
      if (knownItems.has(`${item.kind}|${item.name}|${await hashOf(item.text)}`)) continue;
      rest.push(insertOf('library', item.id, item));
    }
    for (const chat of await legacy.chats.toArray()) rest.push(insertOf('chat', chat.id, chat));
    const defaults = await legacy.settings.get('defaults');
    if (defaults) rest.push(insertOf('settings', 'defaults', defaults));
    await sendAll(
      transport,
      rest.filter((op): op is SyncOp => op !== null),
    );

    // Bring everything into this device's account cache now.
    await pullAll(cache, transport);
    console.info('sync: one-time upload finished', {
      added,
      existing,
      skipped,
      total: sessions.length,
    });
    return { added, existing, skipped, total: sessions.length };
  } finally {
    legacy.close();
  }
}
