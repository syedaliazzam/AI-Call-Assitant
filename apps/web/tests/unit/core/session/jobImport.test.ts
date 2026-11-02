/**
 * Tests: apps/web/src/core/session/jobImport.ts. It never throws, shows the page's own messages,
 * and hides any other failure behind a generic one.
 */
import { describe, expect, it, vi } from 'vitest';
import { importJobLink } from '@/core/session/jobImport';

/**
 * A fetch that answers with one response.
 *
 * @param status The status.
 * @param body   The JSON body.
 * @returns The fake.
 */
function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
}

describe('importJobLink', () => {
  it('returns what was found', async () => {
    const fields = { company: 'Lantern', role: 'Analyst', description: 'Duties' };
    const fetchImpl = reply(200, { fields, host: 'jobs.example.com' });
    expect(await importJobLink('https://jobs.example.com/1', fetchImpl)).toEqual({
      ok: true,
      fields,
      host: 'jobs.example.com',
    });
  });

  it('shows the message for a page it could not read', async () => {
    const outcome = await importJobLink(
      'https://x.example',
      reply(422, { message: 'Kite can only read public web pages.' }),
    );
    expect(outcome).toEqual({ ok: false, message: 'Kite can only read public web pages.' });
  });

  it('shows a generic message for any other failure', async () => {
    const outcome = await importJobLink(
      'https://x.example',
      reply(502, { message: 'internal detail' }),
    );
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain('internal detail');
  });

  it('does not throw when offline', async () => {
    const offline = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await importJobLink('https://x.example', offline)).ok).toBe(false);
  });
});
