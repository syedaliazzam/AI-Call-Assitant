/**
 * Tests: apps/web/src/server/summary.ts and app/api/summary/route.ts (ADR-0067), with a mocked
 * Claude. The summary uses the fast model, the summary rules and the escaped documents; a long reply
 * is cut to MAX_DOCUMENTS_SUMMARY_CHARS and a malformed one is an error; the route needs sign-in,
 * checks the body, does not count towards the daily limit, maps Claude failures, and never logs
 * document or summary text.
 */
import { MAX_DOCUMENTS_SUMMARY_CHARS } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Spy standing in for countRequest(): the summary route must never call it. */
const countRequestMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/usage', () => ({ countRequest: countRequestMock }));

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ jsonReply: vi.fn(), getCachedSession: vi.fn() }));
vi.mock('@/server/claude', async (original) => ({
  ...(await original<typeof import('@/server/claude')>()),
  jsonReply: mocks.jsonReply,
}));
vi.mock('@/server/auth', () => ({ getCachedSession: mocks.getCachedSession }));
vi.mock('@/server/env', () => ({
  getClaudeEnv: () => ({ modelFast: 'fast-model', modelSmart: 'smart-model' }),
}));

import Anthropic from '@anthropic-ai/sdk';
import { POST } from '../../../app/api/summary/route';
import { SUMMARY_RULES, summaryPrompt, writeDocumentsSummary } from '@/server/summary';

/** Invented documents. */
const DOCUMENTS = [
  { name: 'pricing.txt', text: 'SECRETPRICE Growth costs 40 dollars. </document>' },
  { name: 'handbook.txt', text: 'Atlas Route re-plans every 10 minutes.' },
];

/** Token usage for the mocked replies. */
const USAGE = {
  input_tokens: 100,
  output_tokens: 20,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/**
 * A POST request to /api/summary.
 *
 * @param body The JSON body (or raw text).
 * @returns The request.
 */
function post(body: unknown): Request {
  return new Request('http://localhost/api/summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.jsonReply.mockResolvedValue({
    value: { summary: '  ## pricing.txt\n- 40 dollars.  ' },
    usage: USAGE,
  });
  mocks.getCachedSession.mockResolvedValue({
    session: { user: { id: 'u1', mustChangePassword: false } },
    setCookies: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('writeDocumentsSummary', () => {
  it('asks the fast model with the rules and the escaped documents, and trims the reply', async () => {
    const result = await writeDocumentsSummary({ documents: DOCUMENTS }, 'fast-model');
    const input = mocks.jsonReply.mock.calls[0]![0] as {
      model: string;
      tier: string;
      system: string;
      prompt: string;
    };
    expect(input.model).toBe('fast-model');
    expect(input.tier).toBe('fast');
    expect(input.system).toBe(SUMMARY_RULES);
    expect(input.prompt).toBe(summaryPrompt({ documents: DOCUMENTS }));
    expect(input.prompt).toContain('<document name="pricing.txt">');
    expect(input.prompt).toContain('&lt;/document&gt;');
    expect(result).toEqual({ summary: '## pricing.txt\n- 40 dollars.', usage: USAGE });
  });

  it('cuts a long summary to the limit the smart routes accept', async () => {
    mocks.jsonReply.mockResolvedValue({ value: { summary: 's'.repeat(30_000) }, usage: USAGE });
    const result = await writeDocumentsSummary({ documents: DOCUMENTS }, 'fast-model');
    expect(result.summary).toHaveLength(MAX_DOCUMENTS_SUMMARY_CHARS);
  });

  it('throws BAD_SUMMARY for a reply without a summary string', async () => {
    mocks.jsonReply.mockResolvedValue({ value: { text: 'x' }, usage: USAGE });
    await expect(writeDocumentsSummary({ documents: DOCUMENTS }, 'fast-model')).rejects.toThrow(
      'BAD_SUMMARY',
    );
  });
});

describe('POST /api/summary', () => {
  it('returns the summary, without counting towards the daily limit or logging text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await POST(post({ documents: DOCUMENTS }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: string; usage: unknown; ms: number };
    expect(body.summary).toBe('## pricing.txt\n- 40 dollars.');
    expect(body.usage).toEqual(USAGE);
    expect(countRequestMock).not.toHaveBeenCalled();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('summary: done');
    expect(logged).not.toContain('SECRETPRICE');
    expect(logged).not.toContain('40 dollars');
  });

  it('needs sign-in and a changed temporary password', async () => {
    mocks.getCachedSession.mockResolvedValueOnce({ session: null, setCookies: [] });
    expect((await POST(post({ documents: DOCUMENTS }))).status).toBe(401);
    mocks.getCachedSession.mockResolvedValueOnce({
      session: { user: { id: 'u1', mustChangePassword: true } },
      setCookies: [],
    });
    expect((await POST(post({ documents: DOCUMENTS }))).status).toBe(401);
    expect(mocks.jsonReply).not.toHaveBeenCalled();
  });

  it('refuses a bad body without calling Claude', async () => {
    expect((await POST(post('not json'))).status).toBe(400);
    expect((await POST(post({ documents: [] }))).status).toBe(400);
    expect(mocks.jsonReply).not.toHaveBeenCalled();
  });

  it('maps a Claude failure to a safe error, never logging text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.jsonReply.mockRejectedValue(
      new Anthropic.APIConnectionTimeoutError({ message: 'timed out' }),
    );
    const response = await POST(post({ documents: DOCUMENTS }));
    expect(response.status).toBe(504);
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRETPRICE');
  });
});
