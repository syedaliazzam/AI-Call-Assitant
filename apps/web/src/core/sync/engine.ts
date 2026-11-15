/**
 * File: apps/web/src/core/sync/engine.ts
 * Purpose: The sync steps for an account's cache (ADR-0049), without timing: pushOnce() sends one
 *          batch of the outbox and applies each result (accepted: remember the revision; conflict:
 *          merge the server copy with this device's changed fields and send again; deleted
 *          elsewhere: remove here; Save transcript off: drop), and pullAll() applies the account's
 *          changes since the last pull, page by page (a delete wins; a record with unsent changes
 *          here is merged, keeping those changes). Every write they make is marked as coming from
 *          the server, so it is not sent back.
 * Used by: src/core/sync/client.ts (when to run them); tests
 * Depends on: dexie, @kite/shared (sync types and limits), src/core/storage/{db,accountScope}.ts,
 *             src/core/sync/{capture,events,mapping,outbox,prefs,size}.ts
 *
 * Privacy fix of 14 Nov 2026: every request names the page's account (ACCOUNT_HEADER), and
 * rereadAccountPrefs() brings the account's preferences back after an account switch on this device.
 * Architecture: ADR-0049
 *
 * Logs carry counts only, never ids or record content.
 */
import {
  ACCOUNT_HEADER,
  SYNC_ID_PATTERN,
  SYNC_LIMITS,
  SYNC_PULL_OVERLAP_MS,
  type SyncKind,
  type SyncOp,
  type SyncOpResult,
  type SyncPulledRecord,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@kite/shared';
import type { Table } from 'dexie';
import { currentAccountId } from '../storage/accountScope';
import type { KiteDb } from '../storage/db';
import { markRemote, OUTBOX_STORE } from './capture';
import { notifySyncApplied } from './events';
import {
  parseRef,
  PREFS_REF,
  refOf,
  sessionIdOf,
  storeOfKind,
  STORE_KIND,
  SYNCED_STORES,
  type SyncedStore,
} from './mapping';
import { coalesce, mergeChanged, type PendingChange } from './outbox';
import { readAccountPrefs, writeAccountPrefs } from './prefs';
import { jsonBytes } from './size';

/** How the engine reaches the server (tests pass a fake). */
export interface SyncTransport {
  /** POST /api/sync/push. */
  push(ops: SyncOp[], options?: { keepalive?: boolean }): Promise<SyncPushResponse>;
  /** GET /api/sync/pull. */
  pull(since: number, after: string | null): Promise<SyncPullResponse>;
  /**
   * GET /api/sync/record: one of the account's records, or null when the account has none. Optional:
   * only rereadAccountPrefs() uses it, and test transports without it skip that step.
   */
  record?(kind: SyncKind, id: string): Promise<SyncPulledRecord | null>;
}

/**
 * The headers every sync request carries: the account this page was opened for, so the server refuses
 * the request when another account has signed in since (ACCOUNT_HEADER; privacy fix of 14 Nov 2026).
 *
 * @returns The headers (none outside a signed-in page).
 */
function accountHeaders(): Record<string, string> {
  const accountId = currentAccountId();
  return accountId ? { [ACCOUNT_HEADER]: accountId } : {};
}

/** A sync route answered with an error status. */
export class SyncHttpError extends Error {
  /** The HTTP status. */
  readonly status: number;

  /**
   * @param status The HTTP status.
   */
  constructor(status: number) {
    super(`Sync request failed (${status})`);
    this.name = 'SyncHttpError';
    this.status = status;
  }
}

/** The real transport: same-origin fetch with the sign-in cookie. */
export const httpTransport: SyncTransport = {
  async push(ops, options) {
    const response = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify({ ops }),
      // keepalive lets a push sent while the page closes finish (its body must stay under 64 KB).
      keepalive: options?.keepalive ?? false,
    });
    if (!response.ok) throw new SyncHttpError(response.status);
    return (await response.json()) as SyncPushResponse;
  },
  async pull(since, after) {
    const query = new URLSearchParams({ since: String(since) });
    if (after) query.set('after', after);
    const response = await fetch(`/api/sync/pull?${query.toString()}`, {
      headers: accountHeaders(),
    });
    if (!response.ok) throw new SyncHttpError(response.status);
    return (await response.json()) as SyncPullResponse;
  },
  async record(kind, id) {
    const query = new URLSearchParams({ kind, id });
    const response = await fetch(`/api/sync/record?${query.toString()}`, {
      headers: accountHeaders(),
    });
    // 404: the account has no such record (for 'prefs': never changed, so every default applies).
    if (response.status === 404) return null;
    if (!response.ok) throw new SyncHttpError(response.status);
    return (await response.json()) as SyncPulledRecord;
  },
};

/**
 * Reads the account preferences again from the account, after an account switch on this browser
 * profile removed the previous account's values from localStorage (core/storage/accountScope.ts). A
 * normal pull would not bring them back: it only brings records changed since this cache's last pull.
 * A preferences change that waited in this cache is dropped first, because its values were the ones
 * removed (sending it would overwrite the account's values with the defaults).
 *
 * @param db        The account's cache.
 * @param transport The server; a transport without record() does nothing.
 * @returns True when the account's values are now in localStorage (or the account has none).
 * @throws SyncHttpError or a network error (the caller tries again at the next start).
 * Called from: client.ts (start of account sync, when accountPrefsWereReset()); tests
 */
export async function rereadAccountPrefs(db: KiteDb, transport: SyncTransport): Promise<boolean> {
  if (!transport.record) return false;
  await db.syncMeta.delete('prefs');
  const pulled = await transport.record('prefs', 'account');
  // No record, or a deleted one: nothing set, so the defaults (the keys stay removed).
  if (pulled && !pulled.deleted && pulled.record) writeAccountPrefs(pulled.record);
  if (pulled) {
    await remote(db, () => db.syncRevs.put({ ref: PREFS_REF, rev: pulled.rev }));
  }
  return true;
}

/**
 * The tables a sync write touches: every synced store and the bookkeeping.
 *
 * @param db The account's cache.
 * @returns The tables.
 */
function syncTables(db: KiteDb): Table[] {
  return [
    ...SYNCED_STORES.map((store) => db.table(store)),
    db.table(OUTBOX_STORE),
    db.syncRevs,
    db.syncMeta,
  ];
}

/**
 * Runs writes that come from the server: in one transaction, marked so they are not sent back.
 *
 * @param db   The account's cache.
 * @param work The writes.
 * @returns What work returns.
 */
async function remote<T>(db: KiteDb, work: () => Promise<T>): Promise<T> {
  return db.transaction('rw', syncTables(db), async (tx) => {
    markRemote(tx.idbtrans);
    return work();
  });
}

/**
 * Deletes a record's outbox entries, up to a sequence number (later entries are newer changes).
 *
 * @param db     The account's cache.
 * @param ref    The record.
 * @param upToSeq The last sequence to delete (Infinity for all).
 */
async function clearEntries(db: KiteDb, ref: string, upToSeq: number): Promise<void> {
  await db.outbox
    .where('ref')
    .equals(ref)
    .filter((entry) => (entry.seq ?? 0) <= upToSeq)
    .delete();
}

/** What pushOnce() did. */
export interface PushRound {
  /** Operations sent (0 when there was nothing to send). */
  sent: number;
  /** True when more is waiting: run another round. */
  more: boolean;
  /** True when the server had newer data (a conflict or a delete): pull soon. */
  pullNeeded: boolean;
}

/** One change being sent, with its operation. */
interface Outgoing {
  /** The change (null for the account preferences). */
  change: PendingChange | null;
  /** Its operation. */
  op: SyncOp;
}

/**
 * Turns one pending change into an operation, or null when it cannot sync (then its entries are
 * dropped: an id or record the server would refuse must not block every later change).
 *
 * @param db     The account's cache.
 * @param change The change.
 * @returns The operation, or null.
 */
async function toOp(db: KiteDb, change: PendingChange): Promise<SyncOp | null> {
  const { store, key } = parseRef(change.ref);
  const kind = STORE_KIND[store as SyncedStore];
  if (!kind || !SYNC_ID_PATTERN.test(key)) return null;
  if (change.op === 'delete') return { op: 'delete', kind, id: key };
  const record = (await db.table(store).get(key)) as Record<string, unknown> | undefined;
  // Removed here since (by a pull): nothing to put; the delete reaches the server too.
  if (!record) return { op: 'delete', kind, id: key };
  const sessionId = sessionIdOf(store as SyncedStore, record);
  if (sessionId !== undefined && !SYNC_ID_PATTERN.test(sessionId)) return null;
  const childOfSession = [
    'documents',
    'utterances',
    'answers',
    'notes',
    'questionBanks',
    // ADR-0077: a call and its notes belong to their session.
    'calls',
    'callNotes',
  ].includes(store);
  if (childOfSession && sessionId === undefined) return null;
  if (jsonBytes(record) > SYNC_LIMITS.recordBytes) return null;
  const baseRev = (await db.syncRevs.get(change.ref))?.rev ?? null;
  return { op: 'put', kind, id: key, ...(sessionId ? { sessionId } : {}), baseRev, record };
}

/**
 * Sends one batch of the outbox (and changed account preferences) and applies the results.
 *
 * @param db        The account's cache.
 * @param transport The server.
 * @param options.maxBytes  Body size limit (a keepalive push must stay under 64 KB).
 * @param options.keepalive True when the page is closing (results may never arrive).
 * @param options.attempts  Per-record count of "session not stored yet" refusals in this page; after
 *                          5 the change is dropped (its session never reached the server).
 * @returns What happened.
 * @throws SyncHttpError or a network error; nothing is lost (the outbox stays), the caller retries.
 * Called from: client.ts; tests
 */
export async function pushOnce(
  db: KiteDb,
  transport: SyncTransport,
  options: { maxBytes?: number; keepalive?: boolean; attempts?: Map<string, number> } = {},
): Promise<PushRound> {
  const maxBytes = options.maxBytes ?? SYNC_LIMITS.requestBytes - 500_000;
  const entries = await db.outbox.orderBy('seq').limit(2000).toArray();
  const prefsDirty = await db.syncMeta.get('prefs');
  const changes = coalesce(entries);
  if (changes.length === 0 && !prefsDirty) return { sent: 0, more: false, pullNeeded: false };

  const outgoing: Outgoing[] = [];
  const unsyncable: PendingChange[] = [];
  let bytes = 0;
  let stoppedEarly = false;
  if (prefsDirty) {
    const op: SyncOp = {
      op: 'put',
      kind: 'prefs',
      id: 'account',
      baseRev: (await db.syncRevs.get(PREFS_REF))?.rev ?? null,
      record: readAccountPrefs(),
    };
    outgoing.push({ change: null, op });
    bytes += jsonBytes(op);
  }
  for (const change of changes) {
    const op = await toOp(db, change);
    if (!op) {
      unsyncable.push(change);
      continue;
    }
    const size = jsonBytes(op); // UTF-8 bytes, as the server counts (ADR-0067)
    if (
      outgoing.length > 0 &&
      (outgoing.length >= SYNC_LIMITS.opsPerPush || bytes + size > maxBytes)
    ) {
      stoppedEarly = true;
      break;
    }
    outgoing.push({ change, op });
    bytes += size;
  }
  if (unsyncable.length > 0) {
    console.warn('sync: changes that cannot sync were dropped', { count: unsyncable.length });
    await db.transaction('rw', db.outbox, async () => {
      for (const change of unsyncable) await clearEntries(db, change.ref, change.lastSeq);
    });
  }
  if (outgoing.length === 0) return { sent: 0, more: stoppedEarly, pullNeeded: false };

  const response = await transport.push(
    outgoing.map((item) => item.op),
    { keepalive: options.keepalive ?? false },
  );
  let pullNeeded = false;
  let retry = false;
  await remote(db, async () => {
    for (const [index, item] of outgoing.entries()) {
      const result: SyncOpResult | undefined = response.results[index];
      if (!result) {
        retry = true;
        continue;
      }
      if (item.change === null) {
        // The account preferences: this device's values win; a conflict only updates the revision.
        if (result.status === 'ok' || result.status === 'conflict') {
          await db.syncRevs.put({ ref: PREFS_REF, rev: result.rev });
        }
        if (result.status === 'ok' && prefsDirty) {
          const current = await db.syncMeta.get('prefs');
          if (current && current.value <= prefsDirty.value) await db.syncMeta.delete('prefs');
        }
        if (result.status === 'conflict') retry = true;
        continue;
      }
      retry = (await applyResult(db, item.change, result, options.attempts)) || retry;
      if (result.status === 'conflict' || result.status === 'deleted') pullNeeded = true;
    }
  });
  // A conflict merge or a delete from another device changed records here: screens reload.
  if (pullNeeded) notifySyncApplied();
  return { sent: outgoing.length, more: stoppedEarly || retry, pullNeeded };
}

/**
 * Applies one push result to the cache (inside the remote transaction).
 *
 * @param db       The account's cache.
 * @param change   The change that was sent.
 * @param result   What the server did.
 * @param attempts Refusal counts (see pushOnce).
 * @returns True when the change must be sent again.
 */
async function applyResult(
  db: KiteDb,
  change: PendingChange,
  result: SyncOpResult,
  attempts: Map<string, number> | undefined,
): Promise<boolean> {
  const { store, key } = parseRef(change.ref);
  switch (result.status) {
    case 'ok':
      await db.syncRevs.put({ ref: change.ref, rev: result.rev });
      await clearEntries(db, change.ref, change.lastSeq);
      return false;
    case 'done':
    case 'exists':
      await clearEntries(db, change.ref, change.lastSeq);
      return false;
    case 'deleted':
      // Deleted on another device: a delete wins, here too.
      await db.table(store).delete(key);
      await db.syncRevs.delete(change.ref);
      await clearEntries(db, change.ref, Infinity);
      return false;
    case 'conflict': {
      // Another device changed it first: keep its copy plus the fields changed here, then resend.
      const local = (await db.table(store).get(key)) as Record<string, unknown> | undefined;
      if (local) await db.table(store).put(mergeChanged(result.record, local, change.changed));
      await db.syncRevs.put({ ref: change.ref, rev: result.rev });
      return true;
    }
    case 'refused':
      if (result.reason === 'transcript_off') {
        // The session does not save its transcript: the line never goes to the server.
        await clearEntries(db, change.ref, change.lastSeq);
        return false;
      }
      {
        const tries = (attempts?.get(change.ref) ?? 0) + 1;
        attempts?.set(change.ref, tries);
        if (tries >= 5) await clearEntries(db, change.ref, change.lastSeq);
      }
      return false;
  }
}

/**
 * Applies one page of pulled records (inside the remote transaction).
 *
 * @param db      The account's cache.
 * @param records The records.
 * @returns How many were applied (older or already-known revisions are skipped).
 */
async function applyPulled(db: KiteDb, records: readonly SyncPulledRecord[]): Promise<number> {
  let applied = 0;
  for (const pulled of records) {
    if (pulled.kind === 'prefs') {
      const known = await db.syncRevs.get(PREFS_REF);
      if (known && known.rev >= pulled.rev) continue;
      // A change made here and not sent yet wins; otherwise take the account's values.
      if (!(await db.syncMeta.get('prefs')) && pulled.record) writeAccountPrefs(pulled.record);
      await db.syncRevs.put({ ref: PREFS_REF, rev: pulled.rev });
      applied += 1;
      continue;
    }
    const store = storeOfKind(pulled.kind);
    if (!store) continue;
    const ref = refOf(store, pulled.id);
    const known = await db.syncRevs.get(ref);
    if (known && known.rev >= pulled.rev) continue;
    const table = db.table(store);
    const pending = coalesce(await db.outbox.where('ref').equals(ref).toArray())[0];
    if (pulled.deleted || !pulled.record) {
      await table.delete(pulled.id);
      await clearEntries(db, ref, Infinity);
    } else if (pending?.op === 'delete') {
      // Deleted here, not sent yet: the delete wins when it is sent.
    } else if (pending) {
      const local = (await table.get(pulled.id)) as Record<string, unknown> | undefined;
      await table.put(local ? mergeChanged(pulled.record, local, pending.changed) : pulled.record);
    } else {
      await table.put(pulled.record);
    }
    await db.syncRevs.put({ ref, rev: pulled.rev });
    applied += 1;
  }
  return applied;
}

/**
 * Applies the account's changes since the last pull, page by page, and remembers this pull's server
 * time (the next pull reaches back SYNC_PULL_OVERLAP_MS before it).
 *
 * @param db        The account's cache.
 * @param transport The server.
 * @returns How many records were applied.
 * @throws SyncHttpError or a network error; pages already applied stay applied.
 * Called from: client.ts; tests
 */
export async function pullAll(db: KiteDb, transport: SyncTransport): Promise<number> {
  const last = await db.syncMeta.get('pull');
  const since = last ? Math.max(0, last.value - SYNC_PULL_OVERLAP_MS) : 0;
  let after: string | null = null;
  let serverTime: number | null = null;
  let applied = 0;
  for (let page = 0; page < 1000; page += 1) {
    const response: SyncPullResponse = await transport.pull(since, after);
    serverTime ??= response.serverTime;
    if (response.records.length > 0) {
      applied += await remote(db, () => applyPulled(db, response.records));
    }
    after = response.next;
    if (!after) break;
  }
  if (serverTime !== null) await db.syncMeta.put({ id: 'pull', value: serverTime });
  // Screens that loaded their data once reload it (events.ts).
  if (applied > 0) notifySyncApplied();
  return applied;
}
