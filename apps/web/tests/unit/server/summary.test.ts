/**
 * Tests: apps/web/src/server/summary.ts and app/api/summary/route.ts (ADR-0067, ADR-0116), with a
 * mocked Claude. The summary uses the fast model, the summary rules and the escaped documents, as
 * plain text with a 5,000-token limit (MAX_DOCUMENTS_SUMMARY_CHARS / 4); a reply cut off at that
 * limit is kept up to its last complete line with a note (never an error), a long reply is cut to
 * MAX_DOCUMENTS_SUMMARY_CHARS the same way, and a reply with no usable text is EmptySummaryError;
 * the route needs sign-in, checks the body, does not count towards the daily limit, logs the stop
 * reason, maps Claude failures, and never logs document or summary text.
 */
import { MAX_DOCUMENTS_SUMMARY_CHARS } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Spy standing in for countRequest(): the summary route must never call it. */
const countRequestMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/usage', () => ({ countRequest: countRequestMock }));

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ textReply: vi.fn(), getCachedSession: vi.fn() }));
vi.mock('@/server/claude', async (original) => ({
  ...(await original<typeof import('@/server/claude')>()),
  textReply: mocks.textReply,
}));
vi.mock('@/server/auth', () => ({ getCachedSession: mocks.getCachedSession }));
vi.mock('@/server/env', () => ({
  getClaudeEnv: () => ({ modelFast: 'fast-model', modelSmart: 'smart-model' }),
}));

import Anthropic from '@anthropic-ai/sdk';
import { POST } from '../../../app/api/summary/route';
import {
  CUT_OFF_NOTE,
  EmptySummaryError,
  SUMMARY_MAX_TOKENS,
  SUMMARY_RULES,
  finishSummary,
  summaryPrompt,
  writeDocumentsSummary,
} from '@/server/summary';

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
 * A mocked textReply() result.
 *
 * @param text       The reply text.
 * @param stopReason Why Claude stopped.
 * @returns The result.
 */
function reply(text: string, stopReason: string = 'end_turn') {
  return { text, stopReason, usage: USAGE };
}

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
  mocks.textReply.mockResolvedValue(reply('  ## pricing.txt\n- 40 dollars.  '));
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
  it('asks the fast model for plain text with the rules and the escaped documents', async () => {
    const result = await writeDocumentsSummary({ documents: DOCUMENTS }, 'fast-model');
    const input = mocks.textReply.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toEqual({
      model: 'fast-model',
      tier: 'fast',
      system: SUMMARY_RULES,
      prompt: summaryPrompt({ documents: DOCUMENTS }),
      maxTokens: SUMMARY_MAX_TOKENS,
      timeoutMs: 100_000,
    });
    expect(input).not.toHaveProperty('schema');
    expect(String(input.prompt)).toContain('<document name="pricing.txt">');
    expect(String(input.prompt)).toContain('&lt;/document&gt;');
    expect(result).toEqual({
      summary: '## pricing.txt\n- 40 dollars.',
      usage: USAGE,
      stopReason: 'end_turn',
      cutOff: false,
    });
  });

  it('lets the token limit match the character cap: 20,000 characters, 5,000 tokens', () => {
    expect(SUMMARY_MAX_TOKENS).toBe(MAX_DOCUMENTS_SUMMARY_CHARS / 4);
    expect(SUMMARY_MAX_TOKENS).toBe(5_000);
  });

  it('keeps a reply cut off at the token limit up to its last complete line, with a note', async () => {
    mocks.textReply.mockResolvedValue(
      reply(
        '## pricing.txt\n- 40 dollars.\n- Annual bill\n## handbook.txt\n- Re-plans ev',
        'max_tokens',
      ),
    );
    const result = await writeDocumentsSummary({ documents: DOCUMENTS }, 'fast-model');
    // The unfinished bullet goes, and so does the heading left without its bullets.
    expect(result.summary).toBe(`## pricing.txt\n- 40 dollars.\n- Annual bill\n\n${CUT_OFF_NOTE}`);
    expect(result.cutOff).toBe(true);
    expect(result.stopReason).toBe('max_tokens');
  });

  it('cuts a long summary at a line within the limit the smart routes accept', async () => {
    const line = '- A bullet with a figure: 52 dollars a seat.\n';
    mocks.textReply.mockResolvedValue(reply(`## a.txt\n${line.repeat(1_000)}`));
    const result = await writeDocumentsSummary({ documents: DOCUMENTS }, 'fast-model');
    expect(result.summary.length).toBeLessThanOrEqual(MAX_DOCUMENTS_SUMMARY_CHARS);
    expect(
      result.summary.endsWith(`- A bullet with a figure: 52 dollars a seat.\n\n${CUT_OFF_NOTE}`),
    ).toBe(true);
    expect(result.cutOff).toBe(true);
  });

  it('throws EmptySummaryError, with the stop reason and output tokens, for no usable text', async () => {
    mocks.textReply.mockResolvedValue(reply('', 'refusal'));
    const error = await writeDocumentsSummary({ documents: DOCUMENTS }, 'fast-model').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(EmptySummaryError);
    expect(error).toMatchObject({ stopReason: 'refusal', outputTokens: 20 });
  });
});

describe('finishSummary', () => {
  it('only trims a complete reply that fits', () => {
    expect(finishSummary('\n## a.txt\n- One.\n', false)).toEqual({
      summary: '## a.txt\n- One.',
      cutOff: false,
    });
  });

  it('keeps every line of a cut-off reply that ended on a line break', () => {
    expect(finishSummary('## a.txt\n- One.\n- Two.\n', true).summary).toBe(
      `## a.txt\n- One.\n- Two.\n\n${CUT_OFF_NOTE}`,
    );
  });

  it("gives '' when a cut-off reply has no complete line beyond a heading", () => {
    expect(finishSummary('## a.txt\n- On', true).summary).toBe('');
  });

  it('cuts a reply with no line break at the cap, never over it', () => {
    const result = finishSummary('s'.repeat(30_000), false);
    expect(result.summary).toHaveLength(MAX_DOCUMENTS_SUMMARY_CHARS);
    expect(result.summary.endsWith(CUT_OFF_NOTE)).toBe(true);
  });
});

describe('POST /api/summary', () => {
  it('returns the summary, without counting towards the daily limit or logging text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await POST(post({ documents: DOCUMENTS }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      summary: string;
      usage: unknown;
      ms: number;
      cutOff: boolean;
    };
    expect(body.summary).toBe('## pricing.txt\n- 40 dollars.');
    expect(body.usage).toEqual(USAGE);
    expect(body.cutOff).toBe(false);
    expect(countRequestMock).not.toHaveBeenCalled();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('summary: done');
    expect(logged).toContain('"stopReason":"end_turn"');
    expect(logged).not.toContain('SECRETPRICE');
    expect(logged).not.toContain('40 dollars');
  });

  it('returns 200 with the kept part for a reply cut off at the token limit', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.textReply.mockResolvedValue(reply('## pricing.txt\n- 40 dollars.\n- Bill', 'max_tokens'));
    const response = await POST(post({ documents: DOCUMENTS }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: string; cutOff: boolean };
    expect(body.summary).toBe(`## pricing.txt\n- 40 dollars.\n\n${CUT_OFF_NOTE}`);
    expect(body.cutOff).toBe(true);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"stopReason":"max_tokens"');
    expect(logged).toContain('"cutOff":true');
  });

  it('answers 502 for a reply with no summary, logging the stop reason and output tokens only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.textReply.mockResolvedValue(reply('', 'refusal'));
    const response = await POST(post({ documents: DOCUMENTS }));
    expect(response.status).toBe(502);
    expect(((await response.json()) as { code: string }).code).toBe('upstream_error');
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('"stopReason":"refusal"');
    expect(logged).toContain('"outputTokens":20');
    expect(logged).not.toContain('SECRETPRICE');
  });

  it('needs sign-in and a changed temporary password', async () => {
    mocks.getCachedSession.mockResolvedValueOnce({ session: null, setCookies: [] });
    expect((await POST(post({ documents: DOCUMENTS }))).status).toBe(401);
    mocks.getCachedSession.mockResolvedValueOnce({
      session: { user: { id: 'u1', mustChangePassword: true } },
      setCookies: [],
    });
    expect((await POST(post({ documents: DOCUMENTS }))).status).toBe(401);
    expect(mocks.textReply).not.toHaveBeenCalled();
  });

  it('refuses a bad body without calling Claude', async () => {
    expect((await POST(post('not json'))).status).toBe(400);
    expect((await POST(post({ documents: [] }))).status).toBe(400);
    expect(mocks.textReply).not.toHaveBeenCalled();
  });

  it('maps a Claude failure to a safe error, never logging text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.textReply.mockRejectedValue(
      new Anthropic.APIConnectionTimeoutError({ message: 'timed out' }),
    );
    const response = await POST(post({ documents: DOCUMENTS }));
    expect(response.status).toBe(504);
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRETPRICE');
  });
});
