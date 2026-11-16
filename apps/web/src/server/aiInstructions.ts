/**
 * File: apps/web/src/server/aiInstructions.ts
 * Purpose: The admin's global prompts (ADR-0089; storage from ADR-0083) in the accounts database: every
 *          saved version per tab (never changed or deleted), the version in force per tab, saving,
 *          resetting and restoring (admins only, each a new version), the version ids a call pins when it
 *          starts, and the global prompt a request uses (its pinned version, or the one in force), kept in
 *          memory so answers do not wait for the database.
 * Used by: app/(app)/admin/ai-settings/page.tsx and actions.ts, app/api/ai-instructions/pin/route.ts,
 *          app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts
 * Depends on: drizzle-orm, src/server/db.ts (companySettings), src/server/schema.ts (aiInstructionsVersion,
 *             aiInstructionsActive, user), src/server/calldata/store.ts (the database type),
 *             src/server/prompts/defaults.ts (each tab's default prompt), @kite/shared (tabs, limits, pin)
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md,
 *               ADR-0083-company-ai-instructions.md (versions, pin, history); ADR-0050 (additive migrations)
 *
 * A version's global_prompt is the text sent after the app contract; null means the tab's default prompt
 * from the code. Rows saved before ADR-0089 (company instructions in `text`, or a custom full prompt in
 * `prompt`) are read as the default prompt with their company instructions added under a heading; a
 * custom full prompt of that time held the contract too and cannot be split, so it reads as the default
 * (production held no such rows when ADR-0089 shipped). Logs carry the tab, sizes and an error's name
 * only: never the text, a version id or a person.
 */
import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import {
  AI_INSTRUCTION_BLOCKS,
  AI_INSTRUCTIONS_NONE,
  AI_INSTRUCTIONS_PIN_PATTERN,
  MAX_GLOBAL_PROMPT_CHARS,
  MAX_VERSION_NOTE_CHARS,
  normaliseGlobalPrompt,
  type AiInstructionBlock,
  type InstructionsPin,
} from '@kite/shared';
import type { CallDataDb } from './calldata/store';
import { db as appDb } from './db';
import { DEFAULT_PROMPTS, LEGACY_HEADING } from './prompts/defaults';
import { aiInstructionsActive, aiInstructionsVersion, user } from './schema';

/** The database these functions use (the app's Neon client, or PGlite in tests). */
export type InstructionsDb = CallDataDb;

/** Who is asking, for the admin-only functions. */
export interface InstructionsCaller {
  /** The account's id (stored as a version's author). */
  id: string;
  /** 'admin' or 'user'; only 'admin' may read or change the prompts. */
  role?: string | null;
}

/** One saved version, as the admin page lists it. */
export interface InstructionsVersion {
  /** The version's id. */
  id: string;
  /** Its tab. */
  block: AiInstructionBlock;
  /** Its global prompt, or null for the tab's default prompt. */
  globalPrompt: string | null;
  /** The admin's note, or null. */
  note: string | null;
  /** True for a row saved before ADR-0089, read through the legacy rule (see the file header). */
  legacy: boolean;
  /** The author's display name, or null when that account was deleted. */
  authorName: string | null;
  /** For a restore: the id of the version it copied; null otherwise. */
  restoredFrom: string | null;
  /** When it was saved (ISO 8601). */
  createdAt: string;
}

/** One tab's state for the admin page. */
export interface BlockInstructions {
  /** The version in force, or null when the tab was never saved (the default prompt). */
  activeId: string | null;
  /** The global prompt in force, or null for the default prompt. */
  activePrompt: string | null;
  /** Its versions, newest first (at most HISTORY_LIMIT). */
  versions: InstructionsVersion[];
  /** How many versions it has in all (the newest is version number `total`). */
  total: number;
}

/** What a request uses for one tab. */
export interface BlockSettings {
  /** The global prompt to send after the contract (the default prompt when none was saved). */
  globalPrompt: string;
  /** True when it is the tab's default prompt (logged as a flag, never the text). */
  isDefault: boolean;
}

/**
 * The settings of a tab with no saved version: its default prompt.
 *
 * @param block The tab.
 * @returns The settings.
 * Called from: resolveSettings(); app/api/answer/route.ts (hello mode); tests
 */
export function defaultSettings(block: AiInstructionBlock): BlockSettings {
  return { globalPrompt: DEFAULT_PROMPTS[block], isDefault: true };
}

/** How many versions per tab the page lists. */
export const HISTORY_LIMIT = 50;

/** How long the versions in force are kept in memory before they are read again, in ms. */
export const ACTIVE_CACHE_MS = 60_000;

/** How many versions are kept in memory (versions never change, so they never go stale). */
const VERSION_CACHE_SIZE = 200;

/** The heading a pre-ADR-0089 row's company instructions are added under (prompts/defaults.ts). */
export { LEGACY_HEADING };

/** A version as kept in memory. */
interface StoredVersion {
  /** Its tab. */
  block: AiInstructionBlock;
  /** Its global prompt, or null for the default prompt. */
  globalPrompt: string | null;
}

/** Versions by id. A version never changes, so a call's pinned version is read once per server. */
const byId = new Map<string, StoredVersion>();

/** The versions in force, by tab, and when they were read (per server instance). */
let activeCache: { at: number; ids: Record<AiInstructionBlock, string | null> } | null = null;

/**
 * Throws unless the caller is an admin. Every admin function calls it first, before the database is
 * touched (the page's layout and the actions check too: this is the last line).
 *
 * @param caller Who is asking.
 * @throws Error('FORBIDDEN') for anyone but an admin.
 * Called from: loadAiInstructions(), saveGlobalPrompt(), restoreVersion()
 */
function assertAdmin(caller: InstructionsCaller): void {
  if (caller.role !== 'admin') throw new Error('FORBIDDEN');
}

/**
 * Tells whether a value is one of the tabs.
 *
 * @param value Anything.
 * @returns True for 'live', 'notes' or 'ask'.
 * Called from: the save and restore functions, rows read from the database
 */
export function isInstructionBlock(value: unknown): value is AiInstructionBlock {
  return (AI_INSTRUCTION_BLOCKS as readonly unknown[]).includes(value);
}

/**
 * A row's global prompt: the column when set; for a row saved before ADR-0089, the default prompt with
 * its company instructions added under LEGACY_HEADING (a custom full prompt of that time reads as the
 * default); otherwise null (the default prompt).
 *
 * @param block        The row's tab.
 * @param globalPrompt Its global_prompt column.
 * @param text         Its text column (pre-ADR-0089 company instructions; '' since).
 * @returns The global prompt, or null for the default.
 * Called from: rowToStored(), loadAiInstructions(); tests
 */
export function rowPrompt(
  block: AiInstructionBlock,
  globalPrompt: string | null,
  text: string,
): string | null {
  if (globalPrompt !== null) return globalPrompt;
  const company = normaliseGlobalPrompt(text);
  return company ? `${DEFAULT_PROMPTS[block]}\n\n${LEGACY_HEADING}\n${company}` : null;
}

/**
 * Whether a row was saved before ADR-0089 with something in its old columns.
 *
 * @param globalPrompt Its global_prompt column.
 * @param text         Its text column.
 * @param prompt       Its prompt column (an ADR-0086 custom full prompt, as JSON).
 * @returns True for such a row.
 * Called from: loadAiInstructions()
 */
function isLegacyRow(globalPrompt: string | null, text: string, prompt: string | null): boolean {
  return globalPrompt === null && (text !== '' || prompt !== null);
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
 * The settings a stored version gives.
 *
 * @param version The version.
 * @returns Its global prompt (the default one when it has none).
 * Called from: resolveSettings(), knownSettings()
 */
function settingsOf(version: StoredVersion): BlockSettings {
  return version.globalPrompt === null
    ? defaultSettings(version.block)
    : { globalPrompt: version.globalPrompt, isDefault: false };
}

/**
 * Reads the version in force for every tab from the database, and refreshes the memory copies.
 *
 * @param db  The database.
 * @param now Clock in ms.
 * @returns The id in force per tab (null for a tab never saved).
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
      globalPrompt: aiInstructionsVersion.globalPrompt,
    })
    .from(aiInstructionsActive)
    .innerJoin(aiInstructionsVersion, eq(aiInstructionsVersion.id, aiInstructionsActive.versionId));
  const ids: Record<AiInstructionBlock, string | null> = { live: null, notes: null, ask: null };
  for (const row of rows) {
    if (!isInstructionBlock(row.block)) continue;
    ids[row.block] = row.id;
    remember(row.id, {
      block: row.block,
      globalPrompt: rowPrompt(row.block, row.globalPrompt, row.text),
    });
  }
  activeCache = { at: now, ids };
  return ids;
}

/**
 * The versions in force, from memory when read in the last ACTIVE_CACHE_MS.
 *
 * @param db  The database.
 * @param now Clock in ms.
 * @returns The id in force per tab.
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
 * Called from: resolveSettings(), restoreVersion()
 */
async function versionRow(db: InstructionsDb, id: string): Promise<StoredVersion | null> {
  const known = byId.get(id);
  if (known) return known;
  const rows = await db
    .select({
      block: aiInstructionsVersion.block,
      text: aiInstructionsVersion.text,
      globalPrompt: aiInstructionsVersion.globalPrompt,
    })
    .from(aiInstructionsVersion)
    .where(eq(aiInstructionsVersion.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || !isInstructionBlock(row.block)) return null;
  const stored = {
    block: row.block,
    globalPrompt: rowPrompt(row.block, row.globalPrompt, row.text),
  };
  remember(id, stored);
  return stored;
}

/**
 * The global prompt in force for a tab, from memory (just read by readActive()).
 *
 * @param block The tab.
 * @param id    The id in force, or null.
 * @returns Its global prompt, or null for the default prompt.
 * Called from: loadAiInstructions(), saveGlobalPrompt()
 */
function knownPrompt(block: AiInstructionBlock, id: string | null): string | null {
  const known = id ? byId.get(id) : undefined;
  return known && known.block === block ? known.globalPrompt : null;
}

/**
 * The version ids in force now, read fresh from the database (no memory copy), for a call that is
 * starting: it sends them with every request until it ends, so a later save does not change it.
 *
 * @param db  The database.
 * @param now Clock in ms (tests pass one).
 * @returns The pin (a version id, or 'none' for a tab with no version).
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
 * What a request uses for a tab: its pinned version when it sends one (a call that started earlier),
 * otherwise the version in force. A pin for another tab, or one that does not exist, falls back to the
 * version in force. When the database cannot be read, the last version known for the tab is used (the
 * default prompt if none): an answer is never stopped by this.
 *
 * @param db    The database.
 * @param block The tab.
 * @param pin   The request's pin: a version id, 'none', or undefined for "in force now".
 * @param now   Clock in ms (tests pass one).
 * @returns The global prompt to send.
 * Called from: companySettings(); tests
 */
export async function resolveSettings(
  db: InstructionsDb,
  block: AiInstructionBlock,
  pin?: string,
  now: number = Date.now(),
): Promise<BlockSettings> {
  if (pin === AI_INSTRUCTIONS_NONE) return defaultSettings(block);
  try {
    if (pin && AI_INSTRUCTIONS_PIN_PATTERN.test(pin)) {
      const pinned = await versionRow(db, pin);
      if (pinned && pinned.block === block) return settingsOf(pinned);
    }
    const id = (await activeIds(db, now))[block];
    if (!id) return defaultSettings(block);
    const version = await versionRow(db, id);
    return version ? settingsOf(version) : defaultSettings(block);
  } catch (error) {
    // The tab and the error's name only (never text or ids).
    console.error('ai instructions: read failed', {
      block,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    const id = activeCache?.ids[block] ?? null;
    const known = id ? byId.get(id) : undefined;
    return known ? settingsOf(known) : defaultSettings(block);
  }
}

/**
 * Every tab's state for the admin page: the version in force and the history with authors.
 *
 * @param db     The database.
 * @param caller The signed-in account (must be an admin).
 * @returns The state per tab.
 * @throws Error('FORBIDDEN') for anyone but an admin (the database is not touched).
 * Called from: app/(app)/admin/ai-settings/page.tsx; tests
 */
export async function loadAiInstructions(
  db: InstructionsDb,
  caller: InstructionsCaller,
): Promise<Record<AiInstructionBlock, BlockInstructions>> {
  assertAdmin(caller);
  const [ids, counts, ...histories] = await Promise.all([
    readActive(db, Date.now()),
    db
      .select({ block: aiInstructionsVersion.block, total: sql<number>`count(*)::int` })
      .from(aiInstructionsVersion)
      .groupBy(aiInstructionsVersion.block),
    ...AI_INSTRUCTION_BLOCKS.map((block) =>
      db
        .select({
          id: aiInstructionsVersion.id,
          text: aiInstructionsVersion.text,
          prompt: aiInstructionsVersion.prompt,
          globalPrompt: aiInstructionsVersion.globalPrompt,
          note: aiInstructionsVersion.note,
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
      globalPrompt: rowPrompt(block, row.globalPrompt, row.text),
      note: row.note,
      legacy: isLegacyRow(row.globalPrompt, row.text, row.prompt),
      authorName: row.authorName ?? null,
      restoredFrom: row.restoredFrom,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
    const activeId = ids[block];
    const total = Number(counts.find((row) => row.block === block)?.total ?? versions.length);
    result[block] = { activeId, activePrompt: knownPrompt(block, activeId), versions, total };
  });
  return result;
}

/** What the save and restore functions return. */
export interface SavedInstructions {
  /** The version now in force ('' when none was ever saved). */
  id: string;
  /** False when nothing changed (equal to the version in force), so no version was added. */
  created: boolean;
}

/**
 * Adds a version and makes it the one in force, in ONE statement (the database runs it atomically),
 * so the pointer can never name a version that was not written. Old columns stay empty: `text` is ''
 * and `prompt` null for every row since ADR-0089.
 *
 * @param db           The database.
 * @param block        The tab.
 * @param globalPrompt The cleaned global prompt, or null for the default prompt.
 * @param note         The admin's note (cleaned), or null.
 * @param authorId     The admin.
 * @param restoredFrom The version a restore copies, or null.
 * @param now          The save time.
 * @returns The new version's id.
 * Called from: saveGlobalPrompt(), restoreVersion()
 */
async function insertVersion(
  db: InstructionsDb,
  block: AiInstructionBlock,
  globalPrompt: string | null,
  note: string | null,
  authorId: string,
  restoredFrom: string | null,
  now: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  const at = now.toISOString();
  await db.execute(sql`
    WITH added AS (
      INSERT INTO ai_instructions_version (id, block, text, global_prompt, note, author_id, restored_from, created_at)
      VALUES (${id}, ${block}, '', ${globalPrompt}, ${note}, ${authorId}, ${restoredFrom}, ${at}::timestamptz)
      RETURNING id, block
    )
    INSERT INTO ai_instructions_active (block, version_id, updated_at)
    SELECT block, id, ${at}::timestamptz FROM added
    ON CONFLICT (block) DO UPDATE SET version_id = excluded.version_id, updated_at = excluded.updated_at`);
  // This server applies it at once (other servers within ACTIVE_CACHE_MS for requests with no pin;
  // a call that starts reads the pin fresh, so it gets the new version straight away).
  remember(id, { block, globalPrompt });
  if (activeCache) activeCache = { ...activeCache, ids: { ...activeCache.ids, [block]: id } };
  return id;
}

/**
 * Cleans a version note: one line, at most MAX_VERSION_NOTE_CHARS; '' becomes null.
 *
 * @param note The note as typed, or undefined.
 * @returns The note, or null.
 * Called from: saveGlobalPrompt(), restoreVersion()
 */
export function cleanNote(note: string | null | undefined): string | null {
  const cleaned = (note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_VERSION_NOTE_CHARS);
  return cleaned || null;
}

/**
 * Saves a tab's global prompt as a new version in force for calls that start from now (a call already
 * running keeps its pinned version). null is "Reset to default". Text equal to the default prompt is
 * stored as the default (null), so it follows later fixes to the default. A prompt equal to the one in
 * force adds nothing. The caller (the action) has already checked that this exact text was tried or
 * quality-checked; the default prompt needs no try.
 *
 * @param db     The database.
 * @param caller The signed-in account (must be an admin).
 * @param block  The tab.
 * @param prompt The text as typed (cleaned here), or null for the default prompt.
 * @param note   A short note for the history, or null.
 * @param now    The save time (tests pass one).
 * @returns The version in force and whether one was added.
 * @throws Error('FORBIDDEN') for anyone but an admin; Error('BAD_BLOCK') for an unknown tab;
 *         Error('TOO_LONG') past MAX_GLOBAL_PROMPT_CHARS. Nothing is written then.
 * Called from: savePromptAction() and resetPromptAction() in app/(app)/admin/ai-settings/actions.ts; tests
 */
export async function saveGlobalPrompt(
  db: InstructionsDb,
  caller: InstructionsCaller,
  block: AiInstructionBlock,
  prompt: string | null,
  note: string | null = null,
  now: Date = new Date(),
): Promise<SavedInstructions> {
  assertAdmin(caller);
  if (!isInstructionBlock(block)) throw new Error('BAD_BLOCK');
  const cleaned = prompt === null ? null : normaliseGlobalPrompt(prompt);
  if (cleaned !== null && cleaned.length > MAX_GLOBAL_PROMPT_CHARS) throw new Error('TOO_LONG');
  const stored = cleaned === DEFAULT_PROMPTS[block] ? null : cleaned;
  const current = (await readActive(db, now.getTime()))[block];
  if (knownPrompt(block, current) === stored && (current !== null || stored === null)) {
    return { id: current ?? '', created: false };
  }
  const id = await insertVersion(db, block, stored, cleanNote(note), caller.id, null, now);
  return { id, created: true };
}

/**
 * Restores an earlier version: its global prompt becomes a NEW version in force (with restored_from
 * set). The history keeps every version; nothing is deleted or changed.
 *
 * @param db        The database.
 * @param caller    The signed-in account (must be an admin).
 * @param block     The tab.
 * @param versionId The version to restore.
 * @param now       The restore time (tests pass one).
 * @returns The new version's id (created is always true).
 * @throws Error('FORBIDDEN') for anyone but an admin; Error('BAD_BLOCK') for an unknown tab;
 *         Error('NOT_FOUND') when the version does not exist or belongs to another tab.
 * Called from: restoreVersionAction() in app/(app)/admin/ai-settings/actions.ts; tests
 */
export async function restoreVersion(
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
  const source = await versionRow(db, versionId);
  if (!source || source.block !== block) throw new Error('NOT_FOUND');
  await readActive(db, now.getTime());
  const id = await insertVersion(db, block, source.globalPrompt, null, caller.id, versionId, now);
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
  activeCache = null;
}

/**
 * resolveSettings() on the app's database: what the Claude routes call.
 *
 * @param block The tab.
 * @param pin   The request's pin, or undefined for the version in force.
 * @returns The global prompt to send.
 * Called from: app/api/answer/route.ts, app/api/notes/route.ts, app/api/ask/route.ts
 */
export function companySettings(block: AiInstructionBlock, pin?: string): Promise<BlockSettings> {
  // The app's Neon client has the common Drizzle Postgres shape these functions use.
  return resolveSettings(appDb as unknown as InstructionsDb, block, pin);
}
