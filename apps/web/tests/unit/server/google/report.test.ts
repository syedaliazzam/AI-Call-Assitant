/**
 * Tests for apps/web/src/server/google/report.ts (ADR-0072, 1.6.0): reports merge by file key and
 * recording id (a repeated report changes nothing); the session is complete only when every expected
 * recording part's main file is in Drive (ADR-0080: a stereo file is never waited for, even when an older
 * page reports one; a deleted recording is not waited for either); the email is
 * due when complete or 24 hours after the first report; recipients are the person and the session's own
 * list or the Settings list; older records' files are recognised by name. ADR-0073: each call has its own
 * record key (the session's first record keeps the session id). All values are invented.
 * ADR-0077: the two-step rule (email 1 at the transcript and notes; email 2 for the recording).
 */
import type { DriveNotifyRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  REPORT_WAIT_MS,
  emailDue,
  fileKindOf,
  isComplete,
  mergeRecordingReport,
  mergeReport,
  missingRecordingFiles,
  needsRecordingEmail,
  notificationKey,
  recipientsFor,
  recordingContent,
  recordingKey,
  reportKey,
  splitNotificationKey,
  type SessionReport,
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
  it('waits for every part main file only (ADR-0080), and not for a deleted recording', () => {
    // An older open page still reports the part with a stereo file: the stereo file is not waited for.
    const transcriptOnly = mergeReport(null, BASE);
    expect(missingRecordingFiles(transcriptOnly)).toEqual(['rec:r1:main']);
    expect(isComplete(transcriptOnly)).toBe(false);
    const withMain = mergeReport(transcriptOnly, {
      ...BASE,
      files: [{ name: 'p.mkv', folder: 'Recordings', key: 'rec:r1:main', fileId: 'R1' }],
    });
    expect(missingRecordingFiles(withMain)).toEqual([]);
    expect(isComplete(withMain)).toBe(true);
    expect(emailDue(withMain, 0, 1)).toBe('complete');
    // A second part still holds it back until its main file is in.
    const twoParts = mergeReport(withMain, {
      ...BASE,
      expectedRecordings: [{ id: 'r2', part: 2, stereo: false }],
    });
    expect(missingRecordingFiles(twoParts)).toEqual(['rec:r2:main']);
    expect(isComplete(mergeReport(twoParts, { ...BASE, goneRecordings: ['r2'] }))).toBe(true);
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

describe('record keys (ADR-0073: one email per call)', () => {
  const SESSION = '11111111-1111-4111-8111-111111111111';

  it('keeps the session id for the first record and adds the call for later ones, both ways', () => {
    expect(notificationKey(SESSION, null)).toBe(SESSION);
    expect(notificationKey(SESSION, 1_794_389_400_000)).toBe(`${SESSION}~1794389400000`);
    expect(splitNotificationKey(SESSION)).toEqual({ sessionId: SESSION, call: null, kind: 'call' });
    expect(splitNotificationKey(`${SESSION}~1794389400000`)).toEqual({
      sessionId: SESSION,
      call: 1_794_389_400_000,
      kind: 'call',
    });
  });

  it('sends a report to the first record when there is none or it is the same call, else its own', () => {
    expect(reportKey(SESSION, 100, null)).toBe(SESSION);
    expect(reportKey(SESSION, 100, { callStartedAt: 100 })).toBe(SESSION);
    expect(reportKey(SESSION, 200, { callStartedAt: 100 })).toBe(`${SESSION}~200`);
  });
});

describe('the two-step rule (ADR-0077)', () => {
  /** A two-step report. */
  const TWO: SessionReport = {
    title: 'Acme',
    callStartedAt: 5_000,
    durationMs: 60_000,
    files: [
      { name: 't.txt', folder: 'Transcripts', key: 'call:5000:transcript-txt', fileId: 'T1' },
    ],
    folderUrl: 'https://drive.google.com/drive/folders/F',
    timeZone: 'UTC',
    alsoNotify: null,
    expectedRecordings: [{ id: 'r1', part: 1, stereo: false }],
    goneRecordings: [],
    emailRule: 'two-step',
    callFilesSaved: true,
    recordingsFolderUrl: 'https://drive.google.com/drive/folders/R',
  };

  it('names the recording record by the call, and reads it back', () => {
    expect(recordingKey('s1', 5_000)).toBe('s1~5000~recording');
    expect(splitNotificationKey('s1~5000~recording')).toEqual({
      sessionId: 's1',
      call: 5_000,
      kind: 'recording',
    });
    // A two-step call never makes a new plain record; it uses the first only for the same call.
    expect(reportKey('s1', 5_000, null, true)).toBe('s1~5000');
    expect(reportKey('s1', 5_000, { callStartedAt: 5_000 }, true)).toBe('s1');
    expect(reportKey('s1', 5_000, null)).toBe('s1');
  });

  it('email 1 is due once the transcript and notes are in, without waiting for the recording', () => {
    const merged = mergeReport(null, TWO);
    expect(merged).toMatchObject({ rule: 'two-step', callFilesSaved: true });
    expect(emailDue(merged, 0, 1)).toBe('complete');
    expect(emailDue({ ...merged, callFilesSaved: false }, 0, 1)).toBeNull();
    expect(emailDue({ ...merged, callFilesSaved: false }, 0, REPORT_WAIT_MS)).toBe('overdue');
    // The flag only turns on, and the rule stays.
    const later = mergeReport(merged, { ...TWO, callFilesSaved: false, emailRule: undefined });
    expect(later).toMatchObject({ rule: 'two-step', callFilesSaved: true });
  });

  it('needs email 2 only when a recording is expected and not all in; email 2 waits for it', () => {
    const merged = mergeReport(null, TWO);
    expect(needsRecordingEmail(merged)).toBe(true);
    expect(needsRecordingEmail({ ...merged, gone: ['r1'] })).toBe(false);
    expect(needsRecordingEmail({ ...merged, expected: [] })).toBe(false);
    const recording = recordingContent(merged);
    expect(recording).toMatchObject({
      kind: 'recording',
      files: [],
      recordingsFolderUrl: 'https://drive.google.com/drive/folders/R',
    });
    expect(emailDue(recording, 0, 1)).toBeNull();
    const withFile = mergeRecordingReport(recording, {
      ...TWO,
      files: [
        ...TWO.files,
        { name: 'p1.mkv', folder: 'Recordings', key: 'rec:r1:main', fileId: 'R1' },
      ],
    });
    expect(withFile.files.map((file) => file.key)).toEqual(['rec:r1:main']);
    expect(emailDue(withFile, 0, 1)).toBe('complete');
    expect(needsRecordingEmail(withFile)).toBe(false);
  });
});
