/**
 * Tests for apps/web/src/server/deepgram.ts (ADR-0076): the Deepgram settings (EU host and the per-channel
 * models by default, a bad host refused), the KITE_STT_DEEPGRAM_USERS rollout switch, and the 60-second
 * token grant (the key goes to Deepgram only and never into an error).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DEEPGRAM_HOST,
  DEFAULT_THEM_MODEL,
  DEFAULT_YOU_MODEL,
  DeepgramGrantError,
  deepgramEnabledFor,
  getDeepgramConfig,
  mintDeepgramToken,
  TOKEN_TTL_SECONDS,
} from '@/server/deepgram';

/** A key used only in these tests. */
const KEY = 'test-deepgram-key-0123456789';

describe('getDeepgramConfig', () => {
  it('is null without a key (cloud transcription not set up)', () => {
    expect(getDeepgramConfig({})).toBeNull();
    expect(getDeepgramConfig({ DEEPGRAM_API_KEY: '  ' })).toBeNull();
  });

  it('defaults to the EU host, Flux for Them and Nova-3 for You', () => {
    expect(getDeepgramConfig({ DEEPGRAM_API_KEY: KEY })).toEqual({
      apiKey: KEY,
      host: DEFAULT_DEEPGRAM_HOST,
      themModel: DEFAULT_THEM_MODEL,
      youModel: DEFAULT_YOU_MODEL,
    });
    expect(DEFAULT_DEEPGRAM_HOST).toBe('api.eu.deepgram.com');
    expect(DEFAULT_THEM_MODEL).toBe('flux-general-en');
    expect(DEFAULT_YOU_MODEL).toBe('nova-3');
  });

  it('takes the host and models from the server settings', () => {
    const config = getDeepgramConfig({
      DEEPGRAM_API_KEY: KEY,
      DEEPGRAM_HOST: 'API.Deepgram.com',
      DEEPGRAM_MODEL_THEM: 'nova-3',
      DEEPGRAM_MODEL_YOU: 'nova-3-medical',
    });
    expect(config).toMatchObject({
      host: 'api.deepgram.com',
      themModel: 'nova-3',
      youModel: 'nova-3-medical',
    });
  });

  it('refuses a host with a scheme or a path, naming the variable but not its value', () => {
    for (const bad of ['https://api.deepgram.com', 'api.deepgram.com/v1', 'evil.example:8080']) {
      expect(() => getDeepgramConfig({ DEEPGRAM_API_KEY: KEY, DEEPGRAM_HOST: bad })).toThrow(
        /DEEPGRAM_HOST/,
      );
    }
  });
});

describe('deepgramEnabledFor (rollout switch)', () => {
  it('is off for everyone when unset', () => {
    expect(deepgramEnabledFor('u1', {})).toBe(false);
  });

  it('is on only for the listed accounts', () => {
    const env = { KITE_STT_DEEPGRAM_USERS: ' u1 , u2' };
    expect(deepgramEnabledFor('u1', env)).toBe(true);
    expect(deepgramEnabledFor('u2', env)).toBe(true);
    expect(deepgramEnabledFor('u3', env)).toBe(false);
  });

  it('is on for everyone with *', () => {
    expect(deepgramEnabledFor('anyone', { KITE_STT_DEEPGRAM_USERS: '*' })).toBe(true);
  });
});

describe('mintDeepgramToken', () => {
  it('asks the configured host for a 60-second grant with the key, and returns the token', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: 'short-token', expires_in: 60 }),
    );
    const minted = await mintDeepgramToken(
      { apiKey: KEY, host: 'api.eu.deepgram.com' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(minted).toEqual({ token: 'short-token', expiresIn: 60 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.eu.deepgram.com/v1/auth/grant');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Token ${KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({ ttl_seconds: TOKEN_TTL_SECONDS });
  });

  it('uses 60 s when Deepgram does not say', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 't' }));
    const minted = await mintDeepgramToken(
      { apiKey: KEY, host: 'h.example.com' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(minted.expiresIn).toBe(TOKEN_TTL_SECONDS);
  });

  it('fails with the status only for a refusal, never the key or the reply body', async () => {
    const fetchImpl = vi.fn(async () => new Response(`bad key ${KEY}`, { status: 403 }));
    const error = await mintDeepgramToken(
      { apiKey: KEY, host: 'h.example.com' },
      fetchImpl as unknown as typeof fetch,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeepgramGrantError);
    expect((error as DeepgramGrantError).status).toBe(403);
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it('fails for a reply without a token, and with status 0 when Deepgram cannot be reached', async () => {
    const empty = vi.fn(async () => Response.json({}));
    await expect(
      mintDeepgramToken({ apiKey: KEY, host: 'h.example.com' }, empty as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(DeepgramGrantError);
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await mintDeepgramToken(
      { apiKey: KEY, host: 'h.example.com' },
      offline as unknown as typeof fetch,
    ).catch((caught: unknown) => caught);
    expect((error as DeepgramGrantError).status).toBe(0);
  });
});
