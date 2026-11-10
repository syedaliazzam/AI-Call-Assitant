/**
 * Tests for apps/web/src/core/storage/recordings.ts (desktop 1.5.0, ADR-0068), on an in-memory
 * IndexedDB: a record is saved, changed (updatedAt set) and read; the list is newest first; a meeting's
 * parts come first part first; a change to a deleted record does nothing; deleting a session takes its
 * recording records (the files are the desktop app's). All values are invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteRecording,
  getRecording,
  listMeetingParts,
  listRecordings,
  saveRecording,
  updateRecording,
  watchRecordings,
} from '@/core/storage/recordings';
import { createSession, deleteSession } from '@/core/storage/sessions';
import type { StoredRecording } from '@/core/storage/types';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/**
 * An invented recording record.
 * @param id      Its id.
 * @param changes Fields to override.
 * @returns The record.
 */
function record(id: string, changes: Partial<StoredRecording> = {}): StoredRecording {
  return {
    id,
    sessionId: 's1',
    meetingId: 'm1',
    part: 1,
    kind: 'screen',
    quality: 'standard',
    startedAt: 1_000,
    durationMs: 0,
    bytes: 0,
    fileName: 'Paramount AI 2026-11-10 14-30-05.mkv',
    hasStereo: true,
    deviceId: 'd1',
    deviceName: 'Laptop',
    status: 'recording',
    updatedAt: 1,
    ...changes,
  };
}

describe('recordings', () => {
  it('saves, changes and reads a record', async () => {
    await saveRecording(record('r1'));
    expect(await updateRecording('r1', { status: 'complete', durationMs: 60_000 })).toBe(true);
    const saved = await getRecording('r1');
    expect(saved?.status).toBe('complete');
    expect(saved?.durationMs).toBe(60_000);
    expect(saved?.updatedAt).toBeGreaterThan(1);
    expect(await getRecording('none')).toBeNull();
  });

  it('lists newest first, and a meeting first part first', async () => {
    await saveRecording(record('a', { startedAt: 1_000, part: 1 }));
    await saveRecording(record('c', { startedAt: 5_000, part: 1, meetingId: 'm2' }));
    await saveRecording(record('b', { startedAt: 3_000, part: 2 }));
    expect((await listRecordings()).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect((await listMeetingParts('m1')).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('does nothing to a record that is gone', async () => {
    expect(await updateRecording('gone', { status: 'complete' })).toBe(false);
    await saveRecording(record('r1'));
    await deleteRecording('r1');
    expect(await listRecordings()).toEqual([]);
  });

  it('goes with its session', async () => {
    const session = await createSession(sessionInput());
    await saveRecording(record('r1', { sessionId: session.id }));
    await saveRecording(record('r2', { sessionId: 'other' }));
    await deleteSession(session.id);
    expect((await listRecordings()).map((r) => r.id)).toEqual(['r2']);
  });

  it('reports the list now and after a change', async () => {
    const seen: string[][] = [];
    const stop = watchRecordings(
      (rows) => seen.push(rows.map((r) => r.id)),
      () => undefined,
    );
    // Each report is waited for, not timed: a busy computer delays them.
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual([]);
    await saveRecording(record('r1'));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['r1']));
    stop();
  });
});
