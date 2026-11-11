/**
 * Tests for apps/web/src/server/google/report.ts (ADR-0072, 1.6.0): reports merge by file key and
 * recording id (a repeated report changes nothing); the session is complete only when every expected
 * recording part and its stereo file are in Drive (a deleted recording is not waited for); the email is
 * due when complete or 24 hours after the first report; recipients are the person and the session's own
 * list or the Settings list; older records' files are recognised by name. All values are invented.
 */
import type { DriveNotifyRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  REPORT_WAIT_MS,
  emailDue,
  fileKindOf,
  isComplete,
  mergeReport,
  missingRecordingFiles,
  recipientsFor,
} from '@/server/google/report';

/** An invented report. */
const BASE: Omit<DriveNotifyRequest, 'sessionId' | 'manualOnly'> = {
  title: 'Acme',
  callStartedAt: 2_000,
  durationMs: 60_000,
  files: [{ name: 't.txt', folder: 'Transcripts', key: 'call:1:transcript-txt', fileId: 'T1' }],
  folderUrl: 'https://drive.google.com/drive/folders/F',
  timeZone: 'UTC',
  alsoNotify: null,
  expectedRecordings: [{ id: 'r1', part: 1, stereo: true }],
  goneRecordings: [],
};

describe('mergeReport', () => {
  it('merges by key and id, keeps the earliest start and the longest length', () => {
    const first = mergeReport(null, BASE);
    const again = mergeReport(first, BASE);
    expect(again.files).toHaveLength(1);
    expect(again.expected).toHaveLength(1);
    const more = mergeReport(again, {
      ...BASE,
      callStartedAt: 1_000,
      durationMs: 5,
      files: [{ name: 'p.mkv', folder: 'Recordings', key: 'rec:r1:main', fileId: 'R1' }],
    });
    expect(more.files.map((f) => f.key)).toEqual(['call:1:transcript-txt', 'rec:r1:main']);
    expect(more).toMatchObject({ callStartedAt: 1_000, durationMs: 60_000 });
  });
});

describe('completeness', () => {
  it('waits for every part and its stereo file, but not for a deleted recording', () => {
    const transcriptOnly = mergeReport(null, BASE);
    expect(missingRecordingFiles(transcriptOnly)).toEqual(['rec:r1:main', 'rec:r1:stereo']);
    const withMain = mergeReport(transcriptOnly, {
      ...BASE,
      files: [{ name: 'p.mkv', folder: 'Recordings', key: 'rec:r1:main', fileId: 'R1' }],
    });
    expect(isComplete(withMain)).toBe(false);
    expect(isComplete(mergeReport(withMain, { ...BASE, goneRecordings: ['r1'] }))).toBe(true);
    expect(isComplete(mergeReport(null, { ...BASE, expectedRecordings: [] }))).toBe(true);
  });

  it('is due when complete, or 24 hours after the first report', () => {
    const waiting = mergeReport(null, BASE);
    expect(emailDue(waiting, 0, REPORT_WAIT_MS - 1)).toBeNull();
    expect(emailDue(waiting, 0, REPORT_WAIT_MS)).toBe('overdue');
    expect(emailDue(mergeReport(null, { ...BASE, expectedRecordings: [] }), 0, 1)).toBe('complete');
  });
});

describe('recipients and older files', () => {
  it('sends to the person and the session list, else the Settings list', () => {
    expect(recipientsFor('Me@x.io', { alsoNotify: null }, ['a@x.io', 'me@x.io'])).toEqual([
      'me@x.io',
      'a@x.io',
    ]);
    expect(recipientsFor('me@x.io', { alsoNotify: ['lead@x.io'] }, ['a@x.io'])).toEqual([
      'me@x.io',
      'lead@x.io',
    ]);
  });

  it("recognises an older record's files by their names", () => {
    expect(
      fileKindOf({ name: '2026-11-11 14.30 Part 2 stereo.webm', folder: 'Recordings' }),
    ).toEqual({
      kind: 'stereo',
      part: 2,
    });
    expect(fileKindOf({ name: '2026-11-11 14.30 Part 1.mkv', folder: 'Recordings' })).toEqual({
      kind: 'recording',
      part: 1,
    });
    expect(fileKindOf({ name: 'x Notes.pdf', folder: 'Transcripts' })?.kind).toBe('notes-pdf');
  });
});
