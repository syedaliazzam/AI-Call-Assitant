/**
 * Tests for apps/web/src/core/storage/sessions.ts, on an in-memory IndexedDB (fake-indexeddb):
 * create/get (new sessions are 'not-started' with no activity yet; unknown ids give null);
 * listSessions() is newest first, filters by type and searches company, role and description
 * ignoring case; updateSession() keeps id and createdAt and fails for unknown ids;
 * createSessionWithDocuments() and updateSessionWithDocuments() save a session and its document
 * changes all-or-nothing (and never touch another session's documents);
 * markSessionActive() sets 'live' and lastActiveAt; shownStatus() shows a 'live' session with no
 * activity for over 12 hours as 'ended'; deleteSession() removes the session's documents,
 * transcript lines, answers and notes in one go and leaves other sessions alone.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/storage/db';
import { addDocument, listDocuments } from '@/core/storage/documents';
import {
  createSession,
  createSessionWithDocuments,
  deleteSession,
  getSession,
  listSessions,
  markSessionActive,
  shownStatus,
  STALE_LIVE_MS,
  updateSession,
  updateSessionWithDocuments,
} from '@/core/storage/sessions';
import { listUtterances, saveUtterance } from '@/core/storage/utterances';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

describe('createSession / getSession', () => {
  it('stores a new session as not-started with no activity yet', async () => {
    const session = await createSession(sessionInput(), 1_000);
    expect(session).toMatchObject({
      company: 'Bluefin Route',
      createdAt: 1_000,
      status: 'not-started',
      lastActiveAt: null,
    });
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getSession(session.id)).toEqual(session);
  });

  it('returns null for an unknown id', async () => {
    expect(await getSession('nope')).toBeNull();
  });
});

describe('listSessions', () => {
  /**
   * Stores three invented sessions created at times 1, 2 and 3.
   *
   * @returns The sessions: a (sales, Acme), b (interview, Globex), c (sales, mentions ACME).
   */
  async function three() {
    const a = await createSession(sessionInput({ type: 'sales', company: 'Acme' }), 1);
    const b = await createSession(
      sessionInput({ type: 'interview', company: 'Globex', role: 'Data Engineer' }),
      2,
    );
    const c = await createSession(
      sessionInput({ type: 'sales', company: 'Initech', description: 'Pilot for ACME team' }),
      3,
    );
    return { a, b, c };
  }

  it('lists all sessions newest first', async () => {
    const { a, b, c } = await three();
    expect((await listSessions()).map((s) => s.id)).toEqual([c.id, b.id, a.id]);
  });

  it('filters by type', async () => {
    const { a, c } = await three();
    expect((await listSessions({ type: 'sales' })).map((s) => s.id)).toEqual([c.id, a.id]);
    expect(await listSessions({ type: 'support' })).toEqual([]);
  });

  it('searches company, role and description, ignoring case and spaces', async () => {
    const { a, b, c } = await three();
    // "acme" matches Acme (company) and "Pilot for ACME team" (description).
    expect((await listSessions({ search: '  acme ' })).map((s) => s.id)).toEqual([c.id, a.id]);
    expect((await listSessions({ search: 'data eng' })).map((s) => s.id)).toEqual([b.id]);
    expect(await listSessions({ search: 'zzz' })).toEqual([]);
    expect(await listSessions({ search: '   ' })).toHaveLength(3);
  });

  it('combines the type filter and the search', async () => {
    const { a, c } = await three();
    expect((await listSessions({ type: 'sales', search: 'acme' })).map((s) => s.id)).toEqual([
      c.id,
      a.id,
    ]);
    // Globex (interview) does not mention Acme; the Acme sessions are sales.
    expect(await listSessions({ type: 'interview', search: 'acme' })).toEqual([]);
  });
});

describe('updateSession / markSessionActive', () => {
  it('changes fields but never the id or the creation time', async () => {
    const session = await createSession(sessionInput(), 5);
    const updated = await updateSession(session.id, {
      company: 'Northwind Logistics',
      saveTranscript: false,
    });
    expect(updated).toMatchObject({
      id: session.id,
      createdAt: 5,
      company: 'Northwind Logistics',
      saveTranscript: false,
    });
    expect(await getSession(session.id)).toEqual(updated);
  });

  it('fails for an unknown id', async () => {
    await expect(updateSession('nope', { company: 'X' })).rejects.toThrow('SESSION_NOT_FOUND');
  });

  it('marks a session live with its last activity time', async () => {
    const session = await createSession(sessionInput(), 5);
    expect(await markSessionActive(session.id, 9_000)).toMatchObject({
      status: 'live',
      lastActiveAt: 9_000,
    });
  });
});

describe('shownStatus', () => {
  it('shows not-started and ended sessions as stored', async () => {
    const session = await createSession(sessionInput(), 0);
    expect(shownStatus(session, 10 * STALE_LIVE_MS)).toBe('not-started');
    expect(shownStatus({ ...session, status: 'ended' }, 0)).toBe('ended');
  });

  it('shows a live session as live within 12 hours of its last activity', async () => {
    const session = await markSessionActive((await createSession(sessionInput(), 0)).id, 1_000);
    expect(shownStatus(session, 1_000 + STALE_LIVE_MS)).toBe('live');
  });

  it('shows a live session with no activity for over 12 hours as ended (crash, closed window)', async () => {
    const session = await markSessionActive((await createSession(sessionInput(), 0)).id, 1_000);
    expect(shownStatus(session, 1_000 + STALE_LIVE_MS + 1)).toBe('ended');
    // The stored status is not changed.
    expect((await getSession(session.id))?.status).toBe('live');
  });

  it('uses the creation time when a live session has no activity time', async () => {
    const session = { ...(await createSession(sessionInput(), 0)), status: 'live' as const };
    expect(shownStatus(session, STALE_LIVE_MS)).toBe('live');
    expect(shownStatus(session, STALE_LIVE_MS + 1)).toBe('ended');
  });
});

describe('createSessionWithDocuments / updateSessionWithDocuments', () => {
  it('creates a session with its documents, in the order added', async () => {
    const session = await createSessionWithDocuments(
      sessionInput(),
      [
        { name: 'first.pdf', text: 'Invented one' },
        { name: 'second.txt', text: 'Invented two' },
      ],
      100,
    );
    const documents = await listDocuments(session.id);
    expect(documents.map((d) => d.name)).toEqual(['first.pdf', 'second.txt']);
    expect(documents[0]).toMatchObject({ chars: 12, addedAt: 100 });
  });

  it('stores nothing when part of the creation fails', async () => {
    // A document without text cannot be stored (chars needs text.length), so the transaction
    // fails after the session was added: the session must not remain.
    await expect(
      createSessionWithDocuments(sessionInput(), [
        { name: 'bad.txt', text: undefined as unknown as string },
      ]),
    ).rejects.toThrow();
    expect(await listSessions()).toEqual([]);
  });

  it('saves field changes, adds new documents and removes chosen ones in one go', async () => {
    const session = await createSessionWithDocuments(sessionInput(), [
      { name: 'keep.txt', text: 'Keep' },
      { name: 'drop.txt', text: 'Drop' },
    ]);
    const other = await createSessionWithDocuments(sessionInput(), [
      { name: 'other.txt', text: 'Other session' },
    ]);
    const [keep, drop] = await listDocuments(session.id);
    const [otherDocument] = await listDocuments(other.id);

    const updated = await updateSessionWithDocuments(
      session.id,
      { company: 'Northwind Logistics' },
      [{ name: 'new.txt', text: 'New' }],
      // A document id from another session is ignored.
      [drop!.id, otherDocument!.id],
    );
    expect(updated.company).toBe('Northwind Logistics');
    expect((await listDocuments(session.id)).map((d) => d.id)).toEqual([
      keep!.id,
      expect.any(String),
    ]);
    expect((await listDocuments(session.id)).map((d) => d.name)).toEqual(['keep.txt', 'new.txt']);
    expect(await listDocuments(other.id)).toHaveLength(1);
  });

  it('changes nothing for an unknown session', async () => {
    await expect(
      updateSessionWithDocuments('nope', { company: 'X' }, [{ name: 'a.txt', text: 'a' }], []),
    ).rejects.toThrow('SESSION_NOT_FOUND');
    expect(await getDb().documents.count()).toBe(0);
  });
});

describe('deleteSession', () => {
  it('removes the session with its documents, transcript lines, answers and notes', async () => {
    const gone = await createSession(sessionInput(), 1);
    const kept = await createSession(sessionInput({ company: 'Kept Co' }), 2);
    for (const session of [gone, kept]) {
      await addDocument({ sessionId: session.id, name: 'notes.txt', text: 'Invented text.' });
      await addDocument({ sessionId: session.id, name: 'plan.txt', text: 'More invented text.' });
      await saveUtterance({
        id: `${session.id}-u1`,
        sessionId: session.id,
        speaker: 'them',
        text: 'Invented line',
        tStart: 1,
        tEnd: 2,
      });
      await getDb().answers.add({
        id: `${session.id}-a1`,
        sessionId: session.id,
        mode: 'answer',
        question: 'Invented question?',
        text: 'Invented answer.',
        model: 'fast',
        msFirstToken: 500,
        msTotal: 900,
        rating: null,
        note: '',
        createdAt: 3,
      });
      await getDb().notes.add({
        sessionId: session.id,
        summary: 'Invented summary.',
        questions: [],
        nextSteps: [],
        createdAt: 4,
      });
    }

    expect(await deleteSession(gone.id)).toEqual({
      documents: 2,
      utterances: 1,
      answers: 1,
      notes: 1,
    });
    expect(await getSession(gone.id)).toBeNull();
    expect(await listDocuments(gone.id)).toEqual([]);
    expect(await listUtterances(gone.id)).toEqual([]);
    expect(await getDb().answers.where('sessionId').equals(gone.id).count()).toBe(0);
    expect(await getDb().notes.get(gone.id)).toBeUndefined();

    // The other session is untouched.
    expect(await getSession(kept.id)).not.toBeNull();
    expect(await listDocuments(kept.id)).toHaveLength(2);
    expect(await listUtterances(kept.id)).toHaveLength(1);
    expect(await getDb().notes.get(kept.id)).toBeDefined();
  });

  it('reports zeros for an unknown id', async () => {
    expect(await deleteSession('nope')).toEqual({
      documents: 0,
      utterances: 0,
      answers: 0,
      notes: 0,
    });
  });
});
