/**
 * Tests for apps/web/src/server/aiInstructions.ts (ADR-0083), against a real Postgres in memory (PGlite)
 * with the committed migrations (drizzle/0005_ai_instructions.sql included):
 * - non-admins can neither read nor write: FORBIDDEN, and the database is not touched;
 * - a save adds a version and puts it in force; saving the same text adds nothing; the length limit
 *   (4,000) holds in the code and in the database;
 * - a restore adds a NEW version (restoredFrom set) and changes or deletes nothing;
 * - the pin (ids only), and a live call keeps its starting version after a later save;
 * - a pin of another block, an unknown pin or 'none'; a failed read falls back to the last text known.
 * - ADR-0086 (drizzle/0006_full_prompt.sql): custom full prompts are admins only; saved as new versions
 *   that keep the instructions; refused (nothing written) when the output format is missing; Reset to
 *   default; restoring one part keeps the other; a running call keeps its prompt; a damaged row reads
 *   as the built-in prompt; the database refuses an over-long prompt.
 */
import { AI_INSTRUCTIONS_NONE, type CustomPrompt } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadAiInstructions,
  parseStoredPrompt,
  PromptRejectedError,
  readPin,
  resetInstructionsCache,
  resolveInstructions,
  resolveSettings,
  restoreInstructions,
  saveInstructions,
  savePrompt,
  type InstructionsDb,
} from '@/server/aiInstructions';
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
  return new Date(Date.UTC(2026, 10, 15, 9, n));
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

  it('refuses a non-admin read, save and restore before touching the database', async () => {
    await expect(loadAiInstructions(untouchable, USER)).rejects.toThrow('FORBIDDEN');
    await expect(saveInstructions(untouchable, USER, 'live', 'Be brief.')).rejects.toThrow(
      'FORBIDDEN',
    );
    await expect(
      restoreInstructions(untouchable, USER, 'live', '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f'),
    ).rejects.toThrow('FORBIDDEN');
    // An account with no role at all is not an admin either.
    await expect(saveInstructions(untouchable, { id: BOB }, 'live', 'x')).rejects.toThrow(
      'FORBIDDEN',
    );
  });

  it('writes nothing for a non-admin on the real database', async () => {
    await expect(saveInstructions(db, USER, 'live', 'Be brief.')).rejects.toThrow('FORBIDDEN');
    expect(await versionCount()).toBe(0);
  });
});

describe('saving', () => {
  it('adds a version, puts it in force, and lists it with its author', async () => {
    const saved = await saveInstructions(db, ADMIN, 'live', '  Be brief.\r\nSay customers.  ');
    expect(saved.created).toBe(true);
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.activeId).toBe(saved.id);
    // Line endings and outer spaces are cleaned, so the same text always gives the same prompt.
    expect(state.live.activeText).toBe('Be brief.\nSay customers.');
    expect(state.live.versions).toHaveLength(1);
    expect(state.live.versions[0]).toMatchObject({ authorName: ALICE, restoredFrom: null });
    expect(state.notes).toEqual({
      activeId: null,
      activeText: '',
      activePrompt: null,
      versions: [],
    });
  });

  it('adds nothing when the text equals the version in force, or when a never-saved block stays empty', async () => {
    await saveInstructions(db, ADMIN, 'live', 'Be brief.', minutes(1));
    const again = await saveInstructions(db, ADMIN, 'live', 'Be brief.\n', minutes(2));
    expect(again.created).toBe(false);
    const empty = await saveInstructions(db, ADMIN, 'ask', '   ', minutes(3));
    expect(empty).toEqual({ id: '', created: false });
    expect(await versionCount()).toBe(1);
  });

  it('lists the history newest first, one block at a time', async () => {
    await saveInstructions(db, ADMIN, 'live', 'One', minutes(1));
    await saveInstructions(db, ADMIN, 'live', 'Two', minutes(2));
    await saveInstructions(db, ADMIN, 'notes', 'Notes one', minutes(3));
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.versions.map((version) => version.text)).toEqual(['Two', 'One']);
    expect(state.notes.versions.map((version) => version.text)).toEqual(['Notes one']);
  });

  it('keeps an empty save as a version, meaning no instructions', async () => {
    await saveInstructions(db, ADMIN, 'live', 'Be brief.', minutes(1));
    const cleared = await saveInstructions(db, ADMIN, 'live', '', minutes(2));
    expect(cleared.created).toBe(true);
    expect(await resolveInstructions(db, 'live')).toBe('');
  });
});

describe('length limit', () => {
  it('accepts 4,000 characters and refuses 4,001 without writing', async () => {
    await expect(saveInstructions(db, ADMIN, 'live', 'a'.repeat(4_000))).resolves.toMatchObject({
      created: true,
    });
    await expect(saveInstructions(db, ADMIN, 'live', 'b'.repeat(4_001))).rejects.toThrow(
      'TOO_LONG',
    );
    expect(await versionCount()).toBe(1);
  });

  it('is enforced by the database too, and so is the block name', async () => {
    await expect(
      t.pg.query(
        `INSERT INTO ai_instructions_version (id, block, text) VALUES ('x1', 'live', $1)`,
        ['c'.repeat(4_001)],
      ),
    ).rejects.toThrow();
    await expect(
      t.pg.query(
        `INSERT INTO ai_instructions_version (id, block, text) VALUES ('x2', 'other', '')`,
      ),
    ).rejects.toThrow();
  });
});

describe('restoring', () => {
  it('adds a new version with the old text, and changes or deletes nothing', async () => {
    const first = await saveInstructions(db, ADMIN, 'live', 'First', minutes(1));
    const second = await saveInstructions(db, ADMIN, 'live', 'Second', minutes(2));
    const before = (await t.pg.query('SELECT id, text FROM ai_instructions_version ORDER BY id'))
      .rows;
    const restored = await restoreInstructions(db, ADMIN, 'live', first.id, minutes(3));
    expect(restored.created).toBe(true);
    expect(restored.id).not.toBe(first.id);
    expect(restored.id).not.toBe(second.id);
    expect(await versionCount()).toBe(3);
    // The two earlier rows are exactly as they were.
    const after = (await t.pg.query('SELECT id, text FROM ai_instructions_version ORDER BY id'))
      .rows;
    for (const row of before) expect(after).toContainEqual(row);
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.activeId).toBe(restored.id);
    expect(state.live.activeText).toBe('First');
    expect(state.live.versions[0]).toMatchObject({ id: restored.id, restoredFrom: first.id });
  });

  it('refuses a version of another block, or one that does not exist', async () => {
    const notes = await saveInstructions(db, ADMIN, 'notes', 'Notes', minutes(1));
    await expect(restoreInstructions(db, ADMIN, 'live', notes.id)).rejects.toThrow('NOT_FOUND');
    await expect(
      restoreInstructions(db, ADMIN, 'live', '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f'),
    ).rejects.toThrow('NOT_FOUND');
    await expect(restoreInstructions(db, ADMIN, 'live', AI_INSTRUCTIONS_NONE)).rejects.toThrow(
      'NOT_FOUND',
    );
  });
});

describe('pins and the text a request uses', () => {
  it('pins ids only, with none for a block never saved', async () => {
    expect(await readPin(db)).toEqual({ live: 'none', notes: 'none' });
    const live = await saveInstructions(db, ADMIN, 'live', 'Be brief.');
    expect(await readPin(db)).toEqual({ live: live.id, notes: 'none' });
  });

  it('a live call keeps the version it started with after an admin saves a new one', async () => {
    await saveInstructions(db, ADMIN, 'live', 'Version A', minutes(1));
    const pin = await readPin(db);
    await saveInstructions(db, ADMIN, 'live', 'Version B', minutes(2));
    // The running call sends its pin with every request.
    expect(await resolveInstructions(db, 'live', pin.live)).toBe('Version A');
    // On another server (nothing in memory) too.
    resetInstructionsCache();
    expect(await resolveInstructions(db, 'live', pin.live)).toBe('Version A');
    // A call that starts now gets the new version.
    const next = await readPin(db);
    expect(await resolveInstructions(db, 'live', next.live)).toBe('Version B');
    // A request with no pin uses the version in force.
    expect(await resolveInstructions(db, 'live')).toBe('Version B');
  });

  it('a call that started with an empty block keeps none, even after a save', async () => {
    const pin = await readPin(db);
    await saveInstructions(db, ADMIN, 'live', 'Version A');
    expect(await resolveInstructions(db, 'live', pin.live)).toBe('');
  });

  it('falls back to the version in force for a pin of another block or an unknown id', async () => {
    await saveInstructions(db, ADMIN, 'live', 'Live text', minutes(1));
    const notes = await saveInstructions(db, ADMIN, 'notes', 'Notes text', minutes(2));
    expect(await resolveInstructions(db, 'live', notes.id)).toBe('Live text');
    expect(await resolveInstructions(db, 'live', '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f')).toBe(
      'Live text',
    );
    expect(await resolveInstructions(db, 'live', 'not-a-version')).toBe('Live text');
  });

  it('keeps answering with the last text known when the database fails, logging no text', async () => {
    await saveInstructions(db, ADMIN, 'live', 'Known text');
    expect(await resolveInstructions(db, 'live')).toBe('Known text');
    const broken = {
      select() {
        throw new Error('connection lost Known text');
      },
    } as unknown as InstructionsDb;
    // An hour later the memory copy of the versions in force is stale, so the database is asked.
    expect(await resolveInstructions(broken, 'live', undefined, Date.now() + 3_600_000)).toBe(
      'Known text',
    );
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('ai instructions: read failed');
    expect(logged).not.toContain('Known text');
  });

  it('reads the database once per version (versions never change)', async () => {
    const saved = await saveInstructions(db, ADMIN, 'live', 'Cached');
    resetInstructionsCache();
    const select = vi.spyOn(db, 'select');
    await resolveInstructions(db, 'live', saved.id);
    await resolveInstructions(db, 'live', saved.id);
    await resolveInstructions(db, 'live', saved.id);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

/** An invented live prompt that keeps every rule the app needs (ADR-0086). */
const LIVE_PROMPT: CustomPrompt = {
  core: [
    'Custom rules. Every reply starts with [[type|for|source]].',
    'Every reply ends with [[question|the question you answered]].',
    '- garbled: write only the two hidden lines.',
    '- none: write only the two hidden lines.',
  ].join('\n'),
  reminder: 'Custom reminder.',
  screenshot: 'A screenshot reply starts with [[type|for|source]].',
};

describe('custom full prompts (ADR-0086)', () => {
  it('refuses a non-admin before touching the database', async () => {
    const untouchable = new Proxy(
      {},
      {
        get() {
          throw new Error('the database must not be touched');
        },
      },
    ) as InstructionsDb;
    await expect(savePrompt(untouchable, USER, 'live', LIVE_PROMPT)).rejects.toThrow('FORBIDDEN');
    await expect(savePrompt(untouchable, USER, 'live', null)).rejects.toThrow('FORBIDDEN');
    await expect(
      restoreInstructions(
        untouchable,
        USER,
        'live',
        '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f',
        minutes(1),
        'prompt',
      ),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('saves a prompt as a new version, keeping the instructions in force, and lists it', async () => {
    await saveInstructions(db, ADMIN, 'live', 'Be brief.', minutes(1));
    const saved = await savePrompt(
      db,
      ADMIN,
      'live',
      { ...LIVE_PROMPT, reminder: ' r \r\n' },
      minutes(2),
    );
    expect(saved.created).toBe(true);
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.activeId).toBe(saved.id);
    expect(state.live.activeText).toBe('Be brief.');
    // Cleaned like the instructions: line endings and outer spaces.
    expect(state.live.activePrompt).toEqual({ ...LIVE_PROMPT, reminder: 'r' });
    expect(state.live.versions.map((version) => version.prompt === null)).toEqual([false, true]);
    // Saving the same prompt again adds nothing; saving instructions keeps the prompt.
    expect(
      (await savePrompt(db, ADMIN, 'live', { ...LIVE_PROMPT, reminder: 'r' }, minutes(3))).created,
    ).toBe(false);
    await saveInstructions(db, ADMIN, 'live', 'Be warm.', minutes(4));
    expect(await resolveSettings(db, 'live')).toEqual({
      text: 'Be warm.',
      prompt: { ...LIVE_PROMPT, reminder: 'r' },
    });
  });

  it('refuses a prompt missing the output format, writing nothing, and names what is missing', async () => {
    const broken = { ...LIVE_PROMPT, core: 'Just be helpful.' };
    const error = await savePrompt(db, ADMIN, 'live', broken).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PromptRejectedError);
    const messages = (error as PromptRejectedError).problems.map((problem) => problem.message);
    expect(messages).toHaveLength(4);
    expect(messages.join(' ')).toContain('[[type|for|source]]');
    expect(messages.join(' ')).toContain('[[question|');
    expect(await versionCount()).toBe(0);
  });

  it('Reset to default goes back to the built-in prompt as a new version, and adds nothing when already there', async () => {
    expect((await savePrompt(db, ADMIN, 'notes', null, minutes(1))).created).toBe(false);
    await savePrompt(db, ADMIN, 'live', LIVE_PROMPT, minutes(2));
    const reset = await savePrompt(db, ADMIN, 'live', null, minutes(3));
    expect(reset.created).toBe(true);
    expect((await resolveSettings(db, 'live')).prompt).toBeNull();
    expect(await versionCount()).toBe(2);
  });

  it("restores one part only: an old prompt keeps today's instructions, old instructions keep today's prompt", async () => {
    const withPrompt = await savePrompt(db, ADMIN, 'live', LIVE_PROMPT, minutes(1));
    await saveInstructions(db, ADMIN, 'live', 'Old text', minutes(2));
    const oldText = (await loadAiInstructions(db, ADMIN)).live.activeId!;
    await savePrompt(db, ADMIN, 'live', null, minutes(3));
    await saveInstructions(db, ADMIN, 'live', 'New text', minutes(4));

    const restoredPrompt = await restoreInstructions(
      db,
      ADMIN,
      'live',
      withPrompt.id,
      minutes(5),
      'prompt',
    );
    expect(restoredPrompt.created).toBe(true);
    expect(await resolveSettings(db, 'live')).toEqual({ text: 'New text', prompt: LIVE_PROMPT });

    await savePrompt(db, ADMIN, 'live', null, minutes(6));
    await restoreInstructions(db, ADMIN, 'live', oldText, minutes(7), 'text');
    expect(await resolveSettings(db, 'live')).toEqual({ text: 'Old text', prompt: null });
    const state = await loadAiInstructions(db, ADMIN);
    expect(state.live.versions[0]).toMatchObject({ restoredFrom: oldText });
  });

  it('a running call keeps its prompt after an admin saves a new one; a new call gets the new one', async () => {
    await savePrompt(db, ADMIN, 'live', LIVE_PROMPT, minutes(1));
    const pin = await readPin(db);
    const changed = { ...LIVE_PROMPT, reminder: 'Changed reminder.' };
    await savePrompt(db, ADMIN, 'live', changed, minutes(2));
    expect((await resolveSettings(db, 'live', pin.live)).prompt).toEqual(LIVE_PROMPT);
    resetInstructionsCache();
    expect((await resolveSettings(db, 'live', pin.live)).prompt).toEqual(LIVE_PROMPT);
    expect((await resolveSettings(db, 'live', (await readPin(db)).live)).prompt).toEqual(changed);
  });

  it('treats a damaged stored prompt as the built-in one, and the database refuses an over-long one', async () => {
    expect(parseStoredPrompt('live', '{"core":"x"}')).toBeNull();
    expect(parseStoredPrompt('live', 'not json')).toBeNull();
    expect(parseStoredPrompt('notes', '{"rules":"r","core":"ignored"}')).toEqual({ rules: 'r' });
    await expect(
      t.pg.query(
        `INSERT INTO ai_instructions_version (id, block, text, prompt) VALUES ('x3', 'live', '', $1)`,
        ['p'.repeat(130_001)],
      ),
    ).rejects.toThrow();
  });
});
