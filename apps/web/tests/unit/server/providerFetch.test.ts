/**
 * Tests apps/web/src/server/providerFetch.ts (ADR-0100), with undici mocked: one Agent is made with the 60 s
 * idle keep-alive, and every request goes through undici's fetch with that Agent as its dispatcher, keeping
 * the caller's method, headers, body and signal.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** What the mocked undici saw. */
const seen = vi.hoisted(() => ({
  agents: [] as unknown[],
  fetches: [] as { input: unknown; init: Record<string, unknown> }[],
}));

vi.mock('undici', () => ({
  Agent: class {
    /** The options it was made with. */
    readonly options: unknown;
    /**
     * @param options The Agent's options.
     */
    constructor(options: unknown) {
      this.options = options;
      seen.agents.push(this);
    }
  },
  fetch: vi.fn(async (input: unknown, init: Record<string, unknown>) => {
    seen.fetches.push({ input, init });
    return new Response('ok');
  }),
}));

const { PROVIDER_KEEP_ALIVE_MS, providerFetch } = await import('@/server/providerFetch');

describe('providerFetch', () => {
  it('keeps idle connections for 60 s, in one pool every request shares', async () => {
    expect(PROVIDER_KEEP_ALIVE_MS).toBe(60_000);
    expect(seen.agents).toHaveLength(1);
    expect((seen.agents[0] as { options: unknown }).options).toEqual({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 60_000,
    });
    const signal = new AbortController().signal;
    await providerFetch('https://api.example.test/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal,
    });
    await providerFetch('https://api.example.test/v1');
    expect(seen.fetches).toHaveLength(2);
    expect(seen.fetches[0]!.init).toMatchObject({
      method: 'POST',
      body: '{}',
      signal,
      dispatcher: seen.agents[0],
    });
    expect(seen.fetches[1]!.init.dispatcher).toBe(seen.agents[0]);
    expect(seen.agents).toHaveLength(1);
  });
});
