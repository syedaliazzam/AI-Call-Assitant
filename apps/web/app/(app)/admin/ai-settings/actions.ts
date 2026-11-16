/**
 * File: apps/web/app/(app)/admin/ai-settings/actions.ts
 * Purpose: Server actions behind Admin → AI settings (ADR-0089): save a tab's global prompt as a new
 *          version in force, with an optional note (ADR-0091: no try is required); go back to the
 *          default prompt ("Reset to default"); restore an earlier version (as a new version). Each
 *          checks the caller is an admin (layouts do not protect actions), validates with zod, saves
 *          through src/server/aiInstructions.ts (which checks the role again) and returns a result;
 *          errors are returned, never thrown to the UI.
 * Used by: app/(app)/admin/ai-settings/page.tsx (passed to AiSettingsPage)
 * Depends on: src/server/guard.ts, src/server/aiInstructions.ts, src/server/db.ts, zod,
 *             @kite/shared (tabs, limits)
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md,
 *               docs/decisions/ADR-0091-simpler-ai-settings.md
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  AI_INSTRUCTION_BLOCKS,
  AI_INSTRUCTIONS_PIN_PATTERN,
  MAX_GLOBAL_PROMPT_CHARS,
  MAX_VERSION_NOTE_CHARS,
  type AiInstructionBlock,
} from '@kite/shared';
import type { InstructionsActionResult } from '@/features/admin/ai-settings/blocks';
import { restoreVersion, saveGlobalPrompt, type InstructionsDb } from '@/server/aiInstructions';
import { db } from '@/server/db';
import { requireAdmin } from '@/server/guard';

/** The page these actions change; refreshed after a change. */
const PAGE_PATH = '/admin/ai-settings';

/** A tab name from the browser. */
const blockSchema = z.enum(AI_INSTRUCTION_BLOCKS);

/** The message for text over the limit. */
const TOO_LONG = `Use at most ${MAX_GLOBAL_PROMPT_CHARS.toLocaleString('en-US')} characters.`;

/** A global prompt from the browser ('' sends the contract alone). */
const promptSchema = z.string().max(MAX_GLOBAL_PROMPT_CHARS, TOO_LONG);

/** A version note from the browser (cleaned and cut to the limit by the server function). */
const noteSchema = z.string().max(MAX_VERSION_NOTE_CHARS * 2);

/** A version id from the browser. */
const versionSchema = z.string().regex(AI_INSTRUCTIONS_PIN_PATTERN);

/** The message shown for any failure the admin cannot fix by editing. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** The app's Neon client has the common Drizzle Postgres shape the store's functions use. */
const store = db as unknown as InstructionsDb;

/**
 * Turns a thrown error into the message to show; logs a code only (never text or ids).
 *
 * @param action Which action failed (logged).
 * @param error  What was thrown.
 * @returns The result to return.
 * Called from: every action below
 */
function failure(action: string, error: unknown): InstructionsActionResult {
  const code = error instanceof Error ? error.message : 'unknown';
  if (code === 'TOO_LONG') return { ok: false, error: TOO_LONG };
  if (code === 'NOT_FOUND') return { ok: false, error: 'That version no longer exists.' };
  console.error('admin action failed', {
    action,
    // A known code, or the error's name (a database error's message could hold the query).
    reason: ['FORBIDDEN', 'BAD_BLOCK'].includes(code)
      ? code
      : error instanceof Error
        ? error.name
        : 'unknown',
  });
  return { ok: false, error: GENERIC_ERROR };
}

/**
 * Saves a tab's global prompt as a new version in force, for calls that start from now (a call already
 * running keeps its version). The lint hint never blocks it (ADR-0091).
 *
 * @param block  The tab ('live', 'notes' or 'ask').
 * @param prompt The global prompt.
 * @param note   A short note for the history ('' for none).
 * @returns ok (created false when it equals the version in force), or the error to show.
 * Called from: PromptWorkspace (src/features/admin/ai-settings/PromptWorkspace.tsx); tests
 */
export async function savePromptAction(
  block: AiInstructionBlock,
  prompt: string,
  note: string,
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  const parsedPrompt = promptSchema.safeParse(prompt);
  const parsedNote = noteSchema.safeParse(note);
  if (!parsedBlock.success || !parsedNote.success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!parsedPrompt.success) {
    return { ok: false, error: parsedPrompt.error.issues[0]?.message ?? GENERIC_ERROR };
  }
  try {
    const saved = await saveGlobalPrompt(
      store,
      session.user,
      parsedBlock.data,
      parsedPrompt.data,
      parsedNote.data,
    );
    // The tab, size and whether a version was added only (never the text, the note or ids).
    console.info('admin: ai prompt saved', {
      block: parsedBlock.data,
      chars: parsedPrompt.data.length,
      created: saved.created,
    });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: saved.created };
  } catch (error) {
    return failure('savePrompt', error);
  }
}

/**
 * Goes back to a tab's default prompt ("Reset to default"): a new version in force with no prompt of its
 * own. The default prompt needs no try.
 *
 * @param block The tab.
 * @returns ok (created false when the default prompt is already in force), or the error to show.
 * Called from: PromptWorkspace; tests
 */
export async function resetPromptAction(
  block: AiInstructionBlock,
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  if (!parsedBlock.success) return { ok: false, error: GENERIC_ERROR };
  try {
    const saved = await saveGlobalPrompt(store, session.user, parsedBlock.data, null, null);
    console.info('admin: ai prompt reset', { block: parsedBlock.data, created: saved.created });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: saved.created };
  } catch (error) {
    return failure('resetPrompt', error);
  }
}

/**
 * Restores an earlier version: its text becomes a new version in force.
 *
 * @param block     The tab.
 * @param versionId The version to restore.
 * @returns ok, or the error to show.
 * Called from: VersionHistory (src/features/admin/ai-settings/VersionHistory.tsx); tests
 */
export async function restoreVersionAction(
  block: AiInstructionBlock,
  versionId: string,
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  const parsedVersion = versionSchema.safeParse(versionId);
  if (!parsedBlock.success || !parsedVersion.success) return { ok: false, error: GENERIC_ERROR };
  try {
    await restoreVersion(store, session.user, parsedBlock.data, parsedVersion.data);
    console.info('admin: ai prompt restored', { block: parsedBlock.data });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: true };
  } catch (error) {
    return failure('restoreVersion', error);
  }
}
