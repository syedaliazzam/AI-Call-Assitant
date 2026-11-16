/**
 * Tests for apps/web/src/server/promptTryToken.ts (ADR-0086): the token a successful "Try it" returns
 * for a custom prompt proves that exact prompt, for that block, was tried: it matches the same prompt
 * (cleaning aside), and nothing else (another prompt, block or secret, or a malformed token).
 */
import { describe, expect, it } from 'vitest';
import type { CustomPrompt } from '@kite/shared';
import { signPromptTry, verifyPromptTry } from '@/server/promptTryToken';

/** An invented secret (at least 32 characters, like the auth secret). */
const SECRET = 'test-secret-0123456789-abcdefghijklmnop';

/** An invented prompt. */
const PROMPT: CustomPrompt = { rules: 'Notes rules.' };

describe('prompt try tokens', () => {
  it('matches the prompt that was tried, whatever its line endings or outer spaces', () => {
    const token = signPromptTry(SECRET, 'notes', PROMPT);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, token)).toBe(true);
    expect(verifyPromptTry(SECRET, 'notes', { rules: '  Notes rules.\r\n' }, token)).toBe(true);
  });

  it('refuses an edited prompt, another block, another secret or a malformed token', () => {
    const token = signPromptTry(SECRET, 'notes', PROMPT);
    expect(verifyPromptTry(SECRET, 'notes', { rules: 'Notes rules!' }, token)).toBe(false);
    expect(verifyPromptTry(SECRET, 'ask', { chat: 'Notes rules.' }, token)).toBe(false);
    expect(verifyPromptTry(`${SECRET}x`, 'notes', PROMPT, token)).toBe(false);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, '')).toBe(false);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, token.toUpperCase())).toBe(false);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, `${token}00`)).toBe(false);
  });
});
