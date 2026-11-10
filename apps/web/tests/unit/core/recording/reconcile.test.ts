/**
 * Tests for apps/web/src/core/recording/reconcile.ts (desktop 1.5.0, ADR-0068): a record gets the file's
 * status, length and size once the shell has finalised it; a file still being written or gone changes
 * nothing; only this computer's records are touched; a record the account no longer has is never made
 * again. On an in-memory IndexedDB; invented values.
 */
import 'fake-indexeddb/auto';
import type { LocalRecording } from '@kite/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileRecordings, recordingChanges } from '@/core/recording/reconcile';
import { getRecording, listRecordings, saveRecording } from '@/core/storage/recordings';
import type { StoredRecording } from '@/core/storage/types';
import type { RecordingHost } from '@/platform';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

/** An invented record, made when the recording started. */
const RECORD: StoredRecording = {
  id: 'r1',
  sessionId: 's1',
  meetingId: 'm1',
  part: 1,
  kind: 'screen',
  startedAt: 1_000,
  durationMs: 0,
  bytes: 0,
  fileName: 'a.mkv',
  hasStereo: false,
  deviceId: 'd1',
  deviceName: 'Laptop',
  status: 'recording',
  updatedAt: 1,
};

/**
 * The shell's entry for a record.
 * @param changes Fields to override.
 * @returns The entry.
 */
function local(changes: Partial<LocalRecording> = {}): LocalRecording {
  return {
    id: 'r1',
    sessionId: 's1',
    meetingId: 'm1',
    part: 1,
    kind: 'screen',
    startedAt: 1_000,
    durationMs: 61_000,
    bytes: 5_000_000,
    fileName: 'a.mkv',
    hasStereo: false,
    status: 'recovered',
    ...changes,
  };
}

describe('recordingChanges', () => {
  it('takes the finalised status, length and size', () => {
    expect(recordingChanges(RECORD, local())).toEqual({
      status: 'recovered',
      durationMs: 61_000,
      bytes: 5_000_000,
    });
    const already = {
      ...RECORD,
      status: 'recovered' as const,
      durationMs: 61_000,
      bytes: 5_000_000,
    };
    expect(recordingChanges(already, local())).toBeNull();
  });

  it('leaves a file being written, or gone, alone', () => {
    expect(recordingChanges(RECORD, local({ status: 'recording' }))).toBeNull();
    expect(recordingChanges(RECORD, local({ status: 'missing' }))).toBeNull();
  });
});

describe('reconcileRecordings', () => {
  it("updates this computer's records only, and never makes one again", async () => {
    await saveRecording(RECORD);
    await saveRecording({ ...RECORD, id: 'r2', deviceId: 'other' });
    const host = {
      device: async () => ({ id: 'd1', name: 'Laptop' }),
      list: async () => [local(), local({ id: 'r2' }), local({ id: 'gone' })],
    } as unknown as RecordingHost;
    expect(await reconcileRecordings(host)).toBe(1);
    expect((await getRecording('r1'))?.status).toBe('recovered');
    expect((await getRecording('r2'))?.status).toBe('recording');
    expect((await listRecordings()).map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});
