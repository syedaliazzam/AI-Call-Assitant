/**
 * Tests for apps/web/src/core/stt/sttToken.ts (ADR-0076): the browser asks /api/stt/token by POST, never
 * cached; a good reply gives the token, host and models; a refusal keeps the server's code; no connection
 * is 'network'.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchSttToken, SttTokenError } from '@/core/stt/sttToken';

describe('fetchSttToken', () => {
  it('posts to /api/stt/token without caching and returns the reply', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        token: 't',
        expiresIn: 60,
        host: 'api.eu.deepgram.com',
        models: { them: 'flux-general-en', you: 'nova-3' },
      }),
    );
    const reply = await fetchSttToken(fetchImpl as unknown as typeof fetch);
    expect(reply.models).toEqual({ them: 'flux-general-en', you: 'nova-3' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/stt/token');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
  });

  it('keeps the server reason, and reports no connection as network', async () => {
    const refused = vi.fn(async () =>
      Response.json({ code: 'not_enabled', message: 'off' }, { status: 404 }),
    );
    const error = await fetchSttToken(refused as unknown as typeof fetch).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SttTokenError);
    expect((error as SttTokenError).code).toBe('not_enabled');
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const lost = await fetchSttToken(offline as unknown as typeof fetch).catch(
      (caught: unknown) => caught,
    );
    expect((lost as SttTokenError).code).toBe('network');
  });

  it('refuses an incomplete reply', async () => {
    const partial = vi.fn(async () => Response.json({ token: 't' }));
    await expect(fetchSttToken(partial as unknown as typeof fetch)).rejects.toBeInstanceOf(
      SttTokenError,
    );
  });
});
