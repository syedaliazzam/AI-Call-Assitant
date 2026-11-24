/**
 * Tests for apps/web/src/core/storage/summaryFailures.ts (ADR-0116), on fake-indexeddb: a failure is
 * kept by fingerprint and replaced by the next one; clearing forgets it; saving a failure removes
 * records older than seven days; the store is never recorded for sync. All values are invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, selectAccountDatabase } from '@/core/storage/db';
import {
  SUMMARY_FAILURE_KEEP_MS,
  clearSummaryFailure,
  getSummaryFailure,
  putSummaryFailure,
} from '@/core/storage/summaryFailures';
import type { StoredSummaryFailure } from '@/core/storage/types';
import { SYNCED_STORES } from '@/core/sync/mapping';
import { resetDb } from './helpers';

beforeEach(resetDb);

/**
 * A failure record.
 *
 * @param fingerprint Its fingerprint.
 * @param failedAt    When it failed.
 * @param failures    Failures in a row.
 * @returns The record.
 */
function failure(fingerprint: string, failedAt: number, failures = 1): StoredSummaryFailure {
  return { fingerprint, failures, status: 502, failedAt, retryAt: failedAt + 120_000 };
}

describe('summary failures', () => {
  it('keeps a failure by fingerprint, replaces it, and forgets it when cleared', async () => {
    expect(await getSummaryFailure('f1')).toBeNull();
    await putSummaryFailure(failure('f1', 1_000));
    await putSummaryFailure(failure('f1', 2_000, 2));
    expect(await getSummaryFailure('f1')).toEqual(failure('f1', 2_000, 2));
    await clearSummaryFailure('f1');
    expect(await getSummaryFailure('f1')).toBeNull();
  });

  it('removes records older than seven days when a new one is saved', async () => {
    const now = 100 * SUMMARY_FAILURE_KEEP_MS;
    await putSummaryFailure(failure('old', now - SUMMARY_FAILURE_KEEP_MS - 1));
    await putSummaryFailure(failure('recent', now - 1_000));
    await putSummaryFailure(failure('new', now));
    expect(await getSummaryFailure('old')).toBeNull();
    expect(await getSummaryFailure('recent')).not.toBeNull();
    expect(await getSummaryFailure('new')).not.toBeNull();
  });

  it('stays on this device: the store is not synced, even in an account cache', async () => {
    expect((SYNCED_STORES as readonly string[]).includes('summaryFailures')).toBe(false);
    // An account's cache records every change to synced stores in its outbox (ADR-0049).
    selectAccountDatabase('summary-failures-test');
    try {
      await putSummaryFailure(failure('f1', 1));
      expect(await getSummaryFailure('f1')).not.toBeNull();
      expect(await getDb().outbox.count()).toBe(0);
    } finally {
      selectAccountDatabase(null);
    }
  });
});
