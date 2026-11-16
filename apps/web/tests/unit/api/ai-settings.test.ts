/**
 * Tests for Admin → AI settings' server side outside src/server (ADR-0083):
 * - app/(app)/admin/ai-settings/actions.ts: a non-admin is refused (requireAdmin() redirects) before
 *   anything is saved or restored; an admin's save goes through with the session's user; text over
 *   4,000 characters, an unknown block or a bad version id is refused without saving; errors come back
 *   as messages, and the logs hold no text, ids or names;
 * - app/api/ai-instructions/pin/route.ts: 401 signed out or with a temporary password; ids only for a
 *   signed-in account; 503 (no detail) when the database fails; never cached.
 * - ADR-0086, the full-prompt actions: a non-admin is refused before anything is saved; a prompt
 *   missing the output format is refused with what is missing; a prompt not tried exactly as it is
 *   (no token, or a token for other text) is refused; a tried prompt is saved; Reset to default saves
 *   the built-in prompt; a restore names the part it copies; no prompt text reaches the logs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomPrompt, PromptProblem } from '@kite/shared';

/** Spies standing in for the modules the actions and route use. */
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  saveInstructions: vi.fn(),
  savePrompt: vi.fn(),
  restoreInstructions: vi.fn(),
  readPin: vi.fn(),
  getCachedSession: vi.fn(),
  revalidatePath: vi.fn(),
  checkPromptTryToken: vi.fn(),
}));

/** The real error's shape (server/aiInstructions.ts), for a prompt the check refuses. */
const PromptRejectedError = vi.hoisted(
  () =>
    class extends Error {
      /** What is missing. */
      readonly problems: PromptProblem[];
      /**
       * @param problems What is missing.
       */
      constructor(problems: PromptProblem[]) {
        super('INVALID_PROMPT');
        this.problems = problems;
      }
    },
);
vi.mock('@/server/guard', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/aiInstructions', () => ({
  saveInstructions: mocks.saveInstructions,
  savePrompt: mocks.savePrompt,
  restoreInstructions: mocks.restoreInstructions,
  readPin: mocks.readPin,
  PromptRejectedError,
}));
vi.mock('@/server/promptTryToken', () => ({ checkPromptTryToken: mocks.checkPromptTryToken }));
vi.mock('@/server/auth', () => ({ getCachedSession: mocks.getCachedSession }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

const { resetPromptAction, restoreInstructionsAction, saveInstructionsAction, savePromptAction } =
  await import('../../../app/(app)/admin/ai-settings/actions');
const { GET } = await import('../../../app/api/ai-instructions/pin/route');

/** An invented version id. */
const PIN = '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f';

/** An invented admin session. */
const ADMIN_SESSION = { user: { id: 'admin-1', name: 'Admin Name', role: 'admin' } };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('AI settings actions', () => {
  it('refuses a non-admin before saving or restoring anything', async () => {
    // requireAdmin() redirects a non-admin, which Next.js does by throwing.
    mocks.requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(saveInstructionsAction('live', 'Be brief.')).rejects.toThrow('NEXT_REDIRECT');
    await expect(restoreInstructionsAction('live', PIN)).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.saveInstructions).not.toHaveBeenCalled();
    expect(mocks.restoreInstructions).not.toHaveBeenCalled();
  });

  it("saves an admin's text with the session's user, and refreshes the page", async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.saveInstructions.mockResolvedValue({ id: PIN, created: true });
    expect(await saveInstructionsAction('notes', 'SECRET-TEXT')).toEqual({
      ok: true,
      created: true,
    });
    expect(mocks.saveInstructions).toHaveBeenCalledWith(
      {},
      ADMIN_SESSION.user,
      'notes',
      'SECRET-TEXT',
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/ai-settings');
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('"chars":11');
    expect(logs).not.toMatch(/SECRET|admin-1|Admin Name|0b9c7a3e/);
  });

  it('refuses text over 4,000 characters, an unknown block or a bad version id, saving nothing', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    const long = await saveInstructionsAction('live', 'x'.repeat(4_001));
    expect(long).toEqual({ ok: false, error: 'Use at most 4,000 characters.' });
    expect((await saveInstructionsAction('other' as never, 'x')).ok).toBe(false);
    expect((await restoreInstructionsAction('live', 'latest')).ok).toBe(false);
    expect(mocks.saveInstructions).not.toHaveBeenCalled();
    expect(mocks.restoreInstructions).not.toHaveBeenCalled();
  });

  it('restores as a new version, and says so when the version is gone', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.restoreInstructions.mockResolvedValue({ id: 'new', created: true });
    expect(await restoreInstructionsAction('live', PIN)).toEqual({ ok: true, created: true });
    expect(mocks.restoreInstructions).toHaveBeenCalledWith(
      {},
      ADMIN_SESSION.user,
      'live',
      PIN,
      expect.any(Date),
      'text',
    );
    mocks.restoreInstructions.mockRejectedValue(new Error('NOT_FOUND'));
    expect(await restoreInstructionsAction('live', PIN)).toEqual({
      ok: false,
      error: 'That version no longer exists.',
    });
  });

  it('turns a database failure into a generic message, logging only its name', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.saveInstructions.mockRejectedValue(new TypeError('query failed: SECRET-TEXT'));
    expect(await saveInstructionsAction('live', 'SECRET-TEXT')).toEqual({
      ok: false,
      error: 'Something went wrong. Please try again.',
    });
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).toContain('TypeError');
    expect(logs).not.toContain('SECRET');
  });
});

/** An invented live prompt that keeps every rule the app needs. */
const GOOD_PROMPT: CustomPrompt = {
  core: [
    'SECRET-PROMPT. Every reply starts with [[type|for|source]].',
    'Every reply ends with [[question|the question you answered]].',
    '- garbled: write only the two hidden lines.',
    '- none: write only the two hidden lines.',
  ].join('\n'),
  reminder: '',
  screenshot: 'A screenshot reply starts with [[type|for|source]].',
};

/** An invented token (64 hex characters). */
const TOKEN = 'a'.repeat(64);

describe('AI settings full-prompt actions (ADR-0086)', () => {
  it('refuses a non-admin before saving or resetting a prompt', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(savePromptAction('live', GOOD_PROMPT, TOKEN)).rejects.toThrow('NEXT_REDIRECT');
    await expect(resetPromptAction('live')).rejects.toThrow('NEXT_REDIRECT');
    await expect(restoreInstructionsAction('live', PIN, 'prompt')).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.savePrompt).not.toHaveBeenCalled();
    expect(mocks.restoreInstructions).not.toHaveBeenCalled();
    expect(mocks.checkPromptTryToken).not.toHaveBeenCalled();
  });

  it('refuses a prompt missing the hidden lines, saying exactly what is missing', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.checkPromptTryToken.mockReturnValue(true);
    const result = await savePromptAction(
      'live',
      { ...GOOD_PROMPT, core: 'Be brief. - garbled: only the two hidden lines.' },
      TOKEN,
    );
    expect(result.ok).toBe(false);
    const error = result.ok ? '' : result.error;
    expect(error).toContain('Rules for every live answer: The hidden first line is missing');
    expect(error).toContain('[[type|for|source]]');
    expect(error).toContain('The hidden last line is missing');
    expect(error).toContain('The none rule is missing');
    // The garbled rule is there, so it is not named.
    expect(error).not.toContain('The garbled rule is missing');
    expect(mocks.savePrompt).not.toHaveBeenCalled();
  });

  it('refuses a prompt that was not tried exactly as it is', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.checkPromptTryToken.mockReturnValue(false);
    expect(await savePromptAction('live', GOOD_PROMPT, TOKEN)).toEqual({
      ok: false,
      error: 'Run Try it with this exact prompt before saving it.',
    });
    expect(mocks.checkPromptTryToken).toHaveBeenCalledWith('live', GOOD_PROMPT, TOKEN);
    expect(mocks.savePrompt).not.toHaveBeenCalled();
  });

  it('saves a tried prompt with the session user, logging no prompt text', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.checkPromptTryToken.mockReturnValue(true);
    mocks.savePrompt.mockResolvedValue({ id: PIN, created: true });
    expect(await savePromptAction('live', GOOD_PROMPT, TOKEN)).toEqual({ ok: true, created: true });
    expect(mocks.savePrompt).toHaveBeenCalledWith({}, ADMIN_SESSION.user, 'live', GOOD_PROMPT);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/ai-settings');
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).not.toMatch(/SECRET|admin-1|Admin Name|0b9c7a3e|aaaa/);
  });

  it('refuses an unknown part name or an unknown block', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.checkPromptTryToken.mockReturnValue(true);
    const extra = { ...GOOD_PROMPT, other: 'x' } as CustomPrompt;
    expect((await savePromptAction('live', extra, TOKEN)).ok).toBe(false);
    expect((await savePromptAction('other' as never, GOOD_PROMPT, TOKEN)).ok).toBe(false);
    expect((await resetPromptAction('other' as never)).ok).toBe(false);
    expect(mocks.savePrompt).not.toHaveBeenCalled();
  });

  it('Reset to default saves the built-in prompt (null), with no try needed', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.savePrompt.mockResolvedValue({ id: PIN, created: true });
    expect(await resetPromptAction('notes')).toEqual({ ok: true, created: true });
    expect(mocks.savePrompt).toHaveBeenCalledWith({}, ADMIN_SESSION.user, 'notes', null);
    expect(mocks.checkPromptTryToken).not.toHaveBeenCalled();
  });

  it('restores a prompt by its part, and explains a restored prompt the check now refuses', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.restoreInstructions.mockResolvedValue({ id: 'new', created: true });
    expect(await restoreInstructionsAction('ask', PIN, 'prompt')).toEqual({
      ok: true,
      created: true,
    });
    expect(mocks.restoreInstructions).toHaveBeenCalledWith(
      {},
      ADMIN_SESSION.user,
      'ask',
      PIN,
      expect.any(Date),
      'prompt',
    );
    mocks.restoreInstructions.mockRejectedValue(
      new PromptRejectedError([{ part: 'chat', message: 'Empty: this part is needed.' }]),
    );
    expect(await restoreInstructionsAction('ask', PIN, 'prompt')).toEqual({
      ok: false,
      error: 'Rules for the Ask AI page: Empty: this part is needed.',
    });
    expect((await restoreInstructionsAction('ask', PIN, 'all' as never)).ok).toBe(false);
  });
});

describe('GET /api/ai-instructions/pin', () => {
  /**
   * Calls the route.
   *
   * @returns The response.
   */
  function get() {
    return GET(new Request('http://localhost:3000/api/ai-instructions/pin'));
  }

  it('refuses anyone signed out or with a temporary password', async () => {
    mocks.getCachedSession.mockResolvedValue({ session: null, setCookies: [] });
    expect((await get()).status).toBe(401);
    mocks.getCachedSession.mockResolvedValue({
      session: { user: { id: 'u1', mustChangePassword: true } },
      setCookies: [],
    });
    expect((await get()).status).toBe(401);
    expect(mocks.readPin).not.toHaveBeenCalled();
  });

  it('gives any signed-in account the ids in force, never cached', async () => {
    mocks.getCachedSession.mockResolvedValue({
      session: { user: { id: 'u1', role: 'user', mustChangePassword: false } },
      setCookies: ['cookie=1'],
    });
    mocks.readPin.mockResolvedValue({ live: PIN, notes: 'none' });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ live: PIN, notes: 'none' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toEqual(['cookie=1']);
  });

  it('answers 503 with no detail when the database fails', async () => {
    mocks.getCachedSession.mockResolvedValue({
      session: { user: { id: 'u1', role: 'user', mustChangePassword: false } },
      setCookies: [],
    });
    mocks.readPin.mockRejectedValue(new Error('connection string with secrets'));
    const response = await get();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secrets');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secrets');
  });
});
