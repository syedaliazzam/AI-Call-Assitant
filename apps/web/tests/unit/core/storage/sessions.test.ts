/**
 * Tests for apps/web/src/core/storage/sessions.ts, on an in-memory IndexedDB (fake-indexeddb):
 * create/get (new sessions are 'not-started' with no activity yet; unknown ids give null);
 * listSessions() is newest first, filters by type and searches company and role
 * ignoring case; updateSession() keeps id and createdAt and fails for unknown ids;
 * updateSessionPreferences() (ADR-0094) changes only the preferences given, never putting back older ones;
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
  duplicateSession,
  getSession,
  listSessions,
  markSessionActive,
  shownStatus,
  STALE_LIVE_MS,
  updateSession,
  updateSessionPreferences,
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
    const a = await createSession(sessionInput({ type: 'regular', company: 'Acme' }), 1);
    const b = await createSession(
      sessionInput({ type: 'interview', company: 'Globex', role: 'Data Engineer' }),
      2,
    );
    const c = await createSession(
      sessionInput({ type: 'regular', company: 'Initech', description: 'Pilot for ACME team' }),
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
    expect((await listSessions({ type: 'regular' })).map((s) => s.id)).toEqual([c.id, a.id]);
    expect(await listSessions({ type: 'mock' })).toEqual([]);
  });

  it('searches company and role, ignoring case and spaces, but not the description', async () => {
    const { a, b } = await three();
    // "acme" matches Acme (company), and not "Pilot for ACME team" (a description).
    expect((await listSessions({ search: '  acme ' })).map((s) => s.id)).toEqual([a.id]);
    expect((await listSessions({ search: 'data eng' })).map((s) => s.id)).toEqual([b.id]);
    expect(await listSessions({ search: 'zzz' })).toEqual([]);
    expect(await listSessions({ search: '   ' })).toHaveLength(3);
  });

  it('combines the type filter and the search', async () => {
    const { a } = await three();
    expect((await listSessions({ type: 'regular', search: 'acme' })).map((s) => s.id)).toEqual([
      a.id,
    ]);
    // Globex (interview) is not Acme; the Acme session is regular.
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

describe('updateSessionPreferences (ADR-0094)', () => {
  it('saves the model switched during a call, keeping the other preferences', async () => {
    const session = await createSession(sessionInput(), 5);
    const updated = await updateSessionPreferences(session.id, { model: 'smart' });
    expect(updated.preferences).toEqual({ ...session.preferences, model: 'smart' });
    expect((await getSession(session.id))!.preferences.model).toBe('smart');
    // The rest of the session is as it was.
    expect({ ...updated, preferences: session.preferences }).toEqual(session);
  });

  it('never puts back an older value: a style change after a model change keeps the model', async () => {
    const session = await createSession(sessionInput(), 5);
    await updateSessionPreferences(session.id, { model: 'smart' });
    const style = { ...session.preferences.style, tone: 'technical' as const };
    await updateSessionPreferences(session.id, { style });
    expect((await getSession(session.id))!.preferences).toEqual({
      ...session.preferences,
      model: 'smart',
      style,
    });
  });

  it('changes only the session asked for', async () => {
    const one = await createSession(sessionInput(), 5);
    const two = await createSession(sessionInput(), 6);
    await updateSessionPreferences(one.id, { model: 'smart' });
    expect((await getSession(two.id))!.preferences.model).toBe(two.preferences.model);
  });

  it('fails for an unknown id', async () => {
    await expect(updateSessionPreferences('nope', { model: 'fast' })).rejects.toThrow(
      'SESSION_NOT_FOUND',
    );
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
        notes: {
          summary: ['Invented summary.'],
          questions: [],
          nextSteps: [],
          unclear: [],
          lessons: [],
        },
        callStartedAt: 3,
        createdAt: 4,
      });
    }

    expect(await deleteSession(gone.id)).toEqual({
      documents: 2,
      utterances: 1,
      answers: 1,
      notes: 1,
      rejectedLessons: 0,
      questionBanks: 0,
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
      rejectedLessons: 0,
      questionBanks: 0,
    });
  });

  it("removes the session's rejected lesson decisions and keeps its approved lessons", async () => {
    const session = await createSession(sessionInput());
    const decision = (id: string, status: 'approved' | 'rejected') => ({
      id,
      text: `Invented lesson ${id}`,
      scope: 'all' as const,
      status,
      sourceSessionId: session.id,
      sourceKey: `invented lesson ${id}`,
      evidence: '',
      decidedAt: 1,
      approvedAt: status === 'approved' ? 1 : null,
    });
    await getDb().lessons.bulkAdd([decision('kept', 'approved'), decision('gone', 'rejected')]);
    expect((await deleteSession(session.id)).rejectedLessons).toBe(1);
    expect((await getDb().lessons.toArray()).map((lesson) => lesson.id)).toEqual(['kept']);
  });
});

describe("a company's domain (ADR-0048)", () => {
  beforeEach(resetDb);

  it('stays when the name stays', async () => {
    const session = await createSession(
      sessionInput({ company: 'Alder', companyDomain: 'alder.example' }),
    );
    const next = await updateSession(session.id, { company: 'Alder', role: 'New role' });
    expect(next.companyDomain).toBe('alder.example');
  });

  it('goes when the name changes, so the old logo cannot stay on a new company', async () => {
    const session = await createSession(
      sessionInput({ company: 'Alder', companyDomain: 'alder.example' }),
    );
    const next = await updateSession(session.id, { company: 'Lantern' });
    expect(next).not.toHaveProperty('companyDomain');
    expect(await getSession(session.id)).not.toHaveProperty('companyDomain');
  });

  it('changes with the name when a new company is picked', async () => {
    const session = await createSession(
      sessionInput({ company: 'Alder', companyDomain: 'alder.example' }),
    );
    const next = await updateSession(session.id, {
      company: 'Lantern',
      companyDomain: 'lantern.example',
    });
    expect(next.companyDomain).toBe('lantern.example');
  });

  it('is copied with the session', async () => {
    const session = await createSession(
      sessionInput({ company: 'Alder', companyDomain: 'alder.example' }),
    );
    expect((await duplicateSession(session.id)).companyDomain).toBe('alder.example');
  });
});

describe('1.5.1 (ADR-0069): a document longer than one row holds', () => {
  beforeEach(resetDb);

  it('is stored as parts of at most 250k, listed as one, and removed whole', async () => {
    const paragraph = 'Invented handbook paragraph about depot routing. '.repeat(20) + '\n\n';
    const text = paragraph.repeat(Math.ceil(480_000 / paragraph.length)).slice(0, 480_000);
    const session = await createSessionWithDocuments(sessionInput(), [
      { name: 'handbook.txt', text },
    ]);
    const rows = await getDb().documents.where('sessionId').equals(session.id).toArray();
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.chars).toBeLessThanOrEqual(250_000);
    const [listed] = await listDocuments(session.id);
    expect(listed).toMatchObject({ name: 'handbook.txt', chars: 480_000 });
    expect(listed!.text).toBe(text);
    await updateSessionWithDocuments(session.id, {}, [], [listed!.id]);
    expect(await getDb().documents.where('sessionId').equals(session.id).count()).toBe(0);
  });
});
