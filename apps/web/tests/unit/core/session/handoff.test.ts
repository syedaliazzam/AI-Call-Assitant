/**
 * Tests apps/web/src/core/session/handoff.ts (spec S9, option B), on an in-memory IndexedDB: the file
 * holds one session and its documents; importing adds it as not started; a newer copy replaces an older
 * one but keeps what happened here; an older file changes nothing; and wrong files are refused.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHandoffFile, importHandoff, mergedHandoffSession } from '@/core/session/handoff';
import { getDb } from '@/core/storage/db';
import { createSessionWithDocuments, getSession, updateSession } from '@/core/storage/sessions';
import { listDocuments } from '@/core/storage/documents';
import { resetDb, sessionInput } from '../storage/helpers';

beforeEach(async () => {
  await resetDb();
});

/**
 * Stores an invented session with one document.
 *
 * @param text The document's text.
 * @returns The session's id.
 */
async function seed(text = 'Invented pricing.'): Promise<string> {
  const session = await createSessionWithDocuments(
    sessionInput({ company: 'Lantern (invented)' }),
    [{ name: 'pricing.txt', text }],
  );
  return session.id;
}

/**
 * Empties this device, as the desktop app's separate storage would be.
 */
async function emptyDevice(): Promise<void> {
  const db = getDb();
  await db.sessions.clear();
  await db.documents.clear();
}

describe('buildHandoffFile', () => {
  it('holds the one session and its documents, and nothing from earlier calls', async () => {
    const id = await seed();
    await seed('Another session.');
    const file = await buildHandoffFile(id, 5_000);
    expect(file?.exportedAt).toBe(5_000);
    expect(file?.sessions.map((session) => session.id)).toEqual([id]);
    expect(file?.documents.map((document) => document.text)).toEqual(['Invented pricing.']);
    expect(file?.utterances).toEqual([]);
    expect(file?.answers).toEqual([]);
    expect(file?.notes).toEqual([]);
  });

  it('gives null for a session that is not here', async () => {
    expect(await buildHandoffFile('86495cda-fbd1-4cea-8387-cd29f5c1381b')).toBeNull();
  });
});

describe('importHandoff', () => {
  it('adds a session with its documents, as not started, whatever state it was in', async () => {
    const id = await seed();
    await updateSession(id, { status: 'ended', lastActiveAt: 900, lastCallMs: 5_000 });
    const text = JSON.stringify(await buildHandoffFile(id, 1_000));
    await emptyDevice();

    expect(await importHandoff(text, id)).toEqual({ ok: true, sessionId: id, outcome: 'added' });
    const stored = await getSession(id);
    expect(stored?.company).toBe('Lantern (invented)');
    expect(stored?.status).toBe('not-started');
    expect(stored?.lastActiveAt).toBeNull();
    expect(stored?.lastCallMs).toBeUndefined();
    expect(stored?.handoffAt).toBe(1_000);
    expect((await listDocuments(id)).map((document) => document.text)).toEqual([
      'Invented pricing.',
    ]);
  });

  it('a newer copy replaces the older one, and keeps what happened here', async () => {
    const id = await seed('First version.');
    const first = JSON.stringify(await buildHandoffFile(id, 1_000));
    // The browser's copy changes, and a newer file is made.
    await updateSession(id, { company: 'Lantern Group (invented)' });
    const db = getDb();
    await db.documents.where('sessionId').equals(id).modify({ text: 'Second version.' });
    const second = JSON.stringify(await buildHandoffFile(id, 2_000));

    await emptyDevice();
    await importHandoff(first, id);
    await updateSession(id, { status: 'ended', lastActiveAt: 1_500, lastCallMs: 60_000 });

    expect(await importHandoff(second, id)).toEqual({
      ok: true,
      sessionId: id,
      outcome: 'replaced',
    });
    const stored = await getSession(id);
    expect(stored?.company).toBe('Lantern Group (invented)');
    expect(stored?.status).toBe('ended');
    expect(stored?.lastCallMs).toBe(60_000);
    expect(stored?.handoffAt).toBe(2_000);
    const documents = await listDocuments(id);
    expect(documents.map((document) => document.text)).toEqual(['Second version.']);
  });

  it('an older file, or the same one again, changes nothing', async () => {
    const id = await seed('First version.');
    const older = JSON.stringify(await buildHandoffFile(id, 1_000));
    await getDb().documents.where('sessionId').equals(id).modify({ text: 'Second version.' });
    const newer = JSON.stringify(await buildHandoffFile(id, 2_000));
    await emptyDevice();
    await importHandoff(newer, id);

    expect(await importHandoff(older, id)).toMatchObject({ ok: true, outcome: 'kept' });
    expect(await importHandoff(newer, id)).toMatchObject({ ok: true, outcome: 'kept' });
    expect((await listDocuments(id)).map((document) => document.text)).toEqual(['Second version.']);
  });

  it('refuses a file for another session, and says which file it wants', async () => {
    const id = await seed();
    const text = JSON.stringify(await buildHandoffFile(id, 1_000));
    const other = '86495cda-fbd1-4cea-8387-cd29f5c1381b';
    const outcome = await importHandoff(text, other);
    expect(outcome).toEqual({
      ok: false,
      message: 'This file is for another session. Choose paramount-ai-session-86495cda.json.',
    });
  });

  it('refuses a file that is not an export, or holds several sessions', async () => {
    expect(await importHandoff('not json')).toMatchObject({ ok: false });
    const a = await buildHandoffFile(await seed(), 1_000);
    const b = await buildHandoffFile(await seed(), 1_000);
    const both = JSON.stringify({ ...a, sessions: [...a!.sessions, ...b!.sessions] });
    expect(await importHandoff(both)).toMatchObject({
      ok: false,
      message: 'This file is not a session hand-off. Choose the file for this session.',
    });
  });
});

describe('mergedHandoffSession', () => {
  it('keeps when the session was made here, and takes the newer details', async () => {
    const id = await seed();
    const incoming = { ...(await getSession(id))!, company: 'New', createdAt: 9 };
    const existing = { ...incoming, company: 'Old', createdAt: 1 };
    const merged = mergedHandoffSession(incoming, existing, 3);
    expect(merged.company).toBe('New');
    expect(merged.createdAt).toBe(1);
  });
});
