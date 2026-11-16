/**
 * File: apps/web/src/server/promptTryToken.ts
 * Purpose: Proof that a global prompt was tried (Try it) or quality-checked before it is saved (ADR-0086,
 *          ADR-0089). A successful try or check returns a token: an HMAC of the tab and the prompt's exact
 *          cleaned bytes, keyed with the server's auth secret. Saving requires a token that matches it, so
 *          an untried or edited-after-trying prompt cannot be saved, even by calling the action directly.
 * Used by: src/server/aiTry.ts and src/server/aiQuality.ts (issue, through the try and quality routes),
 *          app/(app)/admin/ai-settings/actions.ts (checks)
 * Depends on: node:crypto, @kite/shared (normaliseGlobalPrompt), src/server/env.ts (getAuthEnv: the secret)
 * Architecture: docs/decisions/ADR-0086-full-system-prompt-editing.md,
 *               docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * The token reveals nothing about the prompt, and neither it nor the prompt is ever logged.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normaliseGlobalPrompt, type AiInstructionBlock } from '@kite/shared';
import { getAuthEnv } from './env';

/** Keeps these tokens apart from anything else signed with the same secret. */
const PURPOSE = 'kite-prompt-try-v2';

/**
 * The token for a tried prompt.
 *
 * @param secret The signing secret (the auth secret in the app; tests pass one).
 * @param block  The block the prompt is for.
 * @param prompt The global prompt tried (cleaned here, so line endings and outer spaces do not matter).
 * @returns The token (64 hex characters).
 * Called from: promptTryToken(), checkPromptTryToken(); tests
 */
export function signPromptTry(secret: string, block: AiInstructionBlock, prompt: string): string {
  return createHmac('sha256', secret)
    .update(`${PURPOSE}\n${block}\n${normaliseGlobalPrompt(prompt)}`)
    .digest('hex');
}

/**
 * Whether a token proves this exact prompt was tried for this block.
 *
 * @param secret The signing secret.
 * @param block  The block.
 * @param prompt The prompt about to be saved.
 * @param token  The token the page sends (any string).
 * @returns True only for the matching token (compared in constant time).
 * Called from: checkPromptTryToken(); tests
 */
export function verifyPromptTry(
  secret: string,
  block: AiInstructionBlock,
  prompt: string,
  token: string,
): boolean {
  const expected = Buffer.from(signPromptTry(secret, block, prompt), 'hex');
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  return timingSafeEqual(expected, Buffer.from(token, 'hex'));
}

/**
 * The token for a tried prompt, with the app's secret.
 *
 * @param block  The block.
 * @param prompt The prompt tried.
 * @returns The token.
 * @throws Error when the auth settings are missing (the route answers 500).
 * Called from: src/server/aiTry.ts (handleTry), src/server/aiQuality.ts (handleQualityCheck)
 */
export function promptTryToken(block: AiInstructionBlock, prompt: string): string {
  return signPromptTry(getAuthEnv().secret, block, prompt);
}

/**
 * Whether a prompt about to be saved was tried, with the app's secret.
 *
 * @param block  The block.
 * @param prompt The prompt.
 * @param token  The token from the page.
 * @returns True when it was tried exactly as it is.
 * Called from: savePromptAction() in app/(app)/admin/ai-settings/actions.ts
 */
export function checkPromptTryToken(
  block: AiInstructionBlock,
  prompt: string,
  token: string,
): boolean {
  return verifyPromptTry(getAuthEnv().secret, block, prompt, token);
}
