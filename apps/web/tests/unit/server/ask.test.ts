/**
 * Tests: apps/web/src/server/ask.ts and app/api/ask/route.ts, with a mocked Claude. Rules, session
 * and call are separate cached blocks with the question outside them, so later questions read the
 * cache; the smart model answers; sign-in and limits hold; nothing the user said is logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Spy standing in for countRequest() (the daily limit, ADR-0036): allows every request by default. */
const countRequestMock = vi.hoisted(() =>
  vi.fn(async (_userId: string) => ({ allowed: true, count: 1, limit: 300, ms: 0 })),
);
vi.mock('@/server/usage', () => ({ countRequest: countRequestMock }));

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ jsonReply: vi.fn(), getCachedSession: vi.fn() }));
vi.mock('@/server/claude', async (original) => ({
  ...(await original<typeof import('@/server/claude')>()),
  jsonReply: mocks.jsonReply,
}));
vi.mock('@/server/auth', () => ({ getCachedSession: mocks.getCachedSession }));
vi.mock('@/server/env', () => ({ getClaudeEnv: () => ({ modelSmart: 'smart-model' }) }));

import { POST } from '../../../app/api/ask/route';
import { answerAboutCall, ASK_RULES, estimatedCost } from '@/server/ask';

const USAGE = {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/** A valid request about an invented call. */
const REQUEST = {
  session: {
    type: 'regular',
    company: 'Alder Foods (invented)',
    role: 'Renewal',
    description: '',
    instructions: '',
    keyTerms: [],
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    documents: [],
  },
  lines: [{ speaker: 'them', text: 'SECRETLINE what is the price', at: 5 }],
  answers: [],
  notes: 'Summary: SECRETNOTE',
  question: 'SECRETQUESTION what did they ask?',
  history: [{ role: 'you', text: 'hello' }],
};

/**
 * A request to the route.
 *
 * @param body The JSON body.
 * @returns The request.
 */
function post(body: unknown): Request {
  return new Request('https://kite.test/api/ask', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.jsonReply.mockReset();
  mocks.jsonReply.mockResolvedValue({
    value: { answer: ' They asked about the price. ' },
    usage: USAGE,
  });
  mocks.getCachedSession.mockResolvedValue({
    session: { user: { id: 'u1', mustChangePassword: false } },
    setCookies: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('answerAboutCall', () => {
  it('sends rules, session and call as cached blocks, and the question outside them', async () => {
    const { text } = await answerAboutCall(REQUEST as never, 'smart-model');
    expect(text).toBe('They asked about the price.');
    const input = mocks.jsonReply.mock.calls[0]![0] as {
      tier: string;
      system: { text: string; cache_control?: unknown }[];
      prompt: string;
    };
    expect(input.tier).toBe('smart');
    expect(input.system).toHaveLength(3);
    expect(input.system.every((block) => block.cache_control)).toBe(true);
    expect(input.system[0]!.text).toBe(ASK_RULES);
    expect(input.system[1]!.text).toContain('Alder Foods');
    expect(input.system[2]!.text).toContain('SECRETLINE');
    expect(input.system[2]!.text).toContain('SECRETNOTE');
    expect(input.prompt).toContain('SECRETQUESTION');
    expect(input.prompt).toContain('User: hello');
    expect(input.system[2]!.text).not.toContain('SECRETQUESTION');
  });

  it("the call's block stays the same whatever is asked, so the cache is read", async () => {
    await answerAboutCall(REQUEST as never, 'smart-model');
    await answerAboutCall(
      { ...REQUEST, question: 'Another?', history: [] } as never,
      'smart-model',
    );
    const blocks = mocks.jsonReply.mock.calls.map(
      (call) => (call[0] as { system: { text: string }[] }).system,
    );
    expect(blocks[0]).toEqual(blocks[1]);
  });
});

describe('estimatedCost', () => {
  it('uses the list prices', () => {
    expect(estimatedCost(USAGE)).toBeCloseTo(12, 5);
    expect(
      estimatedCost({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(0.2, 5);
  });
});

describe('POST /api/ask', () => {
  it('needs a signed-in user', async () => {
    mocks.getCachedSession.mockResolvedValue({ session: null, setCookies: [] });
    expect((await POST(post(REQUEST))).status).toBe(401);
    expect(mocks.jsonReply).not.toHaveBeenCalled();
  });

  it('refuses an empty question, and too long a chat', async () => {
    expect((await POST(post({ ...REQUEST, question: '   ' }))).status).toBe(400);
    const long = Array.from({ length: 21 }, () => ({ role: 'you', text: 'x' }));
    expect((await POST(post({ ...REQUEST, history: long }))).status).toBe(400);
    expect(mocks.jsonReply).not.toHaveBeenCalled();
  });

  it('returns the reply from the smart model', async () => {
    const reply = await POST(post(REQUEST));
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ text: 'They asked about the price.' });
    expect(mocks.jsonReply.mock.calls[0]![0]).toMatchObject({ model: 'smart-model' });
  });

  it('logs no words from the call, and no cost in production', async () => {
    const logs: unknown[][] = [];
    for (const method of ['info', 'error', 'log', 'warn'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logs.push(args));
    }
    await POST(post(REQUEST));
    mocks.jsonReply.mockRejectedValue(new Error('SECRETLINE failure'));
    await POST(post(REQUEST));
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('They asked');
    expect(text).not.toContain('estimatedUsd');
  });
});
