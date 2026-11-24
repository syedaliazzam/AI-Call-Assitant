/**
 * Tests for apps/web/src/core/storage/settings.ts and the version-2 schema in db.ts, on an
 * in-memory IndexedDB (fake-indexeddb): getSessionDefaults() returns the built-in defaults until
 * defaults are saved and the saved ones after; deleteAllLocalData() resets them; and a device
 * that still has the version-1 database keeps its sessions when version 2 adds the settings
 * store; STAR is off in the built-in defaults; the built-in length is Balanced ('medium') while a
 * saved Short default and an existing Short session keep Short. All data is invented.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, forgetDb } from '@/core/storage/db';
import { createSession, getSession, listSessions } from '@/core/storage/sessions';
import {
  BUILT_IN_DEFAULTS,
  getSessionDefaults,
  saveSessionDefaults,
} from '@/core/storage/settings';
import type { SessionDefaults } from '@/core/storage/types';
import { deleteAllLocalData } from '@/core/storage/wipe';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/** Invented defaults different from the built-in ones. */
const CUSTOM: SessionDefaults = {
  model: 'smart',
  style: { format: 'paragraph', length: 'medium', tone: 'professional' },
  instructions: 'Invented instruction.',
  saveTranscript: false,
};

describe('session defaults', () => {
  it('leaves STAR off in the built-in defaults, so a new session starts without it', () => {
    expect(BUILT_IN_DEFAULTS.style.star).toBeUndefined();
  });

  it('start new sessions at Balanced length (medium) when nothing is saved', async () => {
    expect(BUILT_IN_DEFAULTS.style.length).toBe('medium');
    expect((await getSessionDefaults()).style.length).toBe('medium');
  });

  it('keep a saved Short default: the built-in Balanced never replaces a choice', async () => {
    const savedShort: SessionDefaults = {
      ...BUILT_IN_DEFAULTS,
      style: { ...BUILT_IN_DEFAULTS.style, length: 'short' },
    };
    await saveSessionDefaults(savedShort, 7);
    expect((await getSessionDefaults()).style.length).toBe('short');
  });

  it('leave an existing Short session at Short', async () => {
    // sessionInput() stores length 'short' on the session itself.
    const { id } = await createSession(sessionInput());
    expect((await getSessionDefaults()).style.length).toBe('medium');
    expect((await getSession(id))?.preferences.style.length).toBe('short');
  });

  it('are the built-in defaults until saved', async () => {
    expect(await getSessionDefaults()).toEqual(BUILT_IN_DEFAULTS);
  });

  it('return what was saved', async () => {
    await saveSessionDefaults(CUSTOM, 7);
    expect(await getSessionDefaults()).toEqual(CUSTOM);
  });

  it('go back to the built-in defaults after "Delete all local data"', async () => {
    await saveSessionDefaults(CUSTOM);
    await deleteAllLocalData();
    expect(await getSessionDefaults()).toEqual(BUILT_IN_DEFAULTS);
  });
});

describe('schema version 2', () => {
  it('keeps the sessions of a device that still has the version-1 database', async () => {
    forgetDb();
    // The database exactly as Day 3 Stage 1 created it (version 1, no settings store).
    const v1 = new Dexie(DB_NAME);
    v1.version(1).stores({
      sessions: 'id, createdAt, type, status',
      documents: 'id, sessionId',
      utterances: 'id, sessionId',
      answers: 'id, sessionId',
      notes: 'sessionId',
    });
    await v1.table('sessions').add({
      ...sessionInput(),
      id: 'old-session',
      createdAt: 1,
      status: 'not-started',
      lastActiveAt: null,
    });
    v1.close();

    // Opening it with the current schema upgrades it to version 2.
    expect((await getSession('old-session'))?.company).toBe('Bluefin Route');
    expect(await listSessions()).toHaveLength(1);
    await saveSessionDefaults(CUSTOM);
    expect(await getSessionDefaults()).toEqual(CUSTOM);
  });
});
