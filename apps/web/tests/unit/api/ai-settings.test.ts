/**
 * Tests for Admin → AI settings' server side outside src/server (ADR-0089; pin from ADR-0083):
 * - app/(app)/admin/ai-settings/actions.ts: a non-admin is refused (requireAdmin() redirects) before
 *   anything is saved, reset or restored; Save is refused unless the token proves this exact text was
 *   tried or quality-checked (no token, or a token for other text, saves nothing); a tried prompt is
 *   saved with the session's user and the note; Reset to default needs no try; restore adds a version and
 *   explains a version that is gone; text over 30,000 characters, an unknown tab or a bad version id is
 *   refused; errors come back as messages, and the logs hold no text, notes, ids or names;
 * - app/api/ai-instructions/pin/route.ts: 401 signed out or with a temporary password; ids only for a
 *   signed-in account; 503 (no detail) when the database fails; never cached.
 */
import { MAX_GLOBAL_PROMPT_CHARS } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Spies standing in for the modules the actions and route use. */
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  saveGlobalPrompt: vi.fn(),
  restoreVersion: vi.fn(),
  readPin: vi.fn(),
  getCachedSession: vi.fn(),
  revalidatePath: vi.fn(),
  checkPromptTryToken: vi.fn(),
}));
vi.mock('@/server/guard', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/aiInstructions', () => ({
  saveGlobalPrompt: mocks.saveGlobalPrompt,
  restoreVersion: mocks.restoreVersion,
  readPin: mocks.readPin,
}));
vi.mock('@/server/promptTryToken', () => ({ checkPromptTryToken: mocks.checkPromptTryToken }));
vi.mock('@/server/auth', () => ({ getCachedSession: mocks.getCachedSession }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

const { resetPromptAction, restoreVersionAction, savePromptAction } =
  await import('../../../app/(app)/admin/ai-settings/actions');
const { GET } = await import('../../../app/api/ai-instructions/pin/route');

/** An invented version id. */
const PIN = '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f';

/** An invented admin session. */
const ADMIN_SESSION = { user: { id: 'admin-1', name: 'Admin Name', role: 'admin' } };

/** An invented global prompt. */
const PROMPT = 'PROMPT-SECRET: say customers, never clients.';

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('AI settings actions', () => {
  it('refuses a non-admin before saving, resetting or restoring anything', async () => {
    // requireAdmin() redirects a non-admin, which Next.js does by throwing.
    mocks.requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    mocks.checkPromptTryToken.mockReturnValue(true);
    await expect(savePromptAction('live', PROMPT, 'TOKEN', '')).rejects.toThrow('NEXT_REDIRECT');
    await expect(resetPromptAction('live')).rejects.toThrow('NEXT_REDIRECT');
    await expect(restoreVersionAction('live', PIN)).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.saveGlobalPrompt).not.toHaveBeenCalled();
    expect(mocks.restoreVersion).not.toHaveBeenCalled();
  });

  it('refuses to save a draft that was not tried or quality-checked exactly as it is', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    // No token, or a token for other text: the check fails.
    mocks.checkPromptTryToken.mockReturnValue(false);
    for (const token of ['', 'a'.repeat(64)]) {
      const result = await savePromptAction('live', PROMPT, token, '');
      expect(result).toEqual({
        ok: false,
        error: 'Run Try it or Quality check on this exact draft before saving it.',
      });
    }
    expect(mocks.checkPromptTryToken).toHaveBeenCalledWith('live', PROMPT, 'a'.repeat(64));
    expect(mocks.saveGlobalPrompt).not.toHaveBeenCalled();
  });

  it('saves a tried prompt with the session user and the note, logging no text', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.checkPromptTryToken.mockReturnValue(true);
    mocks.saveGlobalPrompt.mockResolvedValue({ id: PIN, created: true });
    const result = await savePromptAction('notes', PROMPT, 'TOKEN', 'NOTE-SECRET');
    expect(result).toEqual({ ok: true, created: true });
    expect(mocks.saveGlobalPrompt).toHaveBeenCalledWith(
      {},
      ADMIN_SESSION.user,
      'notes',
      PROMPT,
      'NOTE-SECRET',
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/ai-settings');
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    for (const secret of ['PROMPT-SECRET', 'NOTE-SECRET', 'TOKEN', PIN, 'admin-1', 'Admin Name']) {
      expect(logs).not.toContain(secret);
    }
  });

  it('refuses text over 30,000 characters, an unknown tab or a bad version id, saving nothing', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.checkPromptTryToken.mockReturnValue(true);
    const long = await savePromptAction('live', 'x'.repeat(MAX_GLOBAL_PROMPT_CHARS + 1), 'T', '');
    expect(long).toEqual({ ok: false, error: 'Use at most 30,000 characters.' });
    expect((await savePromptAction('other' as never, PROMPT, 'T', '')).ok).toBe(false);
    expect((await resetPromptAction('other' as never)).ok).toBe(false);
    expect((await restoreVersionAction('live', 'latest')).ok).toBe(false);
    expect(mocks.saveGlobalPrompt).not.toHaveBeenCalled();
    expect(mocks.restoreVersion).not.toHaveBeenCalled();
  });

  it('Reset to default saves the default (null) with no try needed', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.saveGlobalPrompt.mockResolvedValue({ id: PIN, created: true });
    expect(await resetPromptAction('ask')).toEqual({ ok: true, created: true });
    expect(mocks.saveGlobalPrompt).toHaveBeenCalledWith({}, ADMIN_SESSION.user, 'ask', null, null);
    expect(mocks.checkPromptTryToken).not.toHaveBeenCalled();
  });

  it('restores as a new version, and says so when the version is gone', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.restoreVersion.mockResolvedValue({ id: 'new', created: true });
    expect(await restoreVersionAction('live', PIN)).toEqual({ ok: true, created: true });
    expect(mocks.restoreVersion).toHaveBeenCalledWith({}, ADMIN_SESSION.user, 'live', PIN);
    mocks.restoreVersion.mockRejectedValue(new Error('NOT_FOUND'));
    expect(await restoreVersionAction('live', PIN)).toEqual({
      ok: false,
      error: 'That version no longer exists.',
    });
  });

  it('turns a database failure into a generic message, logging only its name', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN_SESSION);
    mocks.checkPromptTryToken.mockReturnValue(true);
    mocks.saveGlobalPrompt.mockRejectedValue(new Error('insert ... PROMPT-SECRET failed'));
    const result = await savePromptAction('live', PROMPT, 'T', '');
    expect(result).toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('PROMPT-SECRET');
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
