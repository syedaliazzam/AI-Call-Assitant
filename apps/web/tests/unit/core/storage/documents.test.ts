/**
 * Tests for apps/web/src/core/storage/documents.ts, on an in-memory IndexedDB (fake-indexeddb):
 * addDocument() stores the text with its character count and refuses a session that does not
 * exist (storing nothing); listDocuments() returns one session's documents oldest first;
 * removeDocument() reports whether it removed something; totalChars() adds up a session's
 * documents. All text is invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/storage/db';
import { addDocument, listDocuments, removeDocument, totalChars } from '@/core/storage/documents';
import { createSession } from '@/core/storage/sessions';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

describe('documents', () => {
  it('stores the text with its character count and lists a session’s documents oldest first', async () => {
    const session = await createSession(sessionInput());
    const other = await createSession(sessionInput());
    const second = await addDocument(
      { sessionId: session.id, name: 'b.txt', text: 'Second document' },
      20,
    );
    const first = await addDocument({ sessionId: session.id, name: 'a.pdf', text: 'First' }, 10);
    await addDocument({ sessionId: other.id, name: 'other.txt', text: 'Not this session' }, 5);

    expect(first).toMatchObject({ sessionId: session.id, name: 'a.pdf', chars: 5, addedAt: 10 });
    expect((await listDocuments(session.id)).map((d) => d.id)).toEqual([first.id, second.id]);
  });

  it('refuses a session that does not exist and stores nothing', async () => {
    await expect(addDocument({ sessionId: 'nope', name: 'x.txt', text: 'x' })).rejects.toThrow(
      'SESSION_NOT_FOUND',
    );
    expect(await getDb().documents.count()).toBe(0);
  });

  it('removes one document and reports whether it existed', async () => {
    const session = await createSession(sessionInput());
    const document = await addDocument({ sessionId: session.id, name: 'x.txt', text: 'abc' });
    expect(await removeDocument(document.id)).toBe(true);
    expect(await removeDocument(document.id)).toBe(false);
    expect(await listDocuments(session.id)).toEqual([]);
  });

  it('adds up a session’s characters', async () => {
    const session = await createSession(sessionInput());
    expect(await totalChars(session.id)).toBe(0);
    await addDocument({ sessionId: session.id, name: 'a.txt', text: '12345' });
    await addDocument({ sessionId: session.id, name: 'b.txt', text: '1234567890' });
    expect(await totalChars(session.id)).toBe(15);
  });
});
