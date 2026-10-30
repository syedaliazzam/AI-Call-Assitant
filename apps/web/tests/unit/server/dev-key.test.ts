/**
 * Tests for apps/web/src/server/dev-key.ts (checkDevKey) and keyWorkspace() in
 * src/server/claude.ts, with the workspace lookup faked (no network): a development key in
 * its own workspace passes; the guard refuses a missing or blank key, variables from a Vercel
 * production or preview environment, a key in the production workspace, a key whose workspace
 * the API does not name (the Default workspace), and a failed lookup; no refusal ever contains
 * the key. keyWorkspace() reads the anthropic-workspace-id header of one free models request.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

/** Spy standing in for client.models.list(). */
const listMock = vi.fn();

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Subclass the real client so its static error classes stay real for instanceof.
  class FakeAnthropic extends actual.default {
    override models = { list: listMock } as unknown as Anthropic['models'];
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});

const { checkDevKey, PRODUCTION_WORKSPACE_IDS } = await import('@/server/dev-key');
const { keyWorkspace } = await import('@/server/claude');

/** An invented development key (never a real one). */
const DEV_KEY = 'sk-ant-api03-INVENTED-DEV-KEY';

describe('checkDevKey', () => {
  it('passes a key from a separate workspace', async () => {
    const lookup = vi.fn(async () => 'wrkspc_dev_invented');
    expect(await checkDevKey({ ANTHROPIC_API_KEY: DEV_KEY }, lookup)).toEqual({
      ok: true,
      workspaceId: 'wrkspc_dev_invented',
    });
    expect(lookup).toHaveBeenCalledWith(DEV_KEY);
  });

  it('refuses a missing or blank key without looking anything up', async () => {
    const lookup = vi.fn(async () => 'wrkspc_dev_invented');
    for (const source of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '   ' }]) {
      const check = await checkDevKey(source, lookup);
      expect(check.ok).toBe(false);
      expect(!check.ok && check.reason).toContain('ANTHROPIC_API_KEY is missing');
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses variables pulled from Vercel production or preview', async () => {
    const lookup = vi.fn(async () => 'wrkspc_dev_invented');
    for (const VERCEL_ENV of ['production', 'preview']) {
      const check = await checkDevKey({ ANTHROPIC_API_KEY: DEV_KEY, VERCEL_ENV }, lookup);
      expect(!check.ok && check.reason).toContain(`Vercel ${VERCEL_ENV}`);
    }
    // Vercel's Development environment (what `vercel env pull` writes) is fine.
    const pulled = await checkDevKey(
      { ANTHROPIC_API_KEY: DEV_KEY, VERCEL_ENV: 'development' },
      lookup,
    );
    expect(pulled.ok).toBe(true);
  });

  it('refuses the production workspace, the Default workspace and a failed lookup', async () => {
    const production = PRODUCTION_WORKSPACE_IDS[0]!;
    const refusals = await Promise.all([
      checkDevKey({ ANTHROPIC_API_KEY: DEV_KEY }, async () => production),
      checkDevKey({ ANTHROPIC_API_KEY: DEV_KEY }, async () => null),
      checkDevKey({ ANTHROPIC_API_KEY: DEV_KEY }, async () => {
        throw new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers());
      }),
      checkDevKey({ ANTHROPIC_API_KEY: DEV_KEY }, async () => {
        throw new Error('offline');
      }),
    ]);
    const reasons = refusals.map((check) => (check.ok ? 'ok' : check.reason));
    expect(reasons[0]).toContain(`production workspace (${production})`);
    expect(reasons[1]).toContain('Default workspace');
    expect(reasons[2]).toContain('HTTP 401');
    expect(reasons[3]).toContain('no connection');
    for (const reason of reasons) {
      expect(reason).toContain('.env.local');
      expect(reason).not.toContain(DEV_KEY);
    }
  });
});

describe('keyWorkspace', () => {
  it('reads the workspace header of one models request with the given key', async () => {
    const headers = new Headers({ 'anthropic-workspace-id': 'wrkspc_dev_invented' });
    listMock.mockReturnValue({ withResponse: async () => ({ response: { headers } }) });
    expect(await keyWorkspace(DEV_KEY)).toBe('wrkspc_dev_invented');
    expect(listMock).toHaveBeenCalledWith({ limit: 1 });
    listMock.mockReturnValue({
      withResponse: async () => ({ response: { headers: new Headers() } }),
    });
    expect(await keyWorkspace(DEV_KEY)).toBeNull();
  });
});
