/**
 * Tests for apps/web/src/features/review/CallsList.tsx callDriveText() (ADR-0077; ADR-0106): a recorded
 * call's unfinished upload says "Waiting for the desktop app to finish the upload", and after a day
 * without progress "Upload paused: open the desktop app on the computer used for this call"; a call
 * without a recording keeps the plain words; the other states are unchanged. Invented records only.
 */
import { describe, expect, it } from 'vitest';
import type { CallView } from '@/core/review/calls';
import type { StoredCall } from '@/core/storage/types';
import { callDriveText } from '@/features/review/CallsList';

const NOW = new Date(2026, 10, 19, 10, 0).getTime();
const DAY = 24 * 60 * 60_000;

/**
 * A call with a record.
 * @param drive     Its Drive state.
 * @param recording How it was recorded.
 * @param updatedAt When its record last changed.
 * @returns The call, as callDriveText() reads it.
 */
function call(
  drive: StoredCall['drive'],
  recording: StoredCall['recording'] = 'screen',
  updatedAt = NOW,
): Pick<CallView, 'record' | 'recordings'> {
  return {
    record: {
      id: 'c',
      sessionId: 's',
      startedAt: NOW - 3_600_000,
      endedAt: NOW - 1_800_000,
      durationMs: 1_800_000,
      phase: 'ended',
      deviceId: 'd',
      saveTranscript: true,
      recording,
      notesState: 'saved',
      drive,
      updatedAt,
    },
    recordings: [],
  };
}

describe('callDriveText', () => {
  it('says who finishes a recorded call upload, and what to do after a day', () => {
    const waiting = 'Waiting for the desktop app to finish the upload';
    expect(callDriveText(call({ state: 'queued', movedAt: NOW }), NOW)).toBe(waiting);
    expect(callDriveText(call({ state: 'uploading', movedAt: NOW }), NOW)).toBe(waiting);
    expect(callDriveText(call({ state: 'waiting' }), NOW)).toBe(waiting);
    // Paused for a call keeps its own words while it is fresh.
    expect(callDriveText(call({ state: 'paused', movedAt: NOW }), NOW)).toBe(
      'Drive upload paused for a call',
    );
    expect(callDriveText(call({ state: 'uploading', movedAt: NOW - DAY }), NOW)).toBe(
      'Upload paused: open the desktop app on the computer used for this call',
    );
    expect(callDriveText(call({ state: 'paused' }, 'screen', NOW - DAY), NOW)).toBe(
      'Upload paused: open the desktop app on the computer used for this call',
    );
  });

  it('keeps the plain words for a call without a recording, and for the other states', () => {
    expect(callDriveText(call({ state: 'queued' }, 'off'), NOW)).toBe('Waiting to upload to Drive');
    expect(callDriveText(call({ state: 'uploading' }, 'off'), NOW)).toBe('Uploading to Drive');
    expect(callDriveText(call({ state: 'done' }), NOW)).toBe('Saved to Drive');
    expect(callDriveText(call({ state: 'off' }), NOW)).toBe('Not uploaded to Drive');
    expect(callDriveText({ record: null, recordings: [] }, NOW)).toBeNull();
  });
});
