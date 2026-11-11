/**
 * Tests for apps/web/src/core/drive/names.ts (ADR-0072): the session folder is "<YYYY-MM-DD> <Company
 * or title> – <Session title>" in local time; unsafe characters, control characters and long names are
 * cleaned; files are "<YYYY-MM-DD HH.mm> Part N.mkv", "… Part N stereo.webm", "… Transcript.txt",
 * "… Transcript.pdf" and "… Notes.pdf". Session details are invented.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_PART,
  callFileDriveName,
  localStamp,
  recordingDriveName,
  sanitiseName,
  sessionFolderName,
  sessionTitle,
} from '@/core/drive/names';

/** 11 Nov 2026, 09:05 local time. */
const AT = new Date(2026, 10, 11, 9, 5).getTime();

describe('sanitiseName', () => {
  it('removes characters no file system allows, control characters and extra spaces', () => {
    expect(sanitiseName('  Acme / Co: "R&D" <EU>?*|\\ \n\t Ltd.  ')).toBe('Acme Co R&D EU Ltd');
    expect(sanitiseName('...')).toBe('');
  });

  it('cuts long names at a word', () => {
    const long = `${'word '.repeat(40)}end`;
    const out = sanitiseName(long);
    expect(out.length).toBeLessThanOrEqual(MAX_NAME_PART);
    expect(out.endsWith('word')).toBe(true);
  });
});

describe('session folder', () => {
  it('names the company and the title, or whichever exists', () => {
    expect(
      sessionFolderName({ type: 'interview', company: 'Acme', role: 'Backend Engineer' }, AT),
    ).toBe('2026-11-11 Acme – Backend Engineer');
    expect(sessionFolderName({ type: 'regular', company: '', role: 'Weekly sync' }, AT)).toBe(
      '2026-11-11 Weekly sync',
    );
    expect(sessionFolderName({ type: 'regular', company: 'Acme', role: 'Acme' }, AT)).toBe(
      '2026-11-11 Acme',
    );
    expect(sessionFolderName({ type: 'mock', company: '', role: '' }, AT)).toBe(
      '2026-11-11 Mock call',
    );
    expect(sessionTitle({ type: 'interview', company: 'A/B', role: 'C:D' })).toBe('A B – C D');
  });
});

describe('file names', () => {
  it('uses local date and time with a dot, never a colon', () => {
    expect(localStamp(AT)).toEqual({ date: '2026-11-11', time: '09.05' });
    expect(recordingDriveName(AT, 1, 'mkv', false)).toBe('2026-11-11 09.05 Part 1.mkv');
    expect(recordingDriveName(AT, 2, 'webm', true)).toBe('2026-11-11 09.05 Part 2 stereo.webm');
    expect(callFileDriveName(AT, 'transcript-txt')).toBe('2026-11-11 09.05 Transcript.txt');
    expect(callFileDriveName(AT, 'transcript-pdf')).toBe('2026-11-11 09.05 Transcript.pdf');
    expect(callFileDriveName(AT, 'notes-pdf')).toBe('2026-11-11 09.05 Notes.pdf');
  });
});
