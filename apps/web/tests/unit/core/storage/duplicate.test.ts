/**
 * Tests duplicateSession(), sessionSetup(), DUPLICATE_FIELDS and updateSession()'s field removal in
 * apps/web/src/core/storage/sessions.ts (ADR-0129), on an in-memory IndexedDB (fake-indexeddb). Duplicate copies
 * the setup only (details, instructions, language, model, answer style, key terms, contact name, logo domain, Drive
 * list), the documents as copied text (new rows, long ones split again) and the question bank, and names the copy;
 * it starts empty (no transcript, answers, notes, documents summary, calls, recordings, last-call length or
 * hand-off time) and not started. Deleting the original or the copy never touches the other's documents or bank.
 * In an account's database every new row is queued for the account (sync), like any new session.
 * All data is invented.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetDb, getDb, selectAccountDatabase } from '@/core/storage/db';
import { listDocuments } from '@/core/storage/documents';
import { getQuestionBank, saveQuestionBank } from '@/core/storage/questionBanks';
import {
  COPY_NAME_MAX,
  createSessionWithDocuments,
  deleteSession,
  DUPLICATE_FIELDS,
  duplicateSession,
  getSession,
  updateSession,
} from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/** A long invented document: more than one stored row holds (ADR-0069), under the 500,000 limit. */
const LONG_TEXT = 'Invented depot routing handbook paragraph. '.repeat(11_000).slice(0, 480_000);

/**
 * An invented session with every setup field set, two documents (one long), a question bank, and call data of
 * every kind (a transcript line, an answer, notes, a call, its notes, a recording record).
 *
 * @returns The session as stored.
 */
async function fullSession(): Promise<Session> {
  const source = await createSessionWithDocuments(
    sessionInput({
      type: 'interview',
      company: 'Alder Foods (invented)',
      companyDomain: 'alder.example',
      role: 'Data engineer',
      description: 'Invented description',
      instructions: 'Invented AI instructions.',
      contactName: 'Priya',
      driveAlsoNotify: ['lead@example.com'],
      preferences: {
        language: 'de',
        model: 'smart',
        style: { format: 'bullets', length: 'detailed', tone: 'technical', star: true },
        keyTerms: 'Alder\nDepot',
      },
      saveTranscript: false,
      autoAnswer: true,
    }),
    [
      { name: 'cv.txt', text: 'Invented CV', kind: 'resume', sourceId: 'library-cv' },
      { name: 'handbook.txt', text: LONG_TEXT },
    ],
    100,
  );
  const db = getDb();
  await db.sessions.update(source.id, {
    status: 'ended',
    lastActiveAt: 900,
    lastCallMs: 60_000,
    handoffAt: 50,
    documentsSummary: { fingerprint: 'f', text: 'Invented summary', createdAt: 120 },
  });
  await saveQuestionBank({
    sessionId: source.id,
    groups: [{ type: 'technical', questions: [{ question: 'Invented Q', answer: 'Invented A' }] }],
    createdAt: 130,
  });
  await db.utterances.add({
    id: 'u1',
    sessionId: source.id,
    speaker: 'them',
    text: 'Invented line',
    tStart: 1,
    tEnd: 2,
  });
  await db.answers.add({
    id: 'a1',
    sessionId: source.id,
    mode: 'answer',
    question: 'Invented question',
    text: 'Invented answer',
    model: 'fast',
    msFirstToken: 1,
    msTotal: 2,
    createdAt: 3,
    rating: null,
    note: '',
  } as never);
  await db.notes.add({ sessionId: source.id } as never);
  await db.calls.add({ id: 'c1', sessionId: source.id } as never);
  await db.callNotes.add({ callId: 'c1', id: 'c1', sessionId: source.id } as never);
  await db.recordings.add({ id: 'r1', sessionId: source.id } as never);
  return (await getSession(source.id))!;
}

/**
 * How many rows of a session's call data a store holds.
 *
 * @param sessionId The session.
 * @returns The counts per store.
 */
async function callData(sessionId: string) {
  const db = getDb();
  return {
    utterances: await db.utterances.where('sessionId').equals(sessionId).count(),
    answers: await db.answers.where('sessionId').equals(sessionId).count(),
    notes: (await db.notes.get(sessionId)) ? 1 : 0,
    calls: await db.calls.where('sessionId').equals(sessionId).count(),
    callNotes: await db.callNotes.where('sessionId').equals(sessionId).count(),
    recordings: await db.recordings.where('sessionId').equals(sessionId).count(),
  };
}

describe('DUPLICATE_FIELDS', () => {
  it('decides for every field a session can have', async () => {
    const source = await fullSession();
    const withName: Session = { ...source, name: 'Invented name' };
    for (const field of Object.keys(withName)) {
      expect(DUPLICATE_FIELDS, `${field} has no Duplicate rule`).toHaveProperty(field);
    }
  });
});

describe('duplicateSession (ADR-0129)', () => {
  it('copies the setup, names the copy, and starts it fresh', async () => {
    const source = await fullSession();
    const copy = await duplicateSession(source.id, 5_000, {
      name: 'Copy of Alder Foods (invented)',
    });
    expect(copy.id).not.toBe(source.id);
    expect(copy).toEqual({
      id: copy.id,
      type: 'interview',
      company: 'Alder Foods (invented)',
      companyDomain: 'alder.example',
      role: 'Data engineer',
      description: 'Invented description',
      instructions: 'Invented AI instructions.',
      contactName: 'Priya',
      driveAlsoNotify: ['lead@example.com'],
      preferences: source.preferences,
      saveTranscript: false,
      autoAnswer: true,
      name: 'Copy of Alder Foods (invented)',
      createdAt: 5_000,
      status: 'not-started',
      lastActiveAt: null,
    });
    // Not the last call's length, the hand-off time or the documents summary.
    expect(copy).not.toHaveProperty('lastCallMs');
    expect(copy).not.toHaveProperty('handoffAt');
    expect(copy).not.toHaveProperty('documentsSummary');
    expect(await getSession(copy.id)).toEqual(copy);
    // The original is untouched.
    expect(await getSession(source.id)).toEqual(source);
  });

  it('copies the documents as new rows with the same text, the long one in parts again', async () => {
    const source = await fullSession();
    const copy = await duplicateSession(source.id, 5_000);
    const original = await listDocuments(source.id);
    const copied = await listDocuments(copy.id);
    expect(
      copied.map(({ name, text, kind, sourceId }) => ({ name, text, kind, sourceId })),
    ).toEqual(original.map(({ name, text, kind, sourceId }) => ({ name, text, kind, sourceId })));
    expect(copied.map((document) => document.id)).not.toEqual(original.map((d) => d.id));
    const rows = await getDb().documents.where('sessionId').equals(copy.id).toArray();
    expect(rows.length).toBe(3);
    for (const row of rows) expect(row.chars).toBeLessThanOrEqual(250_000);
  });

  it('copies the question bank, and none of the call data', async () => {
    const source = await fullSession();
    const copy = await duplicateSession(source.id, 5_000);
    expect(await getQuestionBank(copy.id)).toEqual({
      ...(await getQuestionBank(source.id))!,
      sessionId: copy.id,
    });
    expect(await callData(copy.id)).toEqual({
      utterances: 0,
      answers: 0,
      notes: 0,
      calls: 0,
      callNotes: 0,
      recordings: 0,
    });
  });

  it('keeps each session’s documents and bank when the other is deleted', async () => {
    const source = await fullSession();
    const copy = await duplicateSession(source.id, 5_000);
    const second = await duplicateSession(source.id, 6_000);
    await deleteSession(source.id);
    expect((await listDocuments(copy.id)).map((document) => document.name)).toEqual([
      'cv.txt',
      'handbook.txt',
    ]);
    expect(await getQuestionBank(copy.id)).not.toBeNull();
    await deleteSession(copy.id);
    expect((await listDocuments(second.id)).length).toBe(2);
    expect(await getQuestionBank(second.id)).not.toBeNull();
  });

  it('gives no name without one (a saved mock interview), and clips a long one', async () => {
    const source = await fullSession();
    expect(await duplicateSession(source.id, 5_000)).not.toHaveProperty('name');
    const long = await duplicateSession(source.id, 5_000, { name: `Copy of ${'x'.repeat(300)}` });
    expect(long.name?.length).toBe(COPY_NAME_MAX);
  });

  it('copies preferences as new objects (changing the copy never changes the original)', async () => {
    const source = await fullSession();
    const copy = await duplicateSession(source.id, 5_000);
    await updateSession(copy.id, { preferences: { ...copy.preferences, language: 'fr' } });
    expect((await getSession(source.id))!.preferences.language).toBe('de');
  });

  it('refuses a session that does not exist, and writes nothing', async () => {
    await expect(duplicateSession('nope')).rejects.toThrow('SESSION_NOT_FOUND');
    expect(await getDb().sessions.count()).toBe(0);
  });
});

describe('updateSession: a field changed to undefined is removed (Rename clears a copy’s name)', () => {
  it('removes the name', async () => {
    const source = await fullSession();
    const copy = await duplicateSession(source.id, 5_000, { name: 'Copy of Alder' });
    const renamed = await updateSession(copy.id, { company: 'Lantern', name: undefined });
    expect(renamed).not.toHaveProperty('name');
    expect(await getSession(copy.id)).not.toHaveProperty('name');
  });
});

describe('the copy reaches the account (sync)', () => {
  beforeEach(async () => {
    selectAccountDatabase('user-duplicate-test');
    await getDb().delete();
    forgetDb();
  });

  afterEach(async () => {
    await getDb().delete();
    selectAccountDatabase(null);
    forgetDb();
  });

  it('queues the new session, its document rows and its bank as new records', async () => {
    const source = await fullSession();
    await getDb().outbox.clear();
    const copy = await duplicateSession(source.id, 5_000, { name: 'Copy of Alder' });
    const entries = await getDb().outbox.toArray();
    const refs = entries.map((entry) => entry.ref);
    expect(refs).toContain(`sessions|${copy.id}`);
    expect(refs).toContain(`questionBanks|${copy.id}`);
    const rows = await getDb().documents.where('sessionId').equals(copy.id).toArray();
    for (const row of rows) expect(refs).toContain(`documents|${row.id}`);
    expect(entries.every((entry) => entry.op === 'put')).toBe(true);
    // Nothing of the original is queued again.
    expect(refs.some((ref) => ref.endsWith(source.id))).toBe(false);
  });
});
