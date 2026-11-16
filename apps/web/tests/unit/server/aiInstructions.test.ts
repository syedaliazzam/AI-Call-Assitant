/**
 * Tests for apps/web/src/server/aiInstructions.ts (ADR-0089; storage from ADR-0083), against a real
 * Postgres in memory (PGlite) with the committed migrations (drizzle/0008_global_prompts.sql included):
 * - non-admins can neither read nor write: FORBIDDEN, and the database is not touched;
 * - a save adds a version in force with its note; the same text adds nothing; the default prompt's text
 *   is stored as the default; Reset to default adds a version; the length limit holds in the code and
 *   in the database;
 * - restore adds a NEW version (restoredFrom set) and changes or deletes nothing;
 * - the pin (ids only), and a running call keeps its starting version after a later save;
 * - 'none', a pin of another tab or an unknown pin; a failed read falls back to the last version known;
 * - an empty global prompt is kept as empty (the contract alone is sent);
 * - a row saved before ADR-0089 reads as the default prompt with its company instructions.
 */
import { AI_INSTRUCTIONS_NONE } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_HEADING,
  loadAiInstructions,
  readPin,
  resetInstructionsCache,
  resolveSettings,
  restoreVersion,
  saveGlobalPrompt,
  type InstructionsDb,
} from '@/server/aiInstructions';
import { DEFAULT_PROMPTS } from '@/server/prompts/defaults';
import { ALICE, BOB, createTestDb, type TestDb } from './calldata/pgliteDb';

// The app's real database module needs production settings; these tests pass their own database.
vi.mock('@/server/db', () => ({ db: {} }));

/** An admin (Alice) and an ordinary account (Bob), both invented. */
const ADMIN = { id: ALICE, role: 'admin' };
/** An ordinary account. */
const USER = { id: BOB, role: 'user' };

let t: TestDb;
/** The test database as the module's type. */
let db: InstructionsDb;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as InstructionsDb;
}, 60_000);

beforeEach(async () => {
  await t.pg.exec('DELETE FROM ai_instructions_active; DELETE FROM ai_instructions_version;');
  resetInstructionsCache();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/**
 * How many versions are stored.
 *
 * @returns The count.
 */
async function versionCount(): Promise<number> {
  const result = await t.pg.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM ai_instructions_version',
  );
  return result.rows[0]!.n;
}

/**
 * A save time n minutes into an invented morning, so the history order is certain.
 *
 * @param n Minutes after 09:00 UTC.
 * @returns The time.
 */
function minutes(n: number): Date {
  return new Date(Date.UTC(2026, 10, 16, 9, n));
}

describe('admins only', () => {
  /** A database that fails the test if it is touched. */
  const untouchable = new Proxy(
    {},
    {
      get() {
        throw new Error('the database must not be touched');
      },
    },
  ) as InstructionsDb;

  it('refuses a non-admin read, save, reset and restore before touching the database', async () => {
    await expect(loadAiInstructions(untouchable, USER)).rejects.toThrow('FORBIDDEN');
    await expect(saveGlobalPrompt(untouchable, USER, 'live', 'Be brief.')).rejects.toThrow(
      'FORBIDDEN',
    );
    await expect(saveGlobalPrompt(untouchable, USER, 'live', null)).rejects.toThrow('FORBIDDEN');
    await expect(
      restoreVersion(untouchable, USER, 'live', '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f'),
    ).rejects.toThrow('FORBIDDEN');
    // An account with no role at all is not an admin either.
    await expect(saveGlobalPrompt(untouchable, { id: BOB }, 'live', 'x')).rejects.toThrow(
      'FORBIDDEN',
    );
  });

  it('writes nothing for a non-admin on the real database', async () => {
    await expect(saveGlobalPrompt(db, USER, 'live', 'Be brief.')).rejects.toThrow('FORBIDDEN');
    expect(await versionCount()).toBe(0);
  });
});

describe('saving', () => {
  it('adds a version in force with its note, cleaned, and lists it with its author', async () => {
    const saved = await saveGlobalPrompt(
      db,
      ADMIN,
      'live',
      '  Be brief.\r\nSay customers.  ',
      '  Shorter   sales answers ',
      minutes(1),
    );
    expect(saved.created).toBe(true);
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.activeId).toBe(saved.id);
    // Line endings and outer spaces are cleaned, so the same text always gives the same prompt bytes.
    expect(state.live.activePrompt).toBe('Be brief.\nSay customers.');
    expect(state.live.total).toBe(1);
    expect(state.live.versions[0]).toMatchObject({
      authorName: ALICE,
      note: 'Shorter sales answers',
      restoredFrom: null,
      legacy: false,
    });
    expect(state.notes).toEqual({ activeId: null, activePrompt: null, versions: [], total: 0 });
  });

  it('adds nothing when the text equals the version in force', async () => {
    await saveGlobalPrompt(db, ADMIN, 'live', 'Be brief.', null, minutes(1));
    const again = await saveGlobalPrompt(db, ADMIN, 'live', 'Be brief.\n', null, minutes(2));
    expect(again.created).toBe(false);
    expect(await versionCount()).toBe(1);
  });

  it('stores the default prompt as the default, and Reset to default adds a version', async () => {
    // Never saved and the default: nothing to record.
    expect(await saveGlobalPrompt(db, ADMIN, 'live', DEFAULT_PROMPTS.live)).toEqual({
      id: '',
      created: false,
    });
    await saveGlobalPrompt(db, ADMIN, 'live', 'Be brief.', null, minutes(1));
    const reset = await saveGlobalPrompt(db, ADMIN, 'live', null, null, minutes(2));
    expect(reset.created).toBe(true);
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.activePrompt).toBeNull();
    expect(state.live.versions.map((version) => version.globalPrompt)).toEqual([null, 'Be brief.']);
    expect((await resolveSettings(db, 'live')).globalPrompt).toBe(DEFAULT_PROMPTS.live);
    // The default text typed back in is the default too: nothing new.
    expect((await saveGlobalPrompt(db, ADMIN, 'live', DEFAULT_PROMPTS.live)).created).toBe(false);
  });

  it('keeps an empty prompt as empty: the contract alone is sent', async () => {
    await saveGlobalPrompt(db, ADMIN, 'ask', '   ');
    const settings = await resolveSettings(db, 'ask');
    expect(settings).toEqual({ globalPrompt: '', isDefault: false });
  });

  it('refuses text over 30,000 characters in the code and in the database', async () => {
    await expect(saveGlobalPrompt(db, ADMIN, 'live', 'x'.repeat(30_001))).rejects.toThrow(
      'TOO_LONG',
    );
    expect(await versionCount()).toBe(0);
    await expect(
      t.pg.query(
        `INSERT INTO ai_instructions_version (id, block, text, global_prompt) VALUES ('v1', 'live', '', $1)`,
        ['x'.repeat(30_001)],
      ),
    ).rejects.toThrow();
  });
});

describe('restoring', () => {
  it('adds a new version with the old text and changes nothing else', async () => {
    const first = await saveGlobalPrompt(db, ADMIN, 'notes', 'Version one.', 'first', minutes(1));
    await saveGlobalPrompt(db, ADMIN, 'notes', 'Version two.', null, minutes(2));
    const restored = await restoreVersion(db, ADMIN, 'notes', first.id, minutes(3));
    expect(restored.created).toBe(true);
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.notes.activeId).toBe(restored.id);
    expect(state.notes.activePrompt).toBe('Version one.');
    expect(state.notes.versions.map((version) => version.globalPrompt)).toEqual([
      'Version one.',
      'Version two.',
      'Version one.',
    ]);
    expect(state.notes.versions[0]!.restoredFrom).toBe(first.id);
    // The original row is untouched.
    expect(state.notes.versions[2]).toMatchObject({
      id: first.id,
      note: 'first',
      restoredFrom: null,
    });
  });

  it('refuses a version of another tab or an unknown one', async () => {
    const live = await saveGlobalPrompt(db, ADMIN, 'live', 'Live text.');
    await expect(restoreVersion(db, ADMIN, 'notes', live.id)).rejects.toThrow('NOT_FOUND');
    await expect(
      restoreVersion(db, ADMIN, 'live', '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f'),
    ).rejects.toThrow('NOT_FOUND');
    await expect(restoreVersion(db, ADMIN, 'live', AI_INSTRUCTIONS_NONE)).rejects.toThrow(
      'NOT_FOUND',
    );
  });
});

describe('the pin and what a request uses', () => {
  it("pins 'none' for tabs never saved, and version ids after a save", async () => {
    expect(await readPin(db)).toEqual({ live: AI_INSTRUCTIONS_NONE, notes: AI_INSTRUCTIONS_NONE });
    const live = await saveGlobalPrompt(db, ADMIN, 'live', 'Live text.');
    expect(await readPin(db)).toEqual({ live: live.id, notes: AI_INSTRUCTIONS_NONE });
  });

  it('keeps a running call on its starting version after a later save', async () => {
    await saveGlobalPrompt(db, ADMIN, 'live', 'Before.', null, minutes(1));
    const pin = await readPin(db);
    await saveGlobalPrompt(db, ADMIN, 'live', 'After.', null, minutes(2));
    // The running call sends its pin: the old text, every request, so its cached prefix stays.
    expect((await resolveSettings(db, 'live', pin.live)).globalPrompt).toBe('Before.');
    expect((await resolveSettings(db, 'live', pin.live)).globalPrompt).toBe('Before.');
    // A call that starts now reads a fresh pin: the new text.
    const fresh = await readPin(db);
    expect((await resolveSettings(db, 'live', fresh.live)).globalPrompt).toBe('After.');
  });

  it("keeps a call that started on the default prompt ('none') on it", async () => {
    const pin = await readPin(db);
    await saveGlobalPrompt(db, ADMIN, 'live', 'Saved later.');
    expect(await resolveSettings(db, 'live', pin.live)).toEqual({
      globalPrompt: DEFAULT_PROMPTS.live,
      isDefault: true,
    });
  });

  it('uses the version in force for a pin of another tab or an unknown pin', async () => {
    const notes = await saveGlobalPrompt(db, ADMIN, 'notes', 'Notes text.');
    await saveGlobalPrompt(db, ADMIN, 'live', 'Live text.');
    expect((await resolveSettings(db, 'live', notes.id)).globalPrompt).toBe('Live text.');
    expect(
      (await resolveSettings(db, 'live', '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f')).globalPrompt,
    ).toBe('Live text.');
  });

  it('falls back to the last version known when the database fails, never stopping an answer', async () => {
    await saveGlobalPrompt(db, ADMIN, 'live', 'Known.');
    await resolveSettings(db, 'live', undefined, 0);
    const broken = new Proxy(
      {},
      {
        get() {
          throw new Error('database down');
        },
      },
    ) as InstructionsDb;
    // Long after the in-memory copy expired, the read fails: the last text known is used.
    expect((await resolveSettings(broken, 'live', undefined, 10 * 60_000)).globalPrompt).toBe(
      'Known.',
    );
    resetInstructionsCache();
    expect(await resolveSettings(broken, 'live')).toEqual({
      globalPrompt: DEFAULT_PROMPTS.live,
      isDefault: true,
    });
  });
});

describe('versions saved before ADR-0089', () => {
  it('reads company instructions as the default prompt with them added, and marks the row', async () => {
    await t.pg.exec(`
      INSERT INTO ai_instructions_version (id, block, text, author_id, created_at)
      VALUES ('0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f', 'live', 'Say customers, not clients.', '${ALICE}', now());
      INSERT INTO ai_instructions_active (block, version_id) VALUES ('live', '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f');
    `);
    const expected = `${DEFAULT_PROMPTS.live}\n\n${LEGACY_HEADING}\nSay customers, not clients.`;
    expect((await resolveSettings(db, 'live')).globalPrompt).toBe(expected);
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.activePrompt).toBe(expected);
    expect(state.live.versions[0]!.legacy).toBe(true);
  });
});
