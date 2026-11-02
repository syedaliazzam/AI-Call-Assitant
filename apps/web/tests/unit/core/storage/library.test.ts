/**
 * Tests: apps/web/src/core/storage/library.ts, migrate.ts, dashboardPrefs.ts, the v4 database
 * upgrade, and sessions.ts's duplicate, filter and sort. A deleted library item never changes a
 * past session; old values move to today's; an older device keeps its data.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, forgetDb, getDb } from '@/core/storage/db';
import {
  getDashboardLayout,
  getDashboardSort,
  setDashboardLayout,
  setDashboardSort,
} from '@/core/storage/dashboardPrefs';
import { addLibraryItem, listLibrary, removeLibraryItem } from '@/core/storage/library';
import { currentLessonScope, currentSessionType, currentTone } from '@/core/storage/migrate';
import {
  createSessionWithDocuments,
  duplicateSession,
  filterSessions,
  sortSessions,
} from '@/core/storage/sessions';
import { listDocuments } from '@/core/storage/documents';
import type { Session } from '@/core/storage/types';
import { sessionInput } from './helpers';

beforeEach(async () => {
  forgetDb();
  await Dexie.delete(DB_NAME);
});

describe('library', () => {
  it('keeps resumes and documents apart, newest first', async () => {
    await addLibraryItem('resume', 'old.pdf', 'old', 1);
    await addLibraryItem('resume', 'new.pdf', 'new', 2);
    await addLibraryItem('document', 'prices.txt', 'prices', 3);
    expect((await listLibrary('resume')).map((item) => item.name)).toEqual(['new.pdf', 'old.pdf']);
    expect((await listLibrary('document')).map((item) => item.name)).toEqual(['prices.txt']);
  });

  it('records the size', async () => {
    expect((await addLibraryItem('document', 'a.txt', 'hello')).chars).toBe(5);
  });

  it('a session keeps its copy when the library item is deleted', async () => {
    const item = await addLibraryItem('resume', 'cv.pdf', 'my experience');
    const session = await createSessionWithDocuments(sessionInput(), [
      { name: item.name, text: item.text, kind: 'resume', sourceId: item.id },
    ]);
    await removeLibraryItem(item.id);
    expect(await listLibrary('resume')).toEqual([]);
    const [copy] = await listDocuments(session.id);
    expect(copy).toMatchObject({
      name: 'cv.pdf',
      text: 'my experience',
      kind: 'resume',
      sourceId: item.id,
    });
  });
});

describe('migrate', () => {
  it('turns the old session types into Regular', () => {
    expect(['sales', 'support', 'internal'].map(currentSessionType)).toEqual([
      'regular',
      'regular',
      'regular',
    ]);
    expect(currentSessionType('interview')).toBe('interview');
    expect(currentSessionType('mock')).toBe('mock');
  });

  it('moves lesson scopes and the friendly tone', () => {
    expect(currentLessonScope('all')).toBe('all');
    expect(currentLessonScope('sales')).toBe('regular');
    expect(currentTone('friendly')).toBe('simple');
    expect(currentTone('technical')).toBe('technical');
  });
});

describe('database version 4', () => {
  it('upgrades a device with version 3 data and loses nothing', async () => {
    const old = new Dexie(DB_NAME);
    old.version(3).stores({
      sessions: 'id, createdAt, type, status',
      documents: 'id, sessionId',
      utterances: 'id, sessionId',
      answers: 'id, sessionId',
      notes: 'sessionId',
      settings: 'id',
      lessons: 'id, sourceSessionId, status',
    });
    await old.open();
    await old.table('sessions').add({
      ...sessionInput(),
      id: 's1',
      type: 'sales',
      preferences: {
        language: 'en',
        model: 'fast',
        style: { format: 'paragraph', length: 'medium', tone: 'friendly' },
        keyTerms: 'Priya',
      },
      createdAt: 5,
      status: 'ended',
      lastActiveAt: 6,
    });
    await old.table('documents').add({
      id: 'd1',
      sessionId: 's1',
      name: 'a.txt',
      text: 'kept',
      chars: 4,
      addedAt: 1,
    });
    await old.table('settings').add({
      id: 'defaults',
      defaults: {
        model: 'fast',
        style: { format: 'headline+bullets', length: 'short', tone: 'friendly' },
        instructions: '',
        saveTranscript: true,
      },
      updatedAt: 1,
    });
    await old.table('lessons').add({
      id: 'l1',
      text: 'x',
      scope: 'support',
      status: 'approved',
      sourceSessionId: 's1',
      sourceKey: 'k',
      createdAt: 1,
    });
    old.close();

    const db = getDb();
    const session = await db.sessions.get('s1');
    expect(session?.type).toBe('regular');
    expect(session?.preferences.style).toEqual({
      format: 'paragraph',
      length: 'medium',
      tone: 'simple',
    });
    expect(session?.preferences.keyTerms).toBe('Priya');
    expect(session?.status).toBe('ended');
    expect((await db.documents.get('d1'))?.text).toBe('kept');
    expect((await db.settings.get('defaults'))?.defaults.style.tone).toBe('simple');
    expect((await db.lessons.get('l1'))?.scope).toBe('regular');
    expect(await db.library.count()).toBe(0);
  });
});

describe('duplicateSession', () => {
  it('copies details and documents, not the call', async () => {
    const source = await createSessionWithDocuments(
      sessionInput(),
      [{ name: 'a.txt', text: 'doc' }],
      10,
    );
    const db = getDb();
    await db.sessions.update(source.id, { status: 'ended', lastActiveAt: 11 });
    await db.utterances.add({
      id: 'u1',
      sessionId: source.id,
      speaker: 'them',
      text: 'hello',
      tStart: 1,
      tEnd: 2,
    });
    const copy = await duplicateSession(source.id, 20);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      company: source.company,
      status: 'not-started',
      lastActiveAt: null,
      createdAt: 20,
    });
    const documents = await listDocuments(copy.id);
    expect(documents.map((document) => document.text)).toEqual(['doc']);
    expect(documents[0]?.id).not.toBe((await listDocuments(source.id))[0]?.id);
    expect(await db.utterances.where('sessionId').equals(copy.id).count()).toBe(0);
  });

  it('refuses a session that does not exist', async () => {
    await expect(duplicateSession('nope')).rejects.toThrow('SESSION_NOT_FOUND');
  });
});

describe('filterSessions and sortSessions', () => {
  const rows = [
    { id: 'a', type: 'interview', company: 'beta', role: 'Analyst', createdAt: 2 },
    { id: 'b', type: 'regular', company: 'Alpha', role: 'Renewal', createdAt: 1 },
    { id: 'c', type: 'mock', company: 'Gamma', role: 'Analyst', createdAt: 3 },
  ] as unknown as Session[];

  it('searches company and role, ignoring case', () => {
    expect(filterSessions(rows, { search: ' ANALYST ' }).map((row) => row.id)).toEqual(['a', 'c']);
    expect(filterSessions(rows, { search: 'alpha' }).map((row) => row.id)).toEqual(['b']);
  });

  it('filters by type', () => {
    expect(filterSessions(rows, { type: 'mock' }).map((row) => row.id)).toEqual(['c']);
  });

  it('sorts newest, oldest and by company', () => {
    expect(sortSessions(rows, 'newest').map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(sortSessions(rows, 'oldest').map((row) => row.id)).toEqual(['b', 'a', 'c']);
    expect(sortSessions(rows, 'company').map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('dashboard preferences', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  });

  it('starts as a list, newest first, and remembers a change', () => {
    expect(getDashboardLayout()).toBe('list');
    expect(getDashboardSort()).toBe('newest');
    setDashboardLayout('grid');
    setDashboardSort('company');
    expect(getDashboardLayout()).toBe('grid');
    expect(getDashboardSort()).toBe('company');
  });

  it('falls back when storage is unavailable or holds something else', () => {
    store.set('kite.dashboardSort', 'nonsense');
    expect(getDashboardSort()).toBe('newest');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    expect(getDashboardLayout()).toBe('list');
    expect(() => setDashboardLayout('grid')).not.toThrow();
  });
});
