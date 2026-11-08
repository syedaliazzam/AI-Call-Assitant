/**
 * Tests for apps/web/src/core/sync/client.ts (ADR-0049), with fake timers, fake-indexeddb and a fake
 * server: nothing starts without an account cache; start pulls, then pushes what waits; a change is
 * pushed after 2 s; transcript lines wait for 15 s or 50 lines; nothing is pushed while an answer
 * streams, and the push follows once it ends; a failed push is retried after 2 s; End
 * (flushAccountSync) pushes at once; stop removes the timers and listeners.
 */
import 'fake-indexeddb/auto';
import type { SyncOp, SyncPushResponse } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetDb, getDb, selectAccountDatabase } from '@/core/storage/db';
import { createSession } from '@/core/storage/sessions';
import { saveUtterance } from '@/core/storage/utterances';
import {
  CHANGE_DELAY_MS,
  LINES_BATCH,
  LINES_EVERY_MS,
  flushAccountSync,
  startAccountSync,
} from '@/core/sync/client';
import type { SyncTransport } from '@/core/sync/engine';
import { holdSyncForAnswer } from '@/core/sync/foreground';
import { sessionInput } from '../storage/helpers';

/**
 * A fake server that accepts everything and counts what it got.
 *
 * @returns The transport, what it received, and a switch to fail the next push.
 */
function fakeServer() {
  let rev = 0;
  let failNext = false;
  const pushes: SyncOp[][] = [];
  const transport: SyncTransport = {
    push: vi.fn(async (ops: SyncOp[]): Promise<SyncPushResponse> => {
      if (failNext) {
        failNext = false;
        throw new TypeError('Failed to fetch');
      }
      pushes.push(ops);
      return { results: ops.map(() => ({ status: 'ok' as const, rev: (rev += 1) })) };
    }),
    pull: vi.fn(async () => ({ records: [], serverTime: Date.now(), next: null })),
  };
  return {
    transport,
    pushes,
    /** Makes the next push fail like a dropped connection. */
    failOnce: () => {
      failNext = true;
    },
  };
}

/**
 * A window stand-in that keeps its listeners.
 *
 * @returns The stand-in.
 */
function fakeWindow() {
  const listeners = new Map<string, () => void>();
  return {
    navigator: { onLine: true },
    addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
    listeners,
  };
}

/**
 * Lets the fake database work: it schedules with the real setImmediate, which fake timers leave alone
 * but advancing them does not wait for.
 */
async function letDatabaseRun(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((done) => setImmediate(done));
}

/**
 * Moves the clock in small steps, letting the database work between them.
 *
 * @param ms How far to move the clock.
 */
async function advance(ms: number): Promise<void> {
  let left = ms;
  do {
    await letDatabaseRun();
    const step = Math.min(50, left);
    await vi.advanceTimersByTimeAsync(step);
    left -= step;
  } while (left > 0);
  await letDatabaseRun();
}

beforeEach(async () => {
  // Timers only: the fake database's own scheduling stays real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  selectAccountDatabase('user-client-test');
  await getDb().delete();
  forgetDb();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await getDb().delete();
  selectAccountDatabase(null);
  forgetDb();
});

describe('startAccountSync', () => {
  it('does nothing without an account cache', async () => {
    selectAccountDatabase(null);
    const server = fakeServer();
    const stop = startAccountSync({ transport: server.transport, target: fakeWindow() });
    await advance(5_000);
    expect(server.transport.pull).not.toHaveBeenCalled();
    stop();
  });

  it('pulls first, then pushes a change after the short delay', async () => {
    const server = fakeServer();
    const stop = startAccountSync({ transport: server.transport, target: fakeWindow() });
    await advance(10);
    expect(server.transport.pull).toHaveBeenCalledTimes(1);
    await createSession(sessionInput());
    await advance(CHANGE_DELAY_MS - 100);
    expect(server.pushes).toHaveLength(0);
    await advance(200);
    expect(server.pushes.flat().map((op) => op.op)).toEqual(['put']);
    stop();
  });

  it('batches transcript lines: 15 s for a few, at once for 50', async () => {
    const server = fakeServer();
    const stop = startAccountSync({ transport: server.transport, target: fakeWindow() });
    const session = await createSession(sessionInput());
    await advance(CHANGE_DELAY_MS + 100);
    const line = (n: number) =>
      saveUtterance({
        id: `${session.id}:call:${n}`,
        sessionId: session.id,
        speaker: 'them',
        text: 'Invented line.',
        tStart: n,
        tEnd: n + 1,
      });
    await line(1);
    await advance(LINES_EVERY_MS - 1_000);
    expect(server.pushes).toHaveLength(1);
    await advance(1_100);
    expect(server.pushes).toHaveLength(2);
    for (let n = 2; n < 2 + LINES_BATCH; n += 1) await line(n);
    await advance(50);
    expect(server.pushes).toHaveLength(3);
    stop();
  });

  it('waits while an answer streams, then pushes', async () => {
    const server = fakeServer();
    const stop = startAccountSync({ transport: server.transport, target: fakeWindow() });
    await advance(10);
    const release = holdSyncForAnswer();
    await createSession(sessionInput());
    await advance(CHANGE_DELAY_MS + 5_000);
    expect(server.pushes).toHaveLength(0);
    release();
    await advance(50);
    expect(server.pushes).toHaveLength(1);
    stop();
  });

  it('retries a failed push after a short wait, and End pushes at once', async () => {
    const server = fakeServer();
    const stop = startAccountSync({ transport: server.transport, target: fakeWindow() });
    await advance(10);
    server.failOnce();
    await createSession(sessionInput());
    await advance(CHANGE_DELAY_MS + 50);
    expect(server.pushes).toHaveLength(0);
    await advance(2_100);
    expect(server.pushes).toHaveLength(1);

    await createSession(sessionInput());
    await flushAccountSync();
    expect(server.pushes).toHaveLength(2);
    stop();
  });

  it('stop removes its listeners', async () => {
    const server = fakeServer();
    const target = fakeWindow();
    const stop = startAccountSync({ transport: server.transport, target });
    expect([...target.listeners.keys()].sort()).toEqual(['focus', 'online', 'pagehide']);
    stop();
    expect(target.listeners.size).toBe(0);
  });
});
