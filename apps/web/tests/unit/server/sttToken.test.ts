/**
 * Tests for apps/web/src/server/sttToken.ts (POST /api/stt/token, ADR-0076): signed-in accounts only, the
 * rollout switch, the per-account rate limit, no key on the server, a failed grant, and a good reply (the
 * token, host and models; never the server's key; never cached; refreshed sign-in cookies passed on).
 * Nothing is logged but the status and the time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth', () => ({ getCachedSession: vi.fn() }));

import type { DeepgramConfig } from '@/server/deepgram';
import { createRateLimiter } from '@/server/google/rateLimit';
import { handleSttToken, type SttTokenDeps, type TokenUser } from '@/server/sttToken';

/** A key used only in these tests. */
const KEY = 'test-deepgram-key-0123456789';

/** The settings the fake server has. */
const CONFIG: DeepgramConfig = {
  apiKey: KEY,
  host: 'api.eu.deepgram.com',
  themModel: 'flux-general-en',
  youModel: 'nova-3',
};

/**
 * Dependencies for one test.
 *
 * @param user      The signed-in account (null: signed out).
 * @param overrides Anything to replace.
 * @returns The dependencies.
 */
function deps(user: TokenUser | null, overrides: Partial<SttTokenDeps> = {}): SttTokenDeps {
  return {
    session: async () => ({ user, setCookies: ['kite.session=refreshed; Path=/'] }),
    config: () => CONFIG,
    enabled: (userId) => userId === 'flagged',
    mint: async () => ({ token: 'short-token', expiresIn: 60 }),
    limiter: createRateLimiter(30, 60_000),
    ...overrides,
  };
}

/**
 * A request to the route.
 *
 * @returns The request.
 */
const request = () => new Request('https://kite.test/api/stt/token', { method: 'POST' });

/** The flagged account. */
const FLAGGED: TokenUser = { id: 'flagged', mustChangePassword: false };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/stt/token', () => {
  it('refuses signed-out visitors and temporary passwords with 401', async () => {
    const signedOut = await handleSttToken(request(), deps(null));
    expect(signedOut.status).toBe(401);
    const temporary = await handleSttToken(
      request(),
      deps({ id: 'flagged', mustChangePassword: true }),
    );
    expect(temporary.status).toBe(401);
  });

  it('answers 404 not_enabled for an account outside the rollout, without minting', async () => {
    const mint = vi.fn();
    const response = await handleSttToken(
      request(),
      deps({ id: 'other', mustChangePassword: false }, { mint }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_enabled' });
    expect(mint).not.toHaveBeenCalled();
  });

  it('rate-limits each account', async () => {
    const shared = deps(FLAGGED, { limiter: createRateLimiter(2, 60_000) });
    expect((await handleSttToken(request(), shared)).status).toBe(200);
    expect((await handleSttToken(request(), shared)).status).toBe(200);
    const third = await handleSttToken(request(), shared);
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('answers 503 when the server has no Deepgram key (or a bad host setting)', async () => {
    expect((await handleSttToken(request(), deps(FLAGGED, { config: () => null }))).status).toBe(
      503,
    );
    const badHost = deps(FLAGGED, {
      config: () => {
        throw new Error('DEEPGRAM_HOST must be a host name');
      },
    });
    expect((await handleSttToken(request(), badHost)).status).toBe(503);
  });

  it('answers 502 when Deepgram refuses, and logs only the status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { DeepgramGrantError } = await import('@/server/deepgram');
    const response = await handleSttToken(
      request(),
      deps(FLAGGED, {
        mint: async () => {
          throw new DeepgramGrantError(401, 'Deepgram refused the grant (401)');
        },
      }),
    );
    expect(response.status).toBe(502);
    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('flagged');
  });

  it('returns the token, host and models, never the key, never cached, with refreshed cookies', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await handleSttToken(request(), deps(FLAGGED));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('kite.session=refreshed');
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({
      token: 'short-token',
      expiresIn: 60,
      host: 'api.eu.deepgram.com',
      models: { them: 'flux-general-en', you: 'nova-3' },
    });
    // The log line has the status and the time only: no token, no account.
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('short-token');
    expect(logged).not.toContain('flagged');
  });
});
