/**
 * File: apps/web/src/core/storage/summaryFailures.ts
 * Purpose: Documents summaries that could not be written, remembered on this device by the documents'
 *          fingerprint (ADR-0116; the `summaryFailures` store, version 13). core/documents/summary.ts
 *          reads them so it does not ask the server again, and pay again, for the same documents
 *          before the backoff ends. Never synced; holds no document or summary text.
 * Used by: src/core/documents/summary.ts
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0116
 */
import { getDb } from './db';
import type { StoredSummaryFailure } from './types';

/** Failure records older than this (ms since failedAt) are removed when a new one is saved: 7 days. */
export const SUMMARY_FAILURE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reads the failure remembered for a set of documents.
 *
 * @param fingerprint The documents' fingerprint (core/documents/summary.ts documentsFingerprint()).
 * @returns The record, or null when none is remembered.
 * Called from: core/documents/summary.ts (ensureDocumentsSummary, documentsSummaryStatus); tests
 */
export async function getSummaryFailure(fingerprint: string): Promise<StoredSummaryFailure | null> {
  return (await getDb().summaryFailures.get(fingerprint)) ?? null;
}

/**
 * Saves (replaces) the failure remembered for a set of documents, and removes records older than
 * SUMMARY_FAILURE_KEEP_MS (documents since changed or deleted leave theirs behind).
 *
 * @param failure The record to keep.
 * Called from: core/documents/summary.ts; tests
 */
export async function putSummaryFailure(failure: StoredSummaryFailure): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.summaryFailures, async () => {
    await db.summaryFailures.put(failure);
    await db.summaryFailures
      .where('failedAt')
      .below(failure.failedAt - SUMMARY_FAILURE_KEEP_MS)
      .delete();
  });
}

/**
 * Forgets the failure remembered for a set of documents (their summary has now been written).
 *
 * @param fingerprint The documents' fingerprint.
 * Called from: core/documents/summary.ts; tests
 */
export async function clearSummaryFailure(fingerprint: string): Promise<void> {
  await getDb().summaryFailures.delete(fingerprint);
}
