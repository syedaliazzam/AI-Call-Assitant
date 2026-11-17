/**
 * Tests apps/web/src/core/session/modelAccess.ts (spec §6): it says what the server says, and says yes
 * when it cannot tell, because the server enforces the switch on every answer anyway. ADR-0095: Groq only when
 * the server says so (it needs a server key).
 */
import { describe, expect, it, vi } from 'vitest';
import { answerModelAccess, deepModelEnabled } from '@/core/session/modelAccess';

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

describe('deepModelEnabled', () => {
  it('says what the server says', async () => {
    expect(await deepModelEnabled(reply(200, { deepModel: false }))).toBe(false);
    expect(await deepModelEnabled(reply(200, { deepModel: true }))).toBe(true);
  });

  it('says yes when it cannot tell', async () => {
    expect(await deepModelEnabled(reply(401, {}))).toBe(true);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await deepModelEnabled(failing)).toBe(true);
  });
});

describe('answerModelAccess (ADR-0095)', () => {
  it('says which models may be chosen', async () => {
    expect(await answerModelAccess(reply(200, { deepModel: true, groq: true }))).toEqual({
      smart: true,
      groq: true,
    });
    // An older server says nothing about Groq: it is not offered.
    expect(await answerModelAccess(reply(200, { deepModel: false }))).toEqual({
      smart: false,
      groq: false,
    });
  });

  it('offers Smart but not Groq when it cannot tell', async () => {
    expect(await answerModelAccess(reply(500, {}))).toEqual({ smart: true, groq: false });
  });
});
