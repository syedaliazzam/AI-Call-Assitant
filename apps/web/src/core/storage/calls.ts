/**
 * File: apps/web/src/core/storage/calls.ts
 * Purpose: The call records (ADR-0077; the `calls` store, version 12, synced as 'call'): every start of a
 *          session is its own call. The live page makes the record at Connect and writes it again at End,
 *          before anything else; the after-call runner (core/live/afterCall.ts) then finishes its notes and
 *          its Drive queueing from it, also after the call window closed. Times and states only.
 * Used by: src/features/live/LivePage.tsx, src/core/live/afterCall.ts, src/core/review/calls.ts,
 *          src/core/drive/*, tests
 * Depends on: dexie (liveQuery), src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: ADR-0077; docs/architecture/kite-architecture-v3.1.md §7.4
 */
import { liveQuery } from 'dexie';
import { getDb } from './db';
import type { StoredCall } from './types';

/**
 * Saves a call record whole (the live page's Connect).
 *
 * @param call The record.
 * @returns When saved.
 * Called from: LivePage.tsx (Connect); tests
 */
export async function saveCall(call: StoredCall): Promise<void> {
  await getDb().calls.put(call);
}

/**
 * Changes some fields of a call record (its updatedAt is set too). A record that is gone (its session was
 * deleted) is not brought back.
 *
 * @param id      The call.
 * @param changes The fields to change.
 * @param now     The clock.
 * @returns True when the record was there and changed.
 * Called from: LivePage.tsx (End, recording), core/live/afterCall.ts, core/drive (Drive state); tests
 */
export async function updateCall(
  id: string,
  changes: Partial<Omit<StoredCall, 'id' | 'sessionId'>>,
  now: number = Date.now(),
): Promise<boolean> {
  return (await getDb().calls.update(id, { ...changes, updatedAt: now })) > 0;
}

/**
 * One call record.
 *
 * @param id The call.
 * @returns The record, or null.
 * Called from: core/live/afterCall.ts, LivePage.tsx; tests
 */
export async function getCall(id: string): Promise<StoredCall | null> {
  return (await getDb().calls.get(id)) ?? null;
}

/**
 * A session's call records, oldest first.
 *
 * @param sessionId The session.
 * @returns The records.
 * Called from: core/review/calls.ts; tests
 */
export async function listCalls(sessionId: string): Promise<StoredCall[]> {
  const calls = await getDb().calls.where('sessionId').equals(sessionId).toArray();
  return calls.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Every call record made on one device, oldest first (the after-call runner only works on its own).
 *
 * @param deviceId The device (core/live/deviceId.ts).
 * @returns The records.
 * Called from: core/live/afterCall.ts, core/drive/earlierCalls.ts; tests
 */
export async function listDeviceCalls(deviceId: string): Promise<StoredCall[]> {
  const calls = await getDb()
    .calls.filter((call) => call.deviceId === deviceId)
    .toArray();
  return calls.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Keeps one call record up to date (the live page's "notes are being written" line): Dexie reports a
 * change made in any window of this profile.
 *
 * @param id      The call.
 * @param onCall  Called with the record now and after every change (null when there is none).
 * @returns A function that stops watching.
 * Called from: LivePage.tsx; tests
 */
export function watchCall(id: string, onCall: (call: StoredCall | null) => void): () => void {
  const subscription = liveQuery(() => getCall(id)).subscribe({
    next: onCall,
    error: () => undefined,
  });
  return () => subscription.unsubscribe();
}
