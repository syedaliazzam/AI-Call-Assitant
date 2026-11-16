/**
 * Tests for apps/web/src/server/promptTryToken.ts (ADR-0086, ADR-0089): the token a successful "Try it"
 * or quality check returns proves that exact global prompt, for that tab, was tried: it matches the same
 * text (line endings and outer spaces aside), and nothing else (other text, another tab or secret, or a
 * malformed token).
 */
import { describe, expect, it } from 'vitest';
import { signPromptTry, verifyPromptTry } from '@/server/promptTryToken';

/** An invented secret (at least 32 characters, like the auth secret). */
const SECRET = 'test-secret-0123456789-abcdefghijklmnop';

/** An invented global prompt. */
const PROMPT = 'Rules:\n- Bring out pricing.';

describe('prompt try tokens', () => {
  it('matches the prompt that was tried, whatever its line endings or outer spaces', () => {
    const token = signPromptTry(SECRET, 'notes', PROMPT);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, token)).toBe(true);
    expect(verifyPromptTry(SECRET, 'notes', '  Rules:\r\n- Bring out pricing.\r\n', token)).toBe(
      true,
    );
  });

  it('refuses an edited prompt, another tab, another secret or a malformed token', () => {
    const token = signPromptTry(SECRET, 'notes', PROMPT);
    expect(verifyPromptTry(SECRET, 'notes', `${PROMPT}!`, token)).toBe(false);
    expect(verifyPromptTry(SECRET, 'ask', PROMPT, token)).toBe(false);
    expect(verifyPromptTry(`${SECRET}x`, 'notes', PROMPT, token)).toBe(false);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, '')).toBe(false);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, token.toUpperCase())).toBe(false);
    expect(verifyPromptTry(SECRET, 'notes', PROMPT, `${token}00`)).toBe(false);
  });
});
