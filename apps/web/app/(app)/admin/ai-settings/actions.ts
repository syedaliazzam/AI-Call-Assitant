/**
 * File: apps/web/app/(app)/admin/ai-settings/actions.ts
 * Purpose: Server actions behind Admin → AI settings: save a block's company instructions as a new
 *          version (ADR-0083); save a block's custom full system prompt, only after it was tried, or
 *          go back to the built-in prompt (ADR-0086); and restore an earlier version's instructions
 *          or prompt (as a new version). Each checks the caller is an admin (layouts do not protect
 *          actions), validates with zod, saves through src/server/aiInstructions.ts (which checks the
 *          role again) and returns a result; errors are returned, never thrown to the UI.
 * Used by: app/(app)/admin/ai-settings/page.tsx (passed to AiSettingsPage)
 * Depends on: src/server/guard.ts, src/server/aiInstructions.ts, src/server/promptTryToken.ts,
 *             src/server/db.ts, zod, @kite/shared (checkCustomPrompt)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0086-full-system-prompt-editing.md
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  AI_INSTRUCTION_BLOCKS,
  AI_INSTRUCTIONS_PIN_PATTERN,
  checkCustomPrompt,
  describePromptProblems,
  MAX_AI_INSTRUCTIONS_CHARS,
  MAX_PROMPT_PART_CHARS,
  type AiInstructionBlock,
  type CustomPrompt,
} from '@kite/shared';
import type { InstructionsActionResult } from '@/features/admin/ai-settings/blocks';
import {
  PromptRejectedError,
  restoreInstructions,
  saveInstructions,
  savePrompt,
  type InstructionsDb,
} from '@/server/aiInstructions';
import { db } from '@/server/db';
import { requireAdmin } from '@/server/guard';
import { checkPromptTryToken } from '@/server/promptTryToken';

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

/** Which part of a version a restore copies: the instructions or the full prompt. */
const partSchema = z.enum(['text', 'prompt']);

/** One prompt part from the browser (the limit itself is checked by checkCustomPrompt()). */
const partTextSchema = z.string().max(MAX_PROMPT_PART_CHARS * 2);

/** A custom prompt from the browser: known parts only (which ones the block needs is checked later). */
const promptSchema = z
  .object({
    core: partTextSchema,
    reminder: partTextSchema,
    screenshot: partTextSchema,
    rules: partTextSchema,
    chat: partTextSchema,
    review: partTextSchema,
  })
  .partial()
  .strict();

/** A try token from the browser (server/promptTryToken.ts: 64 hex characters). */
const tokenSchema = z.string().max(128);

/** The message shown for any failure the admin cannot fix by editing. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** The message when a prompt was not tried as it is now. */
const NOT_TRIED = 'Run Try it with this exact prompt before saving it.';

/**
 * Turns a thrown error into the message to show; logs a code only (never text or ids).
 *
 * @param action Which action failed (logged).
 * @param error  What was thrown.
 * @returns The result to return.
 * Called from: every action below
 */
function failure(action: string, error: unknown): InstructionsActionResult {
  if (error instanceof PromptRejectedError) {
    return { ok: false, error: describePromptProblems(error.problems) };
  }
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
 * Saves a block's custom full system prompt as a new version in force (ADR-0086), for calls that
 * start from now. Refused unless the prompt passes checkCustomPrompt() (the message says what is
 * missing) and `token` proves this exact prompt was tried.
 *
 * @param block  The block.
 * @param prompt The prompt, part by part.
 * @param token  The promptToken of a successful try of this prompt.
 * @returns ok (created false when it equals the prompt in force), or the error to show.
 * Called from: PromptEditor (src/features/admin/ai-settings/PromptEditor.tsx)
 */
export async function savePromptAction(
  block: AiInstructionBlock,
  prompt: CustomPrompt,
  token: string,
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  const parsedPrompt = promptSchema.safeParse(prompt);
  const parsedToken = tokenSchema.safeParse(token);
  if (!parsedBlock.success || !parsedPrompt.success || !parsedToken.success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  // The format check first, so the message names what is missing even when no try was made.
  const problems = checkCustomPrompt(parsedBlock.data, parsedPrompt.data);
  if (problems.length > 0) return { ok: false, error: describePromptProblems(problems) };
  if (!checkPromptTryToken(parsedBlock.data, parsedPrompt.data, parsedToken.data)) {
    return { ok: false, error: NOT_TRIED };
  }
  try {
    const saved = await savePrompt(
      db as unknown as InstructionsDb,
      session.user,
      parsedBlock.data,
      parsedPrompt.data,
    );
    // The block and whether a version was added only (never the prompt or ids).
    console.info('admin: ai prompt saved', { block: parsedBlock.data, created: saved.created });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: saved.created };
  } catch (error) {
    return failure('savePrompt', error);
  }
}

/**
 * Goes back to a block's built-in prompt ("Reset to default", ADR-0086): a new version in force with
 * no custom prompt, keeping the instructions. The built-in prompt needs no try.
 *
 * @param block The block.
 * @returns ok (created false when the built-in prompt is already in force), or the error to show.
 * Called from: PromptEditor (src/features/admin/ai-settings/PromptEditor.tsx)
 */
export async function resetPromptAction(
  block: AiInstructionBlock,
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  if (!parsedBlock.success) return { ok: false, error: GENERIC_ERROR };
  try {
    const saved = await savePrompt(
      db as unknown as InstructionsDb,
      session.user,
      parsedBlock.data,
      null,
    );
    console.info('admin: ai prompt reset', { block: parsedBlock.data, created: saved.created });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: saved.created };
  } catch (error) {
    return failure('resetPrompt', error);
  }
}

/**
 * Restores an earlier version's instructions or prompt: it becomes a new version in force, and the
 * other part stays as it is.
 *
 * @param block     The block.
 * @param versionId The version to restore.
 * @param part      'text' (the instructions; simple mode) or 'prompt' (the full prompt; advanced mode).
 * @returns ok, or the error to show.
 * Called from: VersionHistory (src/features/admin/ai-settings/VersionHistory.tsx)
 */
export async function restoreInstructionsAction(
  block: AiInstructionBlock,
  versionId: string,
  part: 'text' | 'prompt' = 'text',
): Promise<InstructionsActionResult> {
  const session = await requireAdmin();
  const parsedBlock = blockSchema.safeParse(block);
  const parsedVersion = versionSchema.safeParse(versionId);
  const parsedPart = partSchema.safeParse(part);
  if (!parsedBlock.success || !parsedVersion.success || !parsedPart.success) {
    return { ok: false, error: GENERIC_ERROR };
  }
  try {
    await restoreInstructions(
      db as unknown as InstructionsDb,
      session.user,
      parsedBlock.data,
      parsedVersion.data,
      new Date(),
      parsedPart.data,
    );
    console.info('admin: ai instructions restored', {
      block: parsedBlock.data,
      part: parsedPart.data,
    });
    revalidatePath(PAGE_PATH);
    return { ok: true, created: true };
  } catch (error) {
    return failure('restoreInstructions', error);
  }
}
