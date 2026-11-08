/**
 * File: apps/web/src/core/sync/capture.ts
 * Purpose: Records every local change to call data in the outbox, in the SAME IndexedDB transaction
 *          as the change (ADR-0049), so a change is never saved without its outbox entry. It is a
 *          Dexie middleware, installed only on an account's cache (kite-u-<id>): it widens each
 *          read-write transaction on a synced store to include the outbox, reads each record before
 *          and after the write, and stores which fields changed (a field-level merge needs them when
 *          another device changed the same record). Changes that came from the server (pulls and
 *          merges) are marked and not recorded.
 * Used by: src/core/storage/db.ts (installed on account databases), src/core/sync/engine.ts
 * Depends on: dexie (DBCore types), src/core/sync/mapping.ts
 * Architecture: ADR-0049
 */
import type {
  DBCore,
  DBCoreMutateRequest,
  DBCoreMutateResponse,
  DBCoreTable,
  DBCoreTransaction,
  Middleware,
} from 'dexie';
import { isSyncedStore, refOf, type SyncedStore } from './mapping';

/** The outbox store's name. */
export const OUTBOX_STORE = 'outbox';

/** One recorded change, waiting to be sent. */
export interface OutboxEntry {
  /** Order of recording (auto-increment). Absent before it is stored. */
  seq?: number;
  /** The record's reference (store|key). */
  ref: string;
  /** What happened to it. */
  op: 'put' | 'delete';
  /** The fields that changed, or null for a new record (every field is new). */
  changed: string[] | null;
  /** When it was recorded (Unix ms). */
  at: number;
}

/** Transactions applying the server's changes: their writes are not recorded. */
const remoteTransactions = new WeakSet<object>();

/**
 * Marks a transaction as applying the server's changes, so its writes are not sent back.
 *
 * @param idbTransaction The IndexedDB transaction (Dexie's `Transaction.idbtrans`).
 * Called from: engine.ts (pull, conflict merges)
 */
export function markRemote(idbTransaction: object): void {
  remoteTransactions.add(idbTransaction);
}

/** Who hears about recorded changes (the sync engine), by store; null when nobody listens. */
let listener: ((store: SyncedStore) => void) | null = null;

/**
 * Sets who hears about recorded changes. The change is not committed yet when it is called: the
 * listener only schedules a push.
 *
 * @param next The listener, or null to stop.
 * Called from: client.ts (start and stop of account sync)
 */
export function onLocalChange(next: ((store: SyncedStore) => void) | null): void {
  listener = next;
}

/**
 * The top-level fields that differ between two copies of a record.
 *
 * @param before The stored copy, or undefined when there was none.
 * @param after  The new copy.
 * @returns The changed field names (sorted), or null when the record is new.
 * Called from: the middleware below; tests
 */
export function changedFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): string[] | null {
  if (!before) return null;
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  // JSON comparison: records are plain JSON-like data (no dates or maps in the synced stores).
  return [...names]
    .filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]))
    .sort();
}

/**
 * The primary keys a write touches.
 *
 * @param table The table.
 * @param req   The write.
 * @returns The keys.
 */
async function keysOf(table: DBCoreTable, req: DBCoreMutateRequest): Promise<unknown[]> {
  switch (req.type) {
    case 'add':
    case 'put':
      return req.keys ?? req.values.map((value) => table.schema.primaryKey.extractKey!(value));
    case 'delete':
      return req.keys;
    case 'deleteRange': {
      const found = await table.query({
        trans: req.trans,
        query: { index: table.schema.primaryKey, range: req.range },
        values: false,
      });
      return found.result;
    }
  }
}

/**
 * Records one write in the outbox, within its transaction.
 *
 * @param down  The layer below (the real database).
 * @param name  The store.
 * @param req   The write.
 * @returns The write's response.
 */
async function recordWrite(
  down: DBCore,
  name: SyncedStore,
  req: DBCoreMutateRequest,
): Promise<DBCoreMutateResponse> {
  const table = down.table(name);
  const keys = await keysOf(table, req);
  const before = (await table.getMany({ trans: req.trans, keys })) as (
    Record<string, unknown> | undefined
  )[];
  const response = await table.mutate(req);
  const deleting = req.type === 'delete' || req.type === 'deleteRange';
  const after = deleting
    ? []
    : ((await table.getMany({ trans: req.trans, keys })) as (
        Record<string, unknown> | undefined
      )[]);
  const at = Date.now();
  const entries: OutboxEntry[] = [];
  keys.forEach((key, index) => {
    if (response.failures[index]) return;
    const ref = refOf(name, key);
    if (deleting) {
      // Only records that existed: deleting nothing has nothing to tell the server.
      if (before[index]) entries.push({ ref, op: 'delete', changed: null, at });
      return;
    }
    const now = after[index];
    if (!now) return;
    const changed = changedFields(before[index], now);
    // A write that changed nothing is not sent.
    if (changed !== null && changed.length === 0) return;
    entries.push({ ref, op: 'put', changed, at });
  });
  if (entries.length > 0) {
    await down.table(OUTBOX_STORE).mutate({ type: 'add', trans: req.trans, values: entries });
    listener?.(name);
  }
  return response;
}

/**
 * The change-capture middleware for an account's cache.
 * Installed by: KiteDb (src/core/storage/db.ts) for account databases only.
 */
export const captureMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'kite-sync-capture',
  // Right above IndexedDB, below Dexie's own layers (cache, observability: level 0). Those read
  // Dexie's transaction context, which is lost after an `await` in this code; IndexedDB's own layer
  // needs none, so this layer's extra reads and outbox writes go straight to it. Dexie's layers
  // still see every write the app makes, as they wrap this one.
  level: -1,
  create(down) {
    return {
      ...down,
      transaction(stores, mode, options): DBCoreTransaction {
        // A read-write transaction on call data also writes the outbox, atomically with it.
        const widened =
          mode === 'readwrite' &&
          stores.some((store) => isSyncedStore(store)) &&
          !stores.includes(OUTBOX_STORE)
            ? [...stores, OUTBOX_STORE]
            : stores;
        return down.transaction(widened, mode, options);
      },
      table(name) {
        const table = down.table(name);
        if (!isSyncedStore(name)) return table;
        return {
          ...table,
          mutate(req) {
            if (remoteTransactions.has(req.trans)) return table.mutate(req);
            return recordWrite(down, name, req);
          },
        };
      },
    };
  },
};
