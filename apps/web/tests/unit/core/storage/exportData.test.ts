/**
 * Tests for apps/web/src/core/storage/exportData.ts (Day 6), on invented data in a fake
 * IndexedDB: the export (layout 2) holds sessions, documents with their text, transcript lines,
 * answers, notes and lessons; parseExport() accepts it and rejects non-JSON, other JSON, a
 * newer version and damaged records (naming the place, not the content); importData() into an
 * empty database restores everything, and importing again (or into a database that already has
 * the records, or the same lesson decision under another id) adds nothing; a layout 1 file
 * (documents by name only) still imports, and counts those documents to attach again.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveAnswer } from '@/core/storage/answers';
import { getDb } from '@/core/storage/db';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportData,
  exportFileName,
  importData,
  parseExport,
} from '@/core/storage/exportData';
import { saveLesson } from '@/core/storage/lessons';
import { saveNotes } from '@/core/storage/notes';
import { createSessionWithDocuments } from '@/core/storage/sessions';
import type { StoredLesson } from '@/core/storage/types';
import { saveUtterance } from '@/core/storage/utterances';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/**
 * An invented lesson decision.
 *
 * @param id        Its id.
 * @param sourceKey Its original proposal (normalised).
 * @returns The decision.
 */
function lesson(id: string, sourceKey: string): StoredLesson {
  return {
    id,
    text: 'Give the monthly price first.',
    scope: 'sales',
    status: 'approved',
    sourceSessionId: 's-old',
    sourceKey,
    evidence: 'Answer at 0:32, thumbs down.',
    decidedAt: 10,
    approvedAt: 10,
  };
}

/**
 * Fills the database with one invented session and everything that belongs to it.
 *
 * @returns The session id.
 */
async function fill(): Promise<string> {
  const session = await createSessionWithDocuments(
    sessionInput({ company: 'Harbor Lane Freight' }),
    [{ name: 'pricing.txt', text: 'Invented price list: 52 dollars per seat.' }],
  );
  await saveUtterance({
    id: 'u1',
    sessionId: session.id,
    speaker: 'them',
    text: 'WHAT DOES IT COST',
    tStart: 1,
    tEnd: 2,
  });
  await saveAnswer({
    id: 'a1',
    sessionId: session.id,
    mode: 'answer',
    question: 'What does it cost?',
    text: '52 dollars per seat.',
    model: 'fast',
    msFirstToken: 900,
    msTotal: 1500,
    createdAt: 3,
    rating: 'up',
    note: '',
  });
  await saveNotes({
    sessionId: session.id,
    notes: {
      summary: ['Pricing discussed.'],
      questions: [],
      nextSteps: [],
      unclear: [],
      lessons: [],
    },
    callStartedAt: 1,
    createdAt: 4,
  });
  await saveLesson(lesson('l1', 'give the monthly price first'));
  return session.id;
}

describe('exportData', () => {
  it('exports every kind of record, documents with their text', async () => {
    await fill();
    const file = await exportData(1_762_041_600_000);
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.version).toBe(EXPORT_VERSION);
    expect(file.sessions).toHaveLength(1);
    expect(file.documents).toEqual([
      expect.objectContaining({
        name: 'pricing.txt',
        chars: 41,
        text: 'Invented price list: 52 dollars per seat.',
      }),
    ]);
    expect([
      file.utterances.length,
      file.answers.length,
      file.notes.length,
      file.lessons.length,
    ]).toEqual([1, 1, 1, 1]);
    expect(exportFileName(1_762_041_600_000)).toBe('kite-export-2025-11-02.json');
  });
});

describe('parseExport', () => {
  it('accepts an export and rejects other files', async () => {
    await fill();
    const text = JSON.stringify(await exportData());
    expect(parseExport(text).ok).toBe(true);
    expect(parseExport('not json')).toEqual({
      ok: false,
      error: expect.stringContaining('not JSON'),
    });
    expect(parseExport('{"hello":1}')).toEqual({
      ok: false,
      error: 'This file is not a Kite export.',
    });
    const newer = { ...JSON.parse(text), version: EXPORT_VERSION + 1 };
    expect(parseExport(JSON.stringify(newer))).toEqual({
      ok: false,
      error: expect.stringContaining('newer version'),
    });
  });

  it('rejects a damaged record and names only the place', async () => {
    await fill();
    const file = JSON.parse(JSON.stringify(await exportData()));
    file.answers[0].rating = 'excellent';
    const result = parseExport(JSON.stringify(file));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('answers.0.rating') });
    expect(JSON.stringify(result)).not.toContain('52 dollars');
  });
});

describe('importData', () => {
  it('restores everything into an empty database, and a second import adds nothing', async () => {
    const sessionId = await fill();
    const parsed = parseExport(JSON.stringify(await exportData()));
    if (!parsed.ok) throw new Error(parsed.error);
    await resetDb();

    const first = await importData(parsed.file);
    expect(first.sessions).toEqual({ added: 1, skipped: 0 });
    expect(
      first.utterances.added + first.answers.added + first.notes.added + first.lessons.added,
    ).toBe(4);
    expect(first.documents).toEqual({ added: 1, skipped: 0 });
    expect(first.documentsToReattach).toBe(0);
    const db = getDb();
    expect((await db.sessions.get(sessionId))?.company).toBe('Harbor Lane Freight');
    expect((await db.answers.get('a1'))?.rating).toBe('up');
    // The document comes back with its text: a restore is complete.
    expect((await db.documents.toArray())[0]?.text).toBe(
      'Invented price list: 52 dollars per seat.',
    );

    const second = await importData(parsed.file);
    expect(second.sessions).toEqual({ added: 0, skipped: 1 });
    expect(second.answers).toEqual({ added: 0, skipped: 1 });
    expect(second.lessons).toEqual({ added: 0, skipped: 1 });
    expect(second.documents).toEqual({ added: 0, skipped: 1 });
    expect(second.documentsToReattach).toBe(0);
    expect(await db.answers.count()).toBe(1);
  });

  it('imports a layout 1 file (documents by name only) and counts them to attach again', async () => {
    await fill();
    const parsed = parseExport(JSON.stringify(await exportData()));
    if (!parsed.ok) throw new Error(parsed.error);
    const older = {
      ...parsed.file,
      version: 1,
      documents: parsed.file.documents.map(({ text: _text, ...metadata }) => metadata),
    };
    const reparsed = parseExport(JSON.stringify(older));
    if (!reparsed.ok) throw new Error(reparsed.error);
    await resetDb();

    const summary = await importData(reparsed.file);
    expect(summary.sessions.added).toBe(1);
    expect(summary.documents).toEqual({ added: 0, skipped: 0 });
    expect(summary.documentsToReattach).toBe(1);
    expect(await getDb().documents.count()).toBe(0);
  });

  it('keeps local records, and skips the same lesson decision under another id', async () => {
    await fill();
    const parsed = parseExport(JSON.stringify(await exportData()));
    if (!parsed.ok) throw new Error(parsed.error);
    parsed.file.answers[0]!.note = 'changed in the file';
    parsed.file.lessons = [lesson('l-other-id', 'give the monthly price first')];

    const summary = await importData(parsed.file);
    expect(summary.answers).toEqual({ added: 0, skipped: 1 });
    expect(summary.lessons).toEqual({ added: 0, skipped: 1 });
    // The local answer is kept as it was.
    expect((await getDb().answers.get('a1'))?.note).toBe('');
    expect(await getDb().lessons.count()).toBe(1);
  });
});
