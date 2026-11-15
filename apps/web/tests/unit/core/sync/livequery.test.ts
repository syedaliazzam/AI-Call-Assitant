/**
 * Tests that pulled records reach the screens (ADR-0049): a live query on the account cache (as the
 * dashboard's watchSessions) is told when a pull adds or removes a session, even though the pull's
 * writes are marked as coming from the server and are not recorded in the outbox; screens that load
 * once (the dashboard) hear about it through onSyncApplied, and a pull that changes nothing is silent.
 */
import 'fake-indexeddb/auto';
import type { SyncPullResponse } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetDb, getDb, selectAccountDatabase } from '@/core/storage/db';
import { watchSessions } from '@/core/storage/sessions';
import { pullAll, type SyncTransport } from '@/core/sync/engine';
import { onSyncApplied } from '@/core/sync/events';
import { sessionInput } from '../storage/helpers';

/**
 * A server that answers one pull with the given records, then nothing.
 *
 * @param pages The pull responses' records, one array per pull.
 * @returns The transport.
 */
function serverWith(pages: SyncPullResponse['records'][]): SyncTransport {
  let call = 0;
  return {
    push: async () => ({ results: [] }),
    pull: async () => ({ records: pages[call++] ?? [], serverTime: Date.now(), next: null }),
  };
}

beforeEach(async () => {
  selectAccountDatabase('user-livequery-test', true);
  await getDb().delete();
  forgetDb();
});

afterEach(async () => {
  await getDb().delete();
  selectAccountDatabase(null, false);
  forgetDb();
});

describe('pulled records and live queries', () => {
  it('a watched session list hears about a pulled session and its delete', async () => {
    const seen: number[] = [];
    const stop = watchSessions(
      (sessions) => seen.push(sessions.length),
      () => undefined,
    );
    await new Promise((done) => setTimeout(done, 50));
    const record = {
      id: 'pulled-1',
      ...sessionInput(),
      createdAt: 1,
      status: 'not-started',
      lastActiveAt: null,
    };
    await pullAll(
      getDb(),
      serverWith([
        [{ kind: 'session', id: 'pulled-1', sessionId: null, rev: 1, deleted: false, record }],
      ]),
    );
    await expect.poll(() => seen.at(-1), { timeout: 2_000 }).toBe(1);
    await pullAll(
      getDb(),
      serverWith([
        [{ kind: 'session', id: 'pulled-1', sessionId: null, rev: 2, deleted: true, record: null }],
      ]),
    );
    await expect.poll(() => seen.at(-1), { timeout: 2_000 }).toBe(0);
    stop();
  });

  it('tells screens that load once, and stays silent when nothing changed', async () => {
    let heard = 0;
    const stop = onSyncApplied(() => (heard += 1));
    const record = {
      id: 'pulled-2',
      ...sessionInput(),
      createdAt: 1,
      status: 'not-started',
      lastActiveAt: null,
    };
    await pullAll(
      getDb(),
      serverWith([
        [{ kind: 'session', id: 'pulled-2', sessionId: null, rev: 5, deleted: false, record }],
      ]),
    );
    expect(heard).toBe(1);
    await pullAll(getDb(), serverWith([[]]));
    expect(heard).toBe(1);
    stop();
  });
});
