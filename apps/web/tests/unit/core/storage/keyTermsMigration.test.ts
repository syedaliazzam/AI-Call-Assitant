/**
 * Tests the version-7 upgrade in apps/web/src/core/storage/db.ts (v1.0.1): a session saved with key
 * terms pasted as one comma-separated line (one over-long "term") is rewritten to one clean term
 * per line when the database opens, and a session that is already clean keeps its text exactly.
 * All text is invented.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, forgetDb } from '@/core/storage/db';
import { getSession } from '@/core/storage/sessions';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

describe('schema version 7', () => {
  it('splits key terms stored as one pasted comma list, and leaves clean ones as they are', async () => {
    forgetDb();
    // A device on the earliest schema (versions 1 and 2), upgraded through every version to 7.
    const old = new Dexie(DB_NAME);
    old.version(1).stores({
      sessions: 'id, createdAt, type, status',
      documents: 'id, sessionId',
      utterances: 'id, sessionId',
      answers: 'id, sessionId',
      notes: 'sessionId',
    });
    old.version(2).stores({ settings: 'id' });
    const base = { ...sessionInput(), createdAt: 1, status: 'ended', lastActiveAt: null };
    const pasted = `Kubernetes, Terraform; BM25, kubernetes, ${'Z'.repeat(90)}`;
    await old.table('sessions').add({
      ...base,
      id: 'pasted',
      preferences: { ...base.preferences, keyTerms: pasted },
    });
    await old.table('sessions').add({
      ...base,
      id: 'clean',
      preferences: { ...base.preferences, keyTerms: 'Harbor Lane\nBluefin Route' },
    });
    old.close();

    const migrated = await getSession('pasted');
    expect(migrated?.preferences.keyTerms).toBe(`Kubernetes\nTerraform\nBM25\n${'Z'.repeat(60)}`);
    expect((await getSession('clean'))?.preferences.keyTerms).toBe('Harbor Lane\nBluefin Route');
  });
});
