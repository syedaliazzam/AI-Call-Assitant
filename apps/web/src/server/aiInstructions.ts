/**
 * File: apps/web/src/server/aiInstructions.ts
 * Purpose: The company AI instructions (ADR-0083) in the accounts database: every saved version per
 *          block (never changed or deleted), the version in force per block, saving and restoring
 *          (admins only), the version ids a call pins when it starts, and the text a request uses
 *          (its pinned version, or the one in force), kept in memory so answers do not wait for the
 *          database.
 * Used by: app/(app)/admin/ai-settings/page.tsx and actions.ts, app/api/ai-instructions/pin/route.ts,
 *          app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts
 * Depends on: drizzle-orm, src/server/db.ts (companyInstructions), src/server/schema.ts (aiInstructionsVersion, aiInstructionsActive, user),
 *             src/server/calldata/store.ts (the database type), src/server/prompts/company.ts
 *             (normaliseInstructions), @kite/shared (blocks, limit, pin)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md; ADR-0050 (additive migrations)
 *
 * Logs carry the block, sizes and an error's name only: never the text, a version id or a person.
 */
import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import {
  AI_INSTRUCTION_BLOCKS,
  AI_INSTRUCTIONS_NONE,
  AI_INSTRUCTIONS_PIN_PATTERN,
  MAX_AI_INSTRUCTIONS_CHARS,
  type AiInstructionBlock,
  type InstructionsPin,
} from '@kite/shared';
import type { CallDataDb } from './calldata/store';
import { db as appDb } from './db';
import { normaliseInstructions } from './prompts/company';
import { aiInstructionsActive, aiInstructionsVersion, user } from './schema';

/** The database these functions use (the app's Neon client, or PGlite in tests). */
export type InstructionsDb = CallDataDb;

/** Who is asking, for the admin-only functions. */
export interface InstructionsCaller {
  /** The account's id (stored as a version's author). */
  id: string;
  /** 'admin' or 'user'; only 'admin' may read or change the instructions. */
  role?: string | null;
}

/** One saved version, as the admin page lists it. */
export interface InstructionsVersion {
  /** The version's id. */
  id: string;
  /** Its block. */
  block: AiInstructionBlock;
  /** Its text ('' means no instructions). */
  text: string;
  /** The author's display name, or null when that account was deleted. */
  authorName: string | null;
  /** For a restore: the id of the version it copied; null otherwise. */
  restoredFrom: string | null;
  /** When it was saved (ISO 8601). */
  createdAt: string;
}

/** One block's state for the admin page. */
export interface BlockInstructions {
  /** The version in force, or null when the block was never saved. */
  activeId: string | null;
  /** The text in force ('' for none). */
  activeText: string;
  /** Its versions, newest first (at most HISTORY_LIMIT). */
  versions: InstructionsVersion[];
}

/** How many versions per block the page lists. */
export const HISTORY_LIMIT = 50;

/** How long the versions in force are kept in memory before they are read again, in ms. */
export const ACTIVE_CACHE_MS = 60_000;

/** How many version texts are kept in memory (versions never change, so they never go stale). */
const TEXT_CACHE_SIZE = 200;

/** Version texts by id. A version never changes, so a call's pinned text is read once per server. */
const textById = new Map<string, { block: AiInstructionBlock; text: string }>();

/** The versions in force, by block, and when they were read (per server instance). */
let activeCache: { at: number; ids: Record<AiInstructionBlock, string | null> } | null = null;

/**
 * Throws unless the caller is an admin. Every admin function calls it first, before the database is
 * touched (the page's layout and the actions check too: this is the last line).
 *
 * @param caller Who is asking.
 * @throws Error('FORBIDDEN') for anyone but an admin.
 * Called from: loadAiInstructions(), saveInstructions(), restoreInstructions()
 */
function assertAdmin(caller: InstructionsCaller): void {
  if (caller.role !== 'admin') throw new Error('FORBIDDEN');
}

/**
 * Tells whether a value is one of the blocks.
 *
 * @param value Anything.
 * @returns True for 'live', 'notes' or 'ask'.
 * Called from: saveInstructions(), restoreInstructions(), rows read from the database
 */
export function isInstructionBlock(value: unknown): value is AiInstructionBlock {
  return (AI_INSTRUCTION_BLOCKS as readonly unknown[]).includes(value);
}

/**
 * Keeps a version's text in memory, dropping the oldest entries past TEXT_CACHE_SIZE.
 *
 * @param id    The version's id.
 * @param block Its block.
 * @param text  Its text.
 * Called from: the reads and writes below
 */
function remember(id: string, block: AiInstructionBlock, text: string): void {
  textById.delete(id);
  textById.set(id, { block, text });
  while (textById.size > TEXT_CACHE_SIZE) {
    const oldest = textById.keys().next().value;
    if (oldest === undefined) break;
    textById.delete(oldest);
  }
}

/**
 * Reads the version in force for every block (with its text) from the database, and refreshes the
 * memory copies.
 *
 * @param db  The database.
 * @param now Clock in ms.
 * @returns The id in force per block (null for a block never saved).
 * Called from: readPin(), activeIds(), loadAiInstructions()
 */
async function readActive(
  db: InstructionsDb,
  now: number,
): Promise<Record<AiInstructionBlock, string | null>> {
  const rows = await db
    .select({
      block: aiInstructionsActive.block,
      id: aiInstructionsVersion.id,
      text: aiInstructionsVersion.text,
    })
    .from(aiInstructionsActive)
    .innerJoin(aiInstructionsVersion, eq(aiInstructionsVersion.id, aiInstructionsActive.versionId));
  const ids: Record<AiInstructionBlock, string | null> = { live: null, notes: null, ask: null };
  for (const row of rows) {
    if (!isInstructionBlock(row.block)) continue;
    ids[row.block] = row.id;
    remember(row.id, row.block, row.text);
  }
  activeCache = { at: now, ids };
  return ids;
}

/**
 * The versions in force, from memory when read in the last ACTIVE_CACHE_MS.
 *
 * @param db  The database.
 * @param now Clock in ms.
 * @returns The id in force per block.
 * Called from: resolveInstructions()
 */
async function activeIds(
  db: InstructionsDb,
  now: number,
): Promise<Record<AiInstructionBlock, string | null>> {
  if (activeCache && now - activeCache.at < ACTIVE_CACHE_MS) return activeCache.ids;
  return readActive(db, now);
}

/**
 * One version's text, from memory or the database.
 *
 * @param db The database.
 * @param id The version's id.
 * @returns Its block and text, or null when there is no such version.
 * Called from: resolveInstructions(), restoreInstructions()
 */
async function versionText(
  db: InstructionsDb,
  id: string,
): Promise<{ block: AiInstructionBlock; text: string } | null> {
  const known = textById.get(id);
  if (known) return known;
  const rows = await db
    .select({ block: aiInstructionsVersion.block, text: aiInstructionsVersion.text })
    .from(aiInstructionsVersion)
    .where(eq(aiInstructionsVersion.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || !isInstructionBlock(row.block)) return null;
  remember(id, row.block, row.text);
  return { block: row.block, text: row.text };
}

/**
 * The version ids in force now, read fresh from the database (no memory copy), for a call that is
 * starting: it sends them with every request until it ends, so a later save does not change it.
 *
 * @param db  The database.
 * @param now Clock in ms (tests pass one).
 * @returns The pin (a version id, or 'none' for a block with no version).
 * @throws The database's error (the route answers 503 and the call goes on unpinned).
 * Called from: GET in app/api/ai-instructions/pin/route.ts; tests
 */
export async function readPin(
  db: InstructionsDb,
  now: number = Date.now(),
): Promise<InstructionsPin> {
  const ids = await readActive(db, now);
  return { live: ids.live ?? AI_INSTRUCTIONS_NONE, notes: ids.notes ?? AI_INSTRUCTIONS_NONE };
}

/**
 * The company instructions a request uses for a block: its pinned version when it sends one (a call
 * that started earlier), otherwise the version in force. A pin for another block, or one that does
 * not exist, falls back to the version in force. When the database cannot be read, the last text
 * known for the block is used ('' if none): an answer is never stopped by this.
 *
 * @param db    The database.
 * @param block The block.
 * @param pin   The request's pin: a version id, 'none', or undefined for "in force now".
 * @param now   Clock in ms (tests pass one).
 * @returns The text ('' for none).
 * Called from: app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts; tests
 */
export async function resolveInstructions(
  db: InstructionsDb,
  block: AiInstructionBlock,
  pin?: string,
  now: number = Date.now(),
): Promise<string> {
  if (pin === AI_INSTRUCTIONS_NONE) return '';
  try {
    if (pin && AI_INSTRUCTIONS_PIN_PATTERN.test(pin)) {
      const pinned = await versionText(db, pin);
      if (pinned && pinned.block === block) return pinned.text;
    }
    const id = (await activeIds(db, now))[block];
    if (!id) return '';
    return (await versionText(db, id))?.text ?? '';
  } catch (error) {
    // The block and the error's name only (never text or ids).
    console.error('ai instructions: read failed', {
      block,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    const id = activeCache?.ids[block];
    return (id && textById.get(id)?.text) || '';
  }
}

/**
 * Every block's state for the admin page: the version in force and the history with authors.
 *
 * @param db     The database.
 * @param caller The signed-in account (must be an admin).
 * @returns The state per block.
 * @throws Error('FORBIDDEN') for anyone but an admin (the database is not touched).
 * Called from: app/(app)/admin/ai-settings/page.tsx; tests
 */
export async function loadAiInstructions(
  db: InstructionsDb,
  caller: InstructionsCaller,
): Promise<Record<AiInstructionBlock, BlockInstructions>> {
  assertAdmin(caller);
  const [ids, ...histories] = await Promise.all([
    readActive(db, Date.now()),
    ...AI_INSTRUCTION_BLOCKS.map((block) =>
      db
        .select({
          id: aiInstructionsVersion.id,
          text: aiInstructionsVersion.text,
          restoredFrom: aiInstructionsVersion.restoredFrom,
          createdAt: aiInstructionsVersion.createdAt,
          authorName: user.name,
        })
        .from(aiInstructionsVersion)
        .leftJoin(user, eq(user.id, aiInstructionsVersion.authorId))
        .where(eq(aiInstructionsVersion.block, block))
        .orderBy(desc(aiInstructionsVersion.createdAt), desc(aiInstructionsVersion.id))
        .limit(HISTORY_LIMIT),
    ),
  ]);
  const result = {} as Record<AiInstructionBlock, BlockInstructions>;
  AI_INSTRUCTION_BLOCKS.forEach((block, index) => {
    const versions = (histories[index] ?? []).map((row): InstructionsVersion => ({
      id: row.id,
      block,
      text: row.text,
      authorName: row.authorName ?? null,
      restoredFrom: row.restoredFrom,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
    const activeId = ids[block];
    result[block] = {
      activeId,
      activeText: (activeId && textById.get(activeId)?.text) || '',
      versions,
    };
  });
  return result;
}

/** What saveInstructions() and restoreInstructions() return. */
export interface SavedInstructions {
  /** The version now in force. */
  id: string;
  /** False when the text was the same as the one in force, so no version was added. */
  created: boolean;
}

/**
 * Adds a version and makes it the one in force, in ONE statement (the database runs it atomically),
 * so the pointer can never name a version that was not written.
 *
 * @param db           The database.
 * @param block        The block.
 * @param text         The cleaned text.
 * @param authorId     The admin.
 * @param restoredFrom The version a restore copies, or null.
 * @param now          The save time.
 * @returns The new version's id.
 * Called from: saveInstructions(), restoreInstructions()
 */
async function insertVersion(
  db: InstructionsDb,
  block: AiInstructionBlock,
  text: string,
  authorId: string,
  restoredFrom: string | null,
  now: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  const at = now.toISOString();
  await db.execute(sql`
    WITH added AS (
      INSERT INTO ai_instructions_version (id, block, text, author_id, restored_from, created_at)
      VALUES (${id}, ${block}, ${text}, ${authorId}, ${restoredFrom}, ${at}::timestamptz)
      RETURNING id, block
    )
    INSERT INTO ai_instructions_active (block, version_id, updated_at)
    SELECT block, id, ${at}::timestamptz FROM added
    ON CONFLICT (block) DO UPDATE SET version_id = excluded.version_id, updated_at = excluded.updated_at`);
  // This server applies it at once (other servers within ACTIVE_CACHE_MS for requests with no pin;
  // a call that starts reads the pin fresh, so it gets the new version straight away).
  remember(id, block, text);
  if (activeCache) activeCache = { ...activeCache, ids: { ...activeCache.ids, [block]: id } };
  return id;
}

/**
 * Saves a block's instructions as a new version and puts it in force for calls that start from now
 * (a call already running keeps its pinned version). Text equal to the version in force adds nothing.
 *
 * @param db     The database.
 * @param caller The signed-in account (must be an admin).
 * @param block  The block.
 * @param text   The text as typed (cleaned here); '' means no instructions.
 * @param now    The save time (tests pass one).
 * @returns The version in force and whether one was added.
 * @throws Error('FORBIDDEN') for anyone but an admin; Error('BAD_BLOCK') for an unknown block;
 *         Error('TOO_LONG') past MAX_AI_INSTRUCTIONS_CHARS. Nothing is written then.
 * Called from: saveInstructionsAction() in app/(app)/admin/ai-settings/actions.ts; tests
 */
export async function saveInstructions(
  db: InstructionsDb,
  caller: InstructionsCaller,
  block: AiInstructionBlock,
  text: string,
  now: Date = new Date(),
): Promise<SavedInstructions> {
  assertAdmin(caller);
  if (!isInstructionBlock(block)) throw new Error('BAD_BLOCK');
  const cleaned = normaliseInstructions(text);
  if (cleaned.length > MAX_AI_INSTRUCTIONS_CHARS) throw new Error('TOO_LONG');
  const current = (await readActive(db, now.getTime()))[block];
  if (current && textById.get(current)?.text === cleaned) return { id: current, created: false };
  // Never saved and empty: nothing to record (an empty block already means no instructions).
  if (!current && cleaned === '') return { id: '', created: false };
  return { id: await insertVersion(db, block, cleaned, caller.id, null, now), created: true };
}

/**
 * Restores an earlier version: its text becomes a NEW version in force (the history keeps every
 * version; nothing is deleted or changed).
 *
 * @param db        The database.
 * @param caller    The signed-in account (must be an admin).
 * @param block     The block.
 * @param versionId The version to restore.
 * @param now       The restore time (tests pass one).
 * @returns The new version's id (created is always true).
 * @throws Error('FORBIDDEN') for anyone but an admin; Error('BAD_BLOCK') for an unknown block;
 *         Error('NOT_FOUND') when the version does not exist or belongs to another block.
 * Called from: restoreInstructionsAction() in app/(app)/admin/ai-settings/actions.ts; tests
 */
export async function restoreInstructions(
  db: InstructionsDb,
  caller: InstructionsCaller,
  block: AiInstructionBlock,
  versionId: string,
  now: Date = new Date(),
): Promise<SavedInstructions> {
  assertAdmin(caller);
  if (!isInstructionBlock(block)) throw new Error('BAD_BLOCK');
  if (!AI_INSTRUCTIONS_PIN_PATTERN.test(versionId) || versionId === AI_INSTRUCTIONS_NONE) {
    throw new Error('NOT_FOUND');
  }
  const source = await versionText(db, versionId);
  if (!source || source.block !== block) throw new Error('NOT_FOUND');
  return {
    id: await insertVersion(db, block, source.text, caller.id, versionId, now),
    created: true,
  };
}

/**
 * Forgets the memory copies (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function resetInstructionsCache(): void {
  textById.clear();
  activeCache = null;
}

/**
 * resolveInstructions() on the app's database: what the Claude routes call.
 *
 * @param block The block.
 * @param pin   The request's pin, or undefined for the version in force.
 * @returns The text ('' for none).
 * Called from: app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts
 */
export function companyInstructions(block: AiInstructionBlock, pin?: string): Promise<string> {
  // The app's Neon client has the common Drizzle Postgres shape these functions use.
  return resolveInstructions(appDb as unknown as InstructionsDb, block, pin);
}
