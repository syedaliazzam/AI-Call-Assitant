/**
 * Tests for apps/web/src/core/drive/waitWords.ts (ADR-0106): a recorded call's unfinished upload is
 * 'waiting' while the uploading app has worked on it within a day, 'stalled' after that (movedAt, or the
 * record's last change for older records), and null when it is not on its way (saved, off, waiting for the
 * person, an error). Invented times only.
 */
import { describe, expect, it } from 'vitest';
import {
  UPLOAD_PAUSED_OPEN_APP,
  UPLOAD_STALL_MS,
  WAITING_FOR_DESKTOP,
  pendingUpload,
  uploadOnItsWay,
} from '@/core/drive/waitWords';

const NOW = new Date(2026, 10, 19, 10, 0).getTime();

describe('waitWords', () => {
  it('has the words the dashboard and Meetings show', () => {
    expect(WAITING_FOR_DESKTOP).toBe('Waiting for the desktop app to finish the upload');
    expect(UPLOAD_PAUSED_OPEN_APP).toBe(
      'Upload paused: open the desktop app on the computer used for this call',
    );
    expect(UPLOAD_STALL_MS).toBe(24 * 60 * 60_000);
  });

  it('knows which states are on their way', () => {
    expect(uploadOnItsWay({ state: 'queued' })).toBe(true);
    expect(uploadOnItsWay({ state: 'uploading' })).toBe(true);
    expect(uploadOnItsWay({ state: 'paused' })).toBe(true);
    expect(uploadOnItsWay({ state: 'waiting' })).toBe(true);
    expect(uploadOnItsWay({ state: 'waiting', reason: 'reconnect' })).toBe(false);
    expect(uploadOnItsWay({ state: 'done' })).toBe(false);
    expect(uploadOnItsWay({ state: 'off' })).toBe(false);
    expect(uploadOnItsWay({ state: 'error', reason: 'network' })).toBe(false);
  });

  it('turns stalled after a day without the app working on it', () => {
    const record = (movedAt: number | undefined, updatedAt = NOW) => ({
      drive: { state: 'uploading' as const, ...(movedAt === undefined ? {} : { movedAt }) },
      updatedAt,
    });
    expect(pendingUpload(record(NOW - UPLOAD_STALL_MS + 1), NOW)).toBe('waiting');
    expect(pendingUpload(record(NOW - UPLOAD_STALL_MS), NOW)).toBe('stalled');
    // movedAt wins over a later change of the record (a rename on another device is not progress).
    expect(pendingUpload(record(NOW - UPLOAD_STALL_MS, NOW), NOW)).toBe('stalled');
    // Older records: their last change stands in.
    expect(pendingUpload(record(undefined, NOW - UPLOAD_STALL_MS), NOW)).toBe('stalled');
    expect(pendingUpload(record(undefined, NOW - 1_000), NOW)).toBe('waiting');
    expect(pendingUpload({ drive: { state: 'done' }, updatedAt: 0 }, NOW)).toBeNull();
  });
});
