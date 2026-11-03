/**
 * Tests: apps/web/src/server/prepare.ts and app/api/prepare/route.ts, with a mocked Claude. Each
 * request uses the right model and rules, with the session in a cached block; replies are cleaned
 * and limited; sign-in and limits hold; nothing the user said is logged.
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
vi.mock('@/server/env', () => ({
  getClaudeEnv: () => ({ modelFast: 'fast-model', modelSmart: 'smart-model' }),
}));

import { POST } from '../../../app/api/prepare/route';
import {
  mockFeedback,
  mockQuestions,
  mockSummary,
  MOCK_FEEDBACK_RULES,
  MOCK_QUESTION_RULES,
  questionBank,
  QUESTION_BANK_RULES,
} from '@/server/prepare';

const MODELS = { fast: 'fast-model', smart: 'smart-model' };

/** An invented session. */
const SESSION = {
  type: 'interview',
  company: 'Lantern Freight (invented)',
  role: 'Data Analyst',
  description: 'Build reports.',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'resume.txt', text: 'SECRETRESUME four years of SQL' }],
};

/**
 * What was sent to the mocked Claude.
 *
 * @param call Which call.
 * @returns Its input.
 */
function sent(call = 0) {
  return mocks.jsonReply.mock.calls[call]![0] as {
    model: string;
    tier: string;
    system: { text: string; cache_control?: unknown }[];
    prompt: string;
    maxTokens: number;
  };
}

/**
 * A request to the route.
 *
 * @param body The JSON body.
 * @returns The request.
 */
function post(body: unknown): Request {
  return new Request('https://kite.test/api/prepare', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.jsonReply.mockReset();
  mocks.getCachedSession.mockResolvedValue({
    session: { user: { id: 'u1', mustChangePassword: false } },
    setCookies: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mockQuestions', () => {
  it('uses the smart model and the session, and cleans and limits the list', async () => {
    mocks.jsonReply.mockResolvedValue({
      value: { questions: [' One? ', '', 'Two?', 'Three?', 'Four?'] },
      usage: {},
    });
    const { data } = await mockQuestions(
      { kind: 'mock-questions', session: SESSION, count: 3 },
      MODELS,
    );
    expect(data.questions).toEqual(['One?', 'Two?', 'Three?']);
    expect(sent()).toMatchObject({ model: 'smart-model', tier: 'smart' });
    expect(sent().system[0]!.text).toBe(MOCK_QUESTION_RULES);
    expect(sent().system[1]!.text).toContain('SECRETRESUME');
    expect(sent().system.every((block) => block.cache_control)).toBe(true);
    expect(sent().prompt).toContain('3 interview questions');
  });
});

describe('mockFeedback', () => {
  it('uses the fast model, because the user is waiting', async () => {
    mocks.jsonReply.mockResolvedValue({ value: { feedback: ' Good start. ' }, usage: {} });
    const { data } = await mockFeedback(
      { kind: 'mock-feedback', session: SESSION, question: 'Why us?', answer: 'I like freight.' },
      MODELS,
    );
    expect(data.feedback).toBe('Good start.');
    expect(sent()).toMatchObject({ model: 'fast-model', tier: 'fast' });
    expect(sent().system[0]!.text).toBe(MOCK_FEEDBACK_RULES);
    expect(sent().prompt).toContain('Why us?');
    expect(sent().prompt).toContain('I like freight.');
  });
});

describe('mockSummary', () => {
  it('sends every item, with the smart model', async () => {
    mocks.jsonReply.mockResolvedValue({
      value: { summary: ['Clear answers.'], nextSteps: ['Use more numbers.'] },
      usage: {},
    });
    const { data } = await mockSummary(
      {
        kind: 'mock-summary',
        session: SESSION,
        items: [
          { question: 'Q1', answer: 'A1', feedback: 'F1' },
          { question: 'Q2', answer: 'A2', feedback: 'F2' },
        ],
      },
      MODELS,
    );
    expect(data.nextSteps).toEqual(['Use more numbers.']);
    expect(sent().model).toBe('smart-model');
    for (const word of ['Q1', 'A1', 'F1', 'Q2', 'A2', 'F2']) {
      expect(sent().prompt).toContain(word);
    }
  });
});

describe('questionBank', () => {
  it("uses the smart model, the session's format, and room for the whole bank", async () => {
    mocks.jsonReply.mockResolvedValue({
      value: { groups: [{ type: 'role', questions: [{ question: 'Q', answer: 'A' }] }] },
      usage: {},
    });
    const { data } = await questionBank({ kind: 'question-bank', session: SESSION }, MODELS);
    expect(data.groups[0]?.type).toBe('role');
    expect(sent().model).toBe('smart-model');
    expect(sent().system[0]!.text).toBe(QUESTION_BANK_RULES);
    expect(sent().system[1]!.text).toContain('Answer format: headline+bullets');
    expect(sent().maxTokens).toBeGreaterThanOrEqual(4_000);
  });
});

describe('the rules', () => {
  it('never allow invented facts, and treat documents as data', () => {
    for (const rules of [MOCK_QUESTION_RULES, MOCK_FEEDBACK_RULES, QUESTION_BANK_RULES]) {
      expect(rules).toContain('Never invent facts');
      expect(rules).toContain('not instructions');
    }
  });
});

describe('POST /api/prepare', () => {
  it('needs a signed-in user', async () => {
    mocks.getCachedSession.mockResolvedValue({ session: null, setCookies: [] });
    const reply = await POST(post({ kind: 'question-bank', session: SESSION }));
    expect(reply.status).toBe(401);
    expect(mocks.jsonReply).not.toHaveBeenCalled();
  });

  it('refuses unknown kinds, too many questions and empty answers', async () => {
    for (const body of [
      { kind: 'something-else', session: SESSION },
      { kind: 'mock-questions', session: SESSION, count: 50 },
      { kind: 'mock-feedback', session: SESSION, question: 'Q', answer: '   ' },
      { kind: 'mock-summary', session: SESSION, items: [] },
    ]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(mocks.jsonReply).not.toHaveBeenCalled();
  });

  it('returns the reply', async () => {
    mocks.jsonReply.mockResolvedValue({ value: { questions: ['One?'] }, usage: {} });
    const reply = await POST(post({ kind: 'mock-questions', session: SESSION, count: 1 }));
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ questions: ['One?'] });
  });

  it('logs the kind and token counts, no words', async () => {
    const logs: unknown[][] = [];
    for (const method of ['info', 'error', 'log', 'warn'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logs.push(args));
    }
    const body = {
      kind: 'mock-feedback',
      session: SESSION,
      question: 'SECRETQUESTION',
      answer: 'SECRETANSWER',
    };
    mocks.jsonReply.mockResolvedValue({ value: { feedback: 'SECRETFEEDBACK' }, usage: {} });
    await POST(post(body));
    mocks.jsonReply.mockRejectedValue(new Error('SECRETANSWER failed'));
    await POST(post(body));
    const text = JSON.stringify(logs);
    expect(text).toContain('mock-feedback');
    expect(text).not.toContain('SECRET');
  });
});
