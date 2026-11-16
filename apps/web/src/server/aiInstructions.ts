/**
 * File: apps/web/src/server/aiInstructions.ts
 * Purpose: The company AI instructions (ADR-0083) and the custom full system prompts (ADR-0086) in the
 *          accounts database: every saved version per block (never changed or deleted), the version
 *          in force per block, saving and restoring (admins only), the version ids a call pins when it
 *          starts, and the instructions and prompt a request uses (its pinned version, or the one in
 *          force), kept in memory so answers do not wait for the database. ADR-0087: the built-in
 *          prompts the app has run with, and whether a custom prompt in force predates the current one.
 * Used by: app/(app)/admin/ai-settings/page.tsx and actions.ts, app/api/ai-instructions/pin/route.ts,
 *          app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts
 * Depends on: drizzle-orm, src/server/db.ts (companySettings), src/server/schema.ts (aiInstructionsVersion,
 *             aiInstructionsActive, aiBuiltinPrompt, user), src/server/calldata/store.ts (the database type),
 *             src/server/prompts/builtIn.ts (the built-in prompts, their hash and date),
 *             src/server/prompts/company.ts (normaliseInstructions), @kite/shared (blocks, limit, pin,
 *             custom prompt check)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md, ADR-0086-full-system-prompt-editing.md,
 *               ADR-0087-built-in-rules-change-notice.md;
 *               ADR-0050 (additive migrations)
 *
 * One version holds both the instructions and the prompt (null = the built-in prompt), so a call's pin
 * covers both, and its cached prompt prefix stays the same until it ends. Logs carry the block, sizes
 * and an error's name only: never the text, a version id or a person.
 */
import 'server-only';
import { asc, desc, eq, sql } from 'drizzle-orm';
import {
  AI_INSTRUCTION_BLOCKS,
  AI_INSTRUCTIONS_NONE,
  AI_INSTRUCTIONS_PIN_PATTERN,
  checkCustomPrompt,
  MAX_AI_INSTRUCTIONS_CHARS,
  normalisePrompt,
  PROMPT_PARTS,
  promptKey,
  type AiInstructionBlock,
  type CustomPrompt,
  type InstructionsPin,
  type PromptProblem,
} from '@kite/shared';
import type { CallDataDb } from './calldata/store';
import { db as appDb } from './db';
import { BUILT_IN_PROMPTS, BUILT_IN_REVISIONS, builtInHash } from './prompts/builtIn';
import { normaliseInstructions } from './prompts/company';
import { aiBuiltinPrompt, aiInstructionsActive, aiInstructionsVersion, user } from './schema';

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
  /** Its instructions ('' means none). */
  text: string;
  /** Its custom full prompt (ADR-0086), or null for the built-in prompt. */
  prompt: CustomPrompt | null;
  /** The author's display name, or null when that account was deleted. */
  authorName: string | null;
  /** For a restore: the id of the version it copied; null otherwise. */
  restoredFrom: string | null;
  /** When it was saved (ISO 8601). */
  createdAt: string;
}

/**
 * ADR-0087: the built-in rules changed after the custom prompt in force was written (it does not
 * include those changes).
 */
export interface BuiltInChange {
  /** The day the built-in prompt last changed (YYYY-MM-DD, BUILT_IN_REVISIONS). */
  date: string;
  /** The built-in prompt the custom one was written against, or null when it was not recorded. */
  previous: CustomPrompt | null;
}

/** One block's state for the admin page. */
export interface BlockInstructions {
  /** The version in force, or null when the block was never saved. */
  activeId: string | null;
  /** The instructions in force ('' for none). */
  activeText: string;
  /** The custom prompt in force, or null for the built-in prompt. */
  activePrompt: CustomPrompt | null;
  /** ADR-0087: set when the built-in rules changed since the custom prompt in force was written. */
  builtInChange: BuiltInChange | null;
  /** Its versions, newest first (at most HISTORY_LIMIT). */
  versions: InstructionsVersion[];
}

/** Where the built-in prompts come from: the code (tests pass others to act out a release). */
export interface BuiltInSource {
  /** A block's built-in prompt. */
  prompt: (block: AiInstructionBlock) => CustomPrompt;
  /** Its hash. */
  hash: (block: AiInstructionBlock) => string;
  /** The day it last changed (YYYY-MM-DD). */
  date: (block: AiInstructionBlock) => string;
}

/** The app's own built-in prompts (server/prompts/builtIn.ts). */
export const APP_BUILT_INS: BuiltInSource = {
  prompt: (block) => BUILT_IN_PROMPTS[block],
  hash: (block) => builtInHash(block),
  date: (block) => BUILT_IN_REVISIONS[block].date,
};

/** What a request uses for one block: the instructions and the prompt of one version. */
export interface BlockSettings {
  /** The company instructions ('' for none). */
  text: string;
  /** The custom full prompt, or null for the built-in prompt. */
  prompt: CustomPrompt | null;
}

/** No instructions and the built-in prompt: a block never saved, or a call pinned to 'none'. */
export const NO_SETTINGS: BlockSettings = Object.freeze({ text: '', prompt: null });

/** How many versions per block the page lists. */
export const HISTORY_LIMIT = 50;

/** How long the versions in force are kept in memory before they are read again, in ms. */
export const ACTIVE_CACHE_MS = 60_000;

/** How many versions are kept in memory (versions never change, so they never go stale). */
const VERSION_CACHE_SIZE = 200;

/** A version as kept in memory. */
interface StoredVersion extends BlockSettings {
  /** Its block. */
  block: AiInstructionBlock;
  /** ADR-0087: the hash of the built-in prompt its custom prompt was written against, or null. */
  baseHash: string | null;
}

/** The built-in prompts this server has recorded ("block:hash"), so it records each one once. */
const registered = new Set<string>();

/** Versions by id. A version never changes, so a call's pinned version is read once per server. */
const byId = new Map<string, StoredVersion>();

/** The versions in force, by block, and when they were read (per server instance). */
let activeCache: { at: number; ids: Record<AiInstructionBlock, string | null> } | null = null;

/**
 * A custom prompt was refused by checkCustomPrompt() (ADR-0086). Its message is the code
 * 'INVALID_PROMPT'; `problems` says what is missing (shown to the admin, never logged).
 */
export class PromptRejectedError extends Error {
  /** What is missing or wrong. */
  readonly problems: PromptProblem[];

  /**
   * @param problems From checkCustomPrompt().
   */
  constructor(problems: PromptProblem[]) {
    super('INVALID_PROMPT');
    this.name = 'PromptRejectedError';
    this.problems = problems;
  }
}

/**
 * Throws unless the caller is an admin. Every admin function calls it first, before the database is
 * touched (the page's layout and the actions check too: this is the last line).
 *
 * @param caller Who is asking.
 * @throws Error('FORBIDDEN') for anyone but an admin.
 * Called from: loadAiInstructions(), saveInstructions(), savePrompt(), restoreInstructions()
 */
function assertAdmin(caller: InstructionsCaller): void {
  if (caller.role !== 'admin') throw new Error('FORBIDDEN');
}

/**
 * Tells whether a value is one of the blocks.
 *
 * @param value Anything.
 * @returns True for 'live', 'notes' or 'ask'.
 * Called from: the save and restore functions, rows read from the database
 */
export function isInstructionBlock(value: unknown): value is AiInstructionBlock {
  return (AI_INSTRUCTION_BLOCKS as readonly unknown[]).includes(value);
}

/**
 * Reads a stored prompt (JSON). Anything that is not an object of the block's parts as strings is
 * treated as the built-in prompt, so a damaged row can never break an answer.
 *
 * @param block The block.
 * @param json  The column's value.
 * @returns The prompt (every part of the block present), or null.
 * Called from: rowToStored()
 */
export function parseStoredPrompt(
  block: AiInstructionBlock,
  json: string | null,
): CustomPrompt | null {
  if (json === null) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const prompt: CustomPrompt = {};
    for (const part of PROMPT_PARTS[block]) {
      const text = record[part];
      if (typeof text !== 'string') return null;
      prompt[part] = text;
    }
    return prompt;
  } catch {
    return null;
  }
}

/**
 * Writes a prompt for the database: the block's parts in order, cleaned, as JSON.
 *
 * @param block  The block.
 * @param prompt The prompt, or null for the built-in prompt.
 * @returns The column's value.
 * Called from: insertVersion()
 */
function storedPrompt(block: AiInstructionBlock, prompt: CustomPrompt | null): string | null {
  if (prompt === null) return null;
  const cleaned = normalisePrompt(block, prompt);
  const ordered: Record<string, string> = {};
  for (const part of PROMPT_PARTS[block]) ordered[part] = cleaned[part] ?? '';
  return JSON.stringify(ordered);
}

/**
 * Whether two prompts send the same bytes (null is the built-in prompt).
 *
 * @param block The block.
 * @param a     One prompt.
 * @param b     The other.
 * @returns True when equal.
 * Called from: saveInstructions(), savePrompt()
 */
function samePrompt(
  block: AiInstructionBlock,
  a: CustomPrompt | null,
  b: CustomPrompt | null,
): boolean {
  if (a === null || b === null) return a === b;
  return promptKey(block, a) === promptKey(block, b);
}

/**
 * Turns a row into what is kept in memory.
 *
 * @param block    The row's block.
 * @param text     Its instructions.
 * @param prompt   Its prompt column.
 * @param baseHash Its base_hash column.
 * @returns The stored version.
 * Called from: readActive(), versionRow(), insertVersion()
 */
function rowToStored(
  block: AiInstructionBlock,
  text: string,
  prompt: string | null,
  baseHash: string | null,
): StoredVersion {
  const parsed = parseStoredPrompt(block, prompt);
  // A base only means something for a custom prompt.
  return { block, text, prompt: parsed, baseHash: parsed ? baseHash : null };
}

/**
 * Keeps a version in memory, dropping the oldest entries past VERSION_CACHE_SIZE.
 *
 * @param id      The version's id.
 * @param version The version.
 * Called from: the reads and writes below
 */
function remember(id: string, version: StoredVersion): void {
  byId.delete(id);
  byId.set(id, version);
  while (byId.size > VERSION_CACHE_SIZE) {
    const oldest = byId.keys().next().value;
    if (oldest === undefined) break;
    byId.delete(oldest);
  }
}

/**
 * Reads the version in force for every block (with its text and prompt) from the database, and
 * refreshes the memory copies.
 *
 * @param db  The database.
 * @param now Clock in ms.
 * @returns The id in force per block (null for a block never saved).
 * Called from: readPin(), activeIds(), loadAiInstructions(), the save functions
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
      prompt: aiInstructionsVersion.prompt,
      baseHash: aiInstructionsVersion.baseHash,
    })
    .from(aiInstructionsActive)
    .innerJoin(aiInstructionsVersion, eq(aiInstructionsVersion.id, aiInstructionsActive.versionId));
  const ids: Record<AiInstructionBlock, string | null> = { live: null, notes: null, ask: null };
  for (const row of rows) {
    if (!isInstructionBlock(row.block)) continue;
    ids[row.block] = row.id;
    remember(row.id, rowToStored(row.block, row.text, row.prompt, row.baseHash));
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
 * Called from: resolveSettings()
 */
async function activeIds(
  db: InstructionsDb,
  now: number,
): Promise<Record<AiInstructionBlock, string | null>> {
  if (activeCache && now - activeCache.at < ACTIVE_CACHE_MS) return activeCache.ids;
  return readActive(db, now);
}

/**
 * One version, from memory or the database.
 *
 * @param db The database.
 * @param id The version's id.
 * @returns It, or null when there is no such version.
 * Called from: resolveSettings(), restoreInstructions()
 */
async function versionRow(db: InstructionsDb, id: string): Promise<StoredVersion | null> {
  const known = byId.get(id);
  if (known) return known;
  const rows = await db
    .select({
      block: aiInstructionsVersion.block,
      text: aiInstructionsVersion.text,
      prompt: aiInstructionsVersion.prompt,
      baseHash: aiInstructionsVersion.baseHash,
    })
    .from(aiInstructionsVersion)
    .where(eq(aiInstructionsVersion.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || !isInstructionBlock(row.block)) return null;
  const stored = rowToStored(row.block, row.text, row.prompt, row.baseHash);
  remember(id, stored);
  return stored;
}

/**
 * The block's state in force from memory (just read by readActive()).
 *
 * @param id The id in force, or null.
 * @returns Its instructions and prompt (NO_SETTINGS when none).
 * Called from: loadAiInstructions(), the save functions
 */
function knownSettings(id: string | null): BlockSettings {
  const known = id ? byId.get(id) : undefined;
  return known ? { text: known.text, prompt: known.prompt } : NO_SETTINGS;
}

/**
 * The base hash of the version in force, from memory (just read by readActive()).
 *
 * @param id The id in force, or null.
 * @returns Its base hash, or null.
 * Called from: loadAiInstructions(), saveInstructions(), restoreInstructions()
 */
function knownBase(id: string | null): string | null {
  return (id ? byId.get(id)?.baseHash : null) ?? null;
}

/**
 * Records the built-in prompts this server runs with (ADR-0087), once per server for each: a row per
 * block and hash in ai_builtin_prompt, kept so "View changes" can show it after a later release. Never
 * stops the caller: a failure is logged (its name only) and tried again next time.
 *
 * @param db       The database.
 * @param builtIns Where the built-in prompts come from (the code; tests pass others).
 * Called from: loadAiInstructions(), savePrompt(), readPin()
 */
export async function registerBuiltIns(
  db: InstructionsDb,
  builtIns: BuiltInSource = APP_BUILT_INS,
): Promise<void> {
  const rows = AI_INSTRUCTION_BLOCKS.map((block) => ({
    block,
    hash: builtIns.hash(block),
    prompt: storedPrompt(block, builtIns.prompt(block)) ?? '{}',
  })).filter((row) => !registered.has(`${row.block}:${row.hash}`));
  if (rows.length === 0) return;
  try {
    await db.insert(aiBuiltinPrompt).values(rows).onConflictDoNothing();
    for (const row of rows) registered.add(`${row.block}:${row.hash}`);
  } catch (error) {
    console.error('ai instructions: built-in record failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/**
 * Whether the built-in rules changed since the custom prompt in force was written (ADR-0087). A custom
 * prompt saved before base hashes were kept is taken to be based on the first built-in prompt recorded
 * for the block (base hashes and the record started in the same release, whose built-in text had not
 * changed since custom prompts began).
 *
 * @param block    The block.
 * @param active   The prompt in force (null = built-in: no change to report).
 * @param baseHash Its base hash, or null when not recorded.
 * @param records  The recorded built-in prompts for the block, oldest first.
 * @param builtIns Where the current built-in prompt comes from.
 * @returns The change, or null when there is none to report.
 * Called from: loadAiInstructions()
 */
function changeSince(
  block: AiInstructionBlock,
  active: CustomPrompt | null,
  baseHash: string | null,
  records: readonly { hash: string; prompt: string }[],
  builtIns: BuiltInSource,
): BuiltInChange | null {
  if (active === null) return null;
  const base = baseHash ?? records[0]?.hash ?? null;
  if (base === null || base === builtIns.hash(block)) return null;
  const record = records.find((row) => row.hash === base);
  return {
    date: builtIns.date(block),
    previous: record ? parseStoredPrompt(block, record.prompt) : null,
  };
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
  const [ids] = await Promise.all([
    readActive(db, now),
    // ADR-0087: calls start soon after a release, so its built-in prompts are recorded early. Once per
    // server; never fails the pin (registerBuiltIns() catches its own errors).
    registerBuiltIns(db),
  ]);
  return { live: ids.live ?? AI_INSTRUCTIONS_NONE, notes: ids.notes ?? AI_INSTRUCTIONS_NONE };
}

/**
 * What a request uses for a block: its pinned version when it sends one (a call that started
 * earlier), otherwise the version in force. A pin for another block, or one that does not exist,
 * falls back to the version in force. When the database cannot be read, the last version known for
 * the block is used (NO_SETTINGS if none): an answer is never stopped by this.
 *
 * @param db    The database.
 * @param block The block.
 * @param pin   The request's pin: a version id, 'none', or undefined for "in force now".
 * @param now   Clock in ms (tests pass one).
 * @returns The instructions and the prompt (null = built-in).
 * Called from: companySettings(), resolveInstructions(); tests
 */
export async function resolveSettings(
  db: InstructionsDb,
  block: AiInstructionBlock,
  pin?: string,
  now: number = Date.now(),
): Promise<BlockSettings> {
  if (pin === AI_INSTRUCTIONS_NONE) return NO_SETTINGS;
  try {
    if (pin && AI_INSTRUCTIONS_PIN_PATTERN.test(pin)) {
      const pinned = await versionRow(db, pin);
      if (pinned && pinned.block === block) return { text: pinned.text, prompt: pinned.prompt };
    }
    const id = (await activeIds(db, now))[block];
    if (!id) return NO_SETTINGS;
    const version = await versionRow(db, id);
    return version ? { text: version.text, prompt: version.prompt } : NO_SETTINGS;
  } catch (error) {
    // The block and the error's name only (never text or ids).
    console.error('ai instructions: read failed', {
      block,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return knownSettings(activeCache?.ids[block] ?? null);
  }
}

/**
 * The company instructions a request uses for a block (resolveSettings() without the prompt).
 *
 * @param db    The database.
 * @param block The block.
 * @param pin   The request's pin, or undefined for the version in force.
 * @param now   Clock in ms.
 * @returns The text ('' for none).
 * Called from: tests
 */
export async function resolveInstructions(
  db: InstructionsDb,
  block: AiInstructionBlock,
  pin?: string,
  now: number = Date.now(),
): Promise<string> {
  return (await resolveSettings(db, block, pin, now)).text;
}

/**
 * Every block's state for the admin page: the version in force and the history with authors.
 *
 * @param db       The database.
 * @param caller   The signed-in account (must be an admin).
 * @param builtIns ADR-0087: the built-in prompts in force (tests pass others to act out a release).
 * @returns The state per block, with any built-in change since the custom prompt in force.
 * @throws Error('FORBIDDEN') for anyone but an admin (the database is not touched).
 * Called from: app/(app)/admin/ai-settings/page.tsx; tests
 */
export async function loadAiInstructions(
  db: InstructionsDb,
  caller: InstructionsCaller,
  builtIns: BuiltInSource = APP_BUILT_INS,
): Promise<Record<AiInstructionBlock, BlockInstructions>> {
  assertAdmin(caller);
  // Recorded first, so a release's built-in prompt is known before anything is compared with it.
  await registerBuiltIns(db, builtIns);
  const [ids, records, ...histories] = await Promise.all([
    readActive(db, Date.now()),
    db
      .select({
        block: aiBuiltinPrompt.block,
        hash: aiBuiltinPrompt.hash,
        prompt: aiBuiltinPrompt.prompt,
      })
      .from(aiBuiltinPrompt)
      .orderBy(asc(aiBuiltinPrompt.firstSeenAt), asc(aiBuiltinPrompt.hash)),
    ...AI_INSTRUCTION_BLOCKS.map((block) =>
      db
        .select({
          id: aiInstructionsVersion.id,
          text: aiInstructionsVersion.text,
          prompt: aiInstructionsVersion.prompt,
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
      prompt: parseStoredPrompt(block, row.prompt),
      authorName: row.authorName ?? null,
      restoredFrom: row.restoredFrom,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
    const activeId = ids[block];
    const active = knownSettings(activeId);
    result[block] = {
      activeId,
      activeText: active.text,
      activePrompt: active.prompt,
      builtInChange: changeSince(
        block,
        active.prompt,
        knownBase(activeId),
        records.filter((row) => row.block === block),
        builtIns,
      ),
      versions,
    };
  });
  return result;
}

/** What the save and restore functions return. */
export interface SavedInstructions {
  /** The version now in force. */
  id: string;
  /** False when nothing changed (equal to the version in force), so no version was added. */
  created: boolean;
}

/**
 * Adds a version and makes it the one in force, in ONE statement (the database runs it atomically),
 * so the pointer can never name a version that was not written.
 *
 * @param db           The database.
 * @param block        The block.
 * @param settings     The cleaned instructions and the prompt (null = built-in).
 * @param authorId     The admin.
 * @param restoredFrom The version a restore copies, or null.
 * @param now          The save time.
 * @param baseHash     ADR-0087: for a custom prompt, the hash of the built-in prompt it was written
 *                     against (null for the built-in prompt or when unknown).
 * @returns The new version's id.
 * Called from: saveInstructions(), savePrompt(), restoreInstructions()
 */
async function insertVersion(
  db: InstructionsDb,
  block: AiInstructionBlock,
  settings: BlockSettings,
  authorId: string,
  restoredFrom: string | null,
  now: Date,
  baseHash: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  const at = now.toISOString();
  const prompt = storedPrompt(block, settings.prompt);
  const base = prompt === null ? null : baseHash;
  await db.execute(sql`
    WITH added AS (
      INSERT INTO ai_instructions_version (id, block, text, prompt, base_hash, author_id, restored_from, created_at)
      VALUES (${id}, ${block}, ${settings.text}, ${prompt}, ${base}, ${authorId}, ${restoredFrom}, ${at}::timestamptz)
      RETURNING id, block
    )
    INSERT INTO ai_instructions_active (block, version_id, updated_at)
    SELECT block, id, ${at}::timestamptz FROM added
    ON CONFLICT (block) DO UPDATE SET version_id = excluded.version_id, updated_at = excluded.updated_at`);
  // This server applies it at once (other servers within ACTIVE_CACHE_MS for requests with no pin;
  // a call that starts reads the pin fresh, so it gets the new version straight away).
  remember(id, rowToStored(block, settings.text, prompt, base));
  if (activeCache) activeCache = { ...activeCache, ids: { ...activeCache.ids, [block]: id } };
  return id;
}

/**
 * Saves a block's instructions as a new version and puts it in force for calls that start from now
 * (a call already running keeps its pinned version). The prompt in force is kept. Text equal to the
 * version in force adds nothing.
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
  const active = knownSettings(current);
  if (current && active.text === cleaned) return { id: current, created: false };
  // Never saved and empty: nothing to record (an empty block already means no instructions).
  if (!current && cleaned === '') return { id: '', created: false };
  const settings = { text: cleaned, prompt: active.prompt };
  // The prompt in force is kept, and so is what it was written against.
  const id = await insertVersion(db, block, settings, caller.id, null, now, knownBase(current));
  return { id, created: true };
}

/**
 * Saves a block's custom full system prompt (ADR-0086) as a new version in force for calls that start
 * from now, keeping the instructions in force; null goes back to the built-in prompt ("Reset to
 * default"). A prompt equal to the one in force adds nothing. The caller (the action) has already
 * checked that this exact prompt was tried.
 *
 * @param db     The database.
 * @param caller The signed-in account (must be an admin).
 * @param block  The block.
 * @param prompt   The prompt (cleaned here), or null for the built-in prompt.
 * @param now      The save time (tests pass one).
 * @param builtIns ADR-0087: the built-in prompts in force (tests pass others); a custom prompt records
 *                 the hash of the current one as its base, and that built-in prompt is recorded.
 * @returns The version in force and whether one was added.
 * @throws Error('FORBIDDEN') for anyone but an admin; Error('BAD_BLOCK') for an unknown block;
 *         PromptRejectedError when checkCustomPrompt() finds a problem. Nothing is written then.
 * Called from: savePromptAction() and resetPromptAction() in app/(app)/admin/ai-settings/actions.ts; tests
 */
export async function savePrompt(
  db: InstructionsDb,
  caller: InstructionsCaller,
  block: AiInstructionBlock,
  prompt: CustomPrompt | null,
  now: Date = new Date(),
  builtIns: BuiltInSource = APP_BUILT_INS,
): Promise<SavedInstructions> {
  assertAdmin(caller);
  if (!isInstructionBlock(block)) throw new Error('BAD_BLOCK');
  const cleaned = prompt === null ? null : normalisePrompt(block, prompt);
  if (cleaned !== null) {
    const problems = checkCustomPrompt(block, cleaned);
    if (problems.length > 0) throw new PromptRejectedError(problems);
  }
  const base = cleaned === null ? null : builtIns.hash(block);
  const current = (await readActive(db, now.getTime()))[block];
  const active = knownSettings(current);
  // The same prompt written against the same built-in prompt changes nothing. The same text saved
  // after a built-in change is a new version: the admin has looked at the changes.
  if (
    samePrompt(block, active.prompt, cleaned) &&
    (cleaned === null || knownBase(current) === base)
  ) {
    return { id: current ?? '', created: false };
  }
  // The base must stay readable for "View changes" after a later release.
  if (base !== null) await registerBuiltIns(db, builtIns);
  const settings = { text: active.text, prompt: cleaned };
  const id = await insertVersion(db, block, settings, caller.id, null, now, base);
  return { id, created: true };
}

/**
 * Restores an earlier version's instructions ('text') or its prompt ('prompt'): that part becomes a
 * NEW version in force, and the other part stays as it is in force now. The history keeps every
 * version; nothing is deleted or changed. A restored prompt is checked again (the check may have
 * grown since it was saved).
 *
 * @param db        The database.
 * @param caller    The signed-in account (must be an admin).
 * @param block     The block.
 * @param versionId The version to restore.
 * @param now       The restore time (tests pass one).
 * @param part      'text' (simple mode's history) or 'prompt' (advanced mode's history).
 * @returns The new version's id (created is always true).
 * @throws Error('FORBIDDEN') for anyone but an admin; Error('BAD_BLOCK') for an unknown block;
 *         Error('NOT_FOUND') when the version does not exist or belongs to another block;
 *         PromptRejectedError for a prompt that no longer passes the check.
 * Called from: restoreInstructionsAction() in app/(app)/admin/ai-settings/actions.ts; tests
 */
export async function restoreInstructions(
  db: InstructionsDb,
  caller: InstructionsCaller,
  block: AiInstructionBlock,
  versionId: string,
  now: Date = new Date(),
  part: 'text' | 'prompt' = 'text',
): Promise<SavedInstructions> {
  assertAdmin(caller);
  if (!isInstructionBlock(block)) throw new Error('BAD_BLOCK');
  if (!AI_INSTRUCTIONS_PIN_PATTERN.test(versionId) || versionId === AI_INSTRUCTIONS_NONE) {
    throw new Error('NOT_FOUND');
  }
  const source = await versionRow(db, versionId);
  if (!source || source.block !== block) throw new Error('NOT_FOUND');
  if (part === 'prompt' && source.prompt !== null) {
    const problems = checkCustomPrompt(block, source.prompt);
    if (problems.length > 0) throw new PromptRejectedError(problems);
  }
  const current = (await readActive(db, now.getTime()))[block];
  const active = knownSettings(current);
  const settings: BlockSettings =
    part === 'prompt'
      ? { text: active.text, prompt: source.prompt }
      : { text: source.text, prompt: active.prompt };
  // A restored prompt keeps what it was written against (ADR-0087); restored instructions keep the
  // prompt in force and its base.
  const base = part === 'prompt' ? source.baseHash : knownBase(current);
  const id = await insertVersion(db, block, settings, caller.id, versionId, now, base);
  return { id, created: true };
}

/**
 * Forgets the memory copies (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function resetInstructionsCache(): void {
  byId.clear();
  registered.clear();
  activeCache = null;
}

/**
 * resolveSettings() on the app's database: what the Claude routes call.
 *
 * @param block The block.
 * @param pin   The request's pin, or undefined for the version in force.
 * @returns The instructions ('' for none) and the custom prompt (null for the built-in prompt).
 * Called from: app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts
 */
export function companySettings(block: AiInstructionBlock, pin?: string): Promise<BlockSettings> {
  // The app's Neon client has the common Drizzle Postgres shape these functions use.
  return resolveSettings(appDb as unknown as InstructionsDb, block, pin);
}
