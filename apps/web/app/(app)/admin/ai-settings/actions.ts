/**
 * File: apps/web/app/(app)/admin/ai-settings/actions.ts
 * Purpose: Server actions behind Admin → AI settings (ADR-0083): save a block's company instructions
 *          as a new version, and restore an earlier version (as a new version). Each checks the caller
 *          is an admin (layouts do not protect actions), validates with zod, saves through
 *          src/server/aiInstructions.ts (which checks the role again) and returns a result; errors are
 *          returned, never thrown to the UI.
 * Used by: app/(app)/admin/ai-settings/page.tsx (passed to AiSettingsPage)
 * Depends on: src/server/guard.ts, src/server/aiInstructions.ts, src/server/db.ts, zod
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  AI_INSTRUCTION_BLOCKS,
  AI_INSTRUCTIONS_PIN_PATTERN,
  MAX_AI_INSTRUCTIONS_CHARS,
  type AiInstructionBlock,
} from '@kite/shared';
import type { InstructionsActionResult } from '@/features/admin/ai-settings/blocks';
import {
  restoreInstructions,
  saveInstructions,
  type InstructionsDb,
} from '@/server/aiInstructions';
import { db } from '@/server/db';
import { requireAdmin } from '@/server/guard';

/** The page these actions change; refreshed after a change. */
const PAGE_PATH = '/admin/ai-settings';

/** A block name from the browser. */
const blockSchema = z.enum(AI_INSTRUCTION_BLOCKS);

/** The message for text over the limit. */
const TOO_LONG = `Use at most ${MAX_AI_INSTRUCTIONS_CHARS.toLocaleString('en-US')} characters.`;

/** The text from the browser: at most the limit ('' clears the block). */
const textSchema = z.string().max(MAX_AI_INSTRUCTIONS_CHARS, TOO_LONG);

/** A version id from the browser. */
const versionSchema = z.string().regex(AI_INSTRUCTIONS_PIN_PATTERN);

/** The message shown for any failure the admin cannot fix by editing. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Turns a thrown error into the message to show; logs a code only (never text or ids).
 *
 * @param action Which action failed (logged).
 * @param error  What was thrown.
 * @returns The result to return.
 * Called from: saveInstructionsAction(), restoreInstructionsAction()
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
 * Saves a block's instructions as a new version in force, for calls that start from now.
 *
 * @param block The block ('live', 'notes' or 'ask').
 * @param text  The text ('' clears the block).
 * @returns ok (created false when nothing changed), or the error to show.
 * Called from: InstructionsEditor (src/features/admin/ai-settings/InstructionsEditor.tsx)
 */
export async function saveInstructionsAction(
  block: AiInstructionBlock,
  text: string,
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  const parsedText = textSchema.safeParse(text);
  if (!parsedBlock.success) return { ok: false, error: GENERIC_ERROR };
  if (!parsedText.success) {
    return { ok: false, error: parsedText.error.issues[0]?.message ?? GENERIC_ERROR };
  }
  try {
    const saved = await saveInstructions(
      db as unknown as InstructionsDb,
      session.user,
      parsedBlock.data,
      parsedText.data,
    );
    // The block and size only (never the text, the version id or who saved it).
    console.info('admin: ai instructions saved', {
      block: parsedBlock.data,
      chars: parsedText.data.length,
      created: saved.created,
    });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: saved.created };
  } catch (error) {
    return failure('saveInstructions', error);
  }
}

/**
 * Restores an earlier version of a block: its text becomes a new version in force.
 *
 * @param block     The block.
 * @param versionId The version to restore.
 * @returns ok, or the error to show.
 * Called from: VersionHistory (src/features/admin/ai-settings/VersionHistory.tsx)
 */
export async function restoreInstructionsAction(
  block: AiInstructionBlock,
  versionId: string,
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  const parsedVersion = versionSchema.safeParse(versionId);
  if (!parsedBlock.success || !parsedVersion.success) return { ok: false, error: GENERIC_ERROR };
  try {
    await restoreInstructions(
      db as unknown as InstructionsDb,
      session.user,
      parsedBlock.data,
      parsedVersion.data,
    );
    console.info('admin: ai instructions restored', { block: parsedBlock.data });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: true };
  } catch (error) {
    return failure('restoreInstructions', error);
  }
}
