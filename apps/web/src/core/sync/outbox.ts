/**
 * File: apps/web/src/core/sync/outbox.ts
 * Purpose: Pure helpers for the outbox (ADR-0049): combines the recorded entries of each record into
 *          one pending change (a later delete wins; changed fields add up; a new record stays new),
 *          and merges a server copy with this device's own changes (only the fields this device
 *          changed are taken from it, so two devices editing different fields both keep theirs).
 * Used by: src/core/sync/engine.ts
 * Depends on: src/core/sync/capture.ts (OutboxEntry)
 * Architecture: ADR-0049 (conflict rule)
 */
import type { OutboxEntry } from './capture';

/** One record's pending change: its entries combined. */
export interface PendingChange {
  /** The record's reference (store|key). */
  ref: string;
  /** Put the current local copy, or delete. */
  op: 'put' | 'delete';
  /** Fields changed on this device (null: the whole record, as for a new one). */
  changed: string[] | null;
  /** The first entry's sequence: changes are sent in the order they began (a session before its lines). */
  firstSeq: number;
  /** The last entry's sequence: entries up to it are done once the change is accepted. */
  lastSeq: number;
}

/**
 * Combines outbox entries (in sequence order) into one change per record.
 *
 * @param entries The entries, any order (sorted here by seq).
 * @returns One change per record, ordered by when its first entry was recorded.
 * Called from: engine.ts (push, pull merges); tests
 */
export function coalesce(entries: readonly OutboxEntry[]): PendingChange[] {
  const byRef = new Map<string, PendingChange>();
  const sorted = [...entries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const entry of sorted) {
    const seq = entry.seq ?? 0;
    const current = byRef.get(entry.ref);
    if (!current) {
      byRef.set(entry.ref, {
        ref: entry.ref,
        op: entry.op,
        changed: entry.op === 'delete' ? null : entry.changed,
        firstSeq: seq,
        lastSeq: seq,
      });
      continue;
    }
    current.lastSeq = seq;
    if (entry.op === 'delete') {
      current.op = 'delete';
      current.changed = null;
    } else if (current.op === 'delete' || current.changed === null || entry.changed === null) {
      // Created again after a delete, or new all along: the whole record is this device's.
      current.op = 'put';
      current.changed = null;
    } else {
      current.changed = [...new Set([...current.changed, ...entry.changed])].sort();
    }
  }
  return [...byRef.values()].sort((a, b) => a.firstSeq - b.firstSeq);
}

/**
 * Merges the server's copy of a record with this device's changes to it.
 *
 * @param server  The server's copy.
 * @param local   This device's copy.
 * @param changed The fields this device changed (null: all of them).
 * @returns The server's copy with this device's changed fields (a field this device removed is
 *          removed).
 * Called from: engine.ts (conflicts, pulls over pending changes); tests
 */
export function mergeChanged(
  server: Record<string, unknown>,
  local: Record<string, unknown>,
  changed: readonly string[] | null,
): Record<string, unknown> {
  if (changed === null) return { ...local };
  const merged: Record<string, unknown> = { ...server };
  for (const field of changed) {
    if (field in local) merged[field] = local[field];
    else delete merged[field];
  }
  return merged;
}
