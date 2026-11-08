/**
 * File: apps/web/src/core/sync/mapping.ts
 * Purpose: Which IndexedDB stores sync to the account, as which record kind (ADR-0049), and how a
 *          record's reference and session are found. Shared by the change capture, the push and the
 *          pull, so all three agree.
 * Used by: src/core/sync/capture.ts, outbox.ts, engine.ts
 * Depends on: @kite/shared (SyncKind)
 * Architecture: ADR-0049
 */
import type { SyncKind } from '@kite/shared';

/** The stores that sync (every store of call data; not the sync bookkeeping stores). */
export const SYNCED_STORES = [
  'sessions',
  'documents',
  'utterances',
  'answers',
  'notes',
  'lessons',
  'library',
  'questionBanks',
  'chats',
  'settings',
] as const;

/** One synced store. */
export type SyncedStore = (typeof SYNCED_STORES)[number];

/** The record kind each store syncs as. */
export const STORE_KIND: Readonly<Record<SyncedStore, SyncKind>> = {
  sessions: 'session',
  documents: 'document',
  utterances: 'utterance',
  answers: 'answer',
  notes: 'notes',
  lessons: 'lesson',
  library: 'library',
  questionBanks: 'questionBank',
  chats: 'chat',
  settings: 'settings',
};

/**
 * The store a kind lives in; undefined for 'prefs' (local storage, prefs.ts) and for any kind this
 * version does not know (a newer app may sync more; such records are ignored, not lost).
 *
 * @param kind The record kind.
 * @returns The store, or undefined.
 * Called from: engine.ts (pull)
 */
export function storeOfKind(kind: string): SyncedStore | undefined {
  return (Object.keys(STORE_KIND) as SyncedStore[]).find((store) => STORE_KIND[store] === kind);
}

/**
 * Whether a store syncs.
 *
 * @param name A store name.
 * @returns True for SYNCED_STORES.
 * Called from: capture.ts
 */
export function isSyncedStore(name: string): name is SyncedStore {
  return (SYNCED_STORES as readonly string[]).includes(name);
}

/** Stores whose records belong to one session (they carry its id; deleting it takes them). */
const SESSION_CHILD_STORES: readonly SyncedStore[] = [
  'documents',
  'utterances',
  'answers',
  'notes',
  'questionBanks',
];

/**
 * The session a record belongs to, for the stores whose records belong to one.
 *
 * @param store  The store.
 * @param record The record.
 * @returns Its session id, or undefined.
 * Called from: engine.ts (building a push)
 */
export function sessionIdOf(
  store: SyncedStore,
  record: Record<string, unknown>,
): string | undefined {
  if (!SESSION_CHILD_STORES.includes(store)) return undefined;
  return typeof record.sessionId === 'string' ? record.sessionId : undefined;
}

/**
 * A record's reference: its store and key in one string (keys are strings in every synced store).
 *
 * @param store The store.
 * @param key   The record's primary key.
 * @returns For example 'sessions|<uuid>'.
 * Called from: capture.ts, engine.ts
 */
export function refOf(store: string, key: unknown): string {
  return `${store}|${String(key)}`;
}

/**
 * Splits a reference.
 *
 * @param ref A reference from refOf().
 * @returns The store and key.
 * Called from: engine.ts
 */
export function parseRef(ref: string): { store: string; key: string } {
  const at = ref.indexOf('|');
  return { store: ref.slice(0, at), key: ref.slice(at + 1) };
}

/** The reference of the account preferences (not a store record; see prefs.ts). */
export const PREFS_REF = 'prefs|account';
