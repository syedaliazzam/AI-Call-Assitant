/**
 * Tests for apps/web/src/server/aiTry.ts (ADR-0083, ADR-0089), with the Anthropic SDK mocked:
 * - handleTry(): 401 signed out or temporary password, 403 for a non-admin (nothing counted or run),
 *   400 for a bad body or a draft over 30,000 characters, 429 over the daily limit (Claude never
 *   called), 200 with the reply and the save token for this exact draft, and Claude failures as
 *   503/502; logs never hold the draft, sample or reply;
 * - runTry(): the DRAFT global prompt goes after the locked contract (live answers, notes, Ask AI), the
 *   hidden lines are removed from the answer and the cleaned question comes back, the sample call is
 *   read for the notes; an empty draft sends the contract alone;
 * - parseSampleCall() and the budget check (budgetFacts() with answerBudgetUse()).
 */
import Anthropic from '@anthropic-ai/sdk';
import { answerBudgetUse, MAX_GLOBAL_PROMPT_CHARS, type AiTryRequest } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TryDeps } from '@/server/aiTry';
import { fakeMessageStream } from '../../helpers/fakeClaude';

/** Spy standing in for client.messages.stream(). */
const streamMock = vi.fn();
/** Spy standing in for client.messages.create() (the notes). */
const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Subclass the real client so its static error classes stay real for instanceof.
  class FakeAnthropic extends actual.default {
    override messages = {
      stream: streamMock,
      create: createMock,
    } as unknown as Anthropic['messages'];
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});
vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');

const { budgetFacts, handleTry, parseSampleCall, runTry } = await import('@/server/aiTry');
const { ASK_CHAT_CONTRACT, GLOBAL_HEADING, LIVE_CONTRACT, NOTES_CONTRACT } =
  await import('@/server/prompts/contract');

/** The models a try uses (invented names are fine: the SDK is mocked). */
const MODELS = { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' };

/** An admin who has changed their password. */
const ADMIN = { id: 'admin-1', role: 'admin', mustChangePassword: false };

/** A valid try. */
const TRY: AiTryRequest = {
  block: 'live',
  prompt: 'DRAFT-SECRET: say customers.',
  sample: 'SAMPLE-SECRET: what does it cost?',
};

/** Token counts for fake replies. */
const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/**
 * Fake dependencies for handleTry().
 *
 * @param overrides Parts to replace.
 * @returns The deps, with spies.
 */
function deps(overrides: Partial<TryDeps> = {}): TryDeps {
  return {
    models: () => MODELS,
    count: vi.fn(async () => ({ allowed: true, limit: 300 })),
    run: vi.fn(async () => ({
      response: {
        kind: 'answer' as const,
        text: 'REPLY-SECRET',
        meta: null,
        question: null,
        promptToken: '',
      },
      usage: USAGE,
      model: MODELS.fast,
    })),
    tokenFor: vi.fn(() => 'TOKEN-1'),
    ...overrides,
  };
}

/** A notes reply from the fake SDK. */
const NOTES_REPLY = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        summary: ['Pricing was discussed.'],
        questions: [],
        nextSteps: [],
        unclear: [],
        lessons: [],
      }),
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1 },
};

beforeEach(() => {
  streamMock.mockReset();
  createMock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('handleTry', () => {
  const signal = new AbortController().signal;

  it('refuses anyone signed out or with a temporary password', async () => {
    expect((await handleTry(null, JSON.stringify(TRY), deps(), signal)).status).toBe(401);
    const temporary = { ...ADMIN, mustChangePassword: true };
    expect((await handleTry(temporary, JSON.stringify(TRY), deps(), signal)).status).toBe(401);
  });

  it('refuses a non-admin with 403, before counting or running anything', async () => {
    const d = deps();
    for (const role of ['user', null, undefined]) {
      const user = { id: 'u1', role, mustChangePassword: false };
      expect((await handleTry(user, JSON.stringify(TRY), d, signal)).status).toBe(403);
    }
    expect(d.count).not.toHaveBeenCalled();
    expect(d.run).not.toHaveBeenCalled();
  });

  it('refuses a bad body and a draft over the limit', async () => {
    const d = deps();
    expect((await handleTry(ADMIN, 'not json', d, signal)).status).toBe(400);
    const long = { ...TRY, prompt: 'x'.repeat(MAX_GLOBAL_PROMPT_CHARS + 1) };
    expect((await handleTry(ADMIN, JSON.stringify(long), d, signal)).status).toBe(400);
    const noSample = { ...TRY, sample: '   ' };
    expect((await handleTry(ADMIN, JSON.stringify(noSample), d, signal)).status).toBe(400);
    const unknown = { ...TRY, block: 'other' };
    expect((await handleTry(ADMIN, JSON.stringify(unknown), d, signal)).status).toBe(400);
    const oldShape = { block: 'live', draft: 'x', sample: 'y' };
    expect((await handleTry(ADMIN, JSON.stringify(oldShape), d, signal)).status).toBe(400);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('answers 429 over the daily limit without running', async () => {
    const d = deps({ count: vi.fn(async () => ({ allowed: false, limit: 300 })) });
    expect((await handleTry(ADMIN, JSON.stringify(TRY), d, signal)).status).toBe(429);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('returns the reply with the token for this exact draft, and logs sizes only', async () => {
    const d = deps();
    const response = await handleTry(ADMIN, JSON.stringify(TRY), d, signal);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { promptToken: string; text: string };
    expect(body).toMatchObject({ kind: 'answer', text: 'REPLY-SECRET', promptToken: 'TOKEN-1' });
    expect(d.tokenFor).toHaveBeenCalledWith('live', TRY.prompt);
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('"promptChars":28');
    for (const secret of ['DRAFT-SECRET', 'SAMPLE-SECRET', 'REPLY-SECRET', 'TOKEN-1', 'admin-1']) {
      expect(logs).not.toContain(secret);
    }
  });

  it('turns a Claude failure into 502 or 503 with no text in the logs', async () => {
    const overloaded = new Anthropic.APIError(
      529,
      { type: 'overloaded_error' },
      'Overloaded',
      new Headers(),
    );
    const d = deps({ run: vi.fn(async () => Promise.reject(overloaded)) });
    const response = await handleTry(ADMIN, JSON.stringify(TRY), d, signal);
    expect([502, 503]).toContain(response.status);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('DRAFT-SECRET');
  });
});

describe('runTry', () => {
  it('live: the draft after the contract, hidden lines removed, the cleaned question returned', async () => {
    streamMock.mockReturnValue(
      fakeMessageStream({
        pieces: ['[[sales|call|docs]]\nPer seat.\n[[question|What does it cost?]]'],
      }),
    );
    const result = await runTry(TRY, MODELS);
    expect(result.response).toMatchObject({
      kind: 'answer',
      text: 'Per seat.',
      meta: { type: 'sales', target: 'call', source: 'docs' },
      question: 'What does it cost?',
    });
    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe(MODELS.fast);
    expect(params.system[0].text).toBe(
      `${LIVE_CONTRACT}\n\n${GLOBAL_HEADING}\nDRAFT-SECRET: say customers.`,
    );
  });

  it('live: an empty draft sends the contract alone', async () => {
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[sales|call|docs]]\nHi.'] }));
    await runTry({ ...TRY, prompt: '  ' }, MODELS);
    expect(streamMock.mock.calls[0]![0].system[0].text).toBe(LIVE_CONTRACT);
  });

  it('notes: reads the sample call and puts the draft after the notes contract', async () => {
    createMock.mockResolvedValue(NOTES_REPLY);
    const result = await runTry(
      { block: 'notes', prompt: 'Use British spelling.', sample: 'Them: Price?\nYou: Per seat.' },
      MODELS,
    );
    expect(result.response.kind).toBe('notes');
    const [params] = createMock.mock.calls[0]!;
    expect(params.model).toBe(MODELS.smart);
    expect(params.system[0].text).toBe(
      `${NOTES_CONTRACT}\n\n${GLOBAL_HEADING}\nUse British spelling.`,
    );
    expect(params.messages[0].content).toContain('Them: Price?');
    expect(params.messages[0].content).toContain('You: Per seat.');
  });

  it('Ask AI: the draft after the Ask AI page contract, on the smart model', async () => {
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|kite|general]] Four.'] }));
    const result = await runTry({ block: 'ask', prompt: 'Be warm.', sample: '2 + 2?' }, MODELS);
    expect(result.response).toMatchObject({ kind: 'answer', text: 'Four.' });
    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe(MODELS.smart);
    expect(params.system[0].text).toBe(`${ASK_CHAT_CONTRACT}\n\n${GLOBAL_HEADING}\nBe warm.`);
  });
});

describe('parseSampleCall', () => {
  it('reads speakers, carries a speaker over, and spaces the lines 20 s apart', () => {
    expect(parseSampleCall('Them: Price?\nper seat?\nyou: Per seat.\n\n')).toEqual([
      { speaker: 'them', text: 'Price?', at: 0 },
      { speaker: 'them', text: 'per seat?', at: 20 },
      { speaker: 'you', text: 'Per seat.', at: 40 },
    ]);
  });
});

describe('the budget check', () => {
  it('counts the global prompt with its heading, and warns only near the budget', () => {
    const facts = budgetFacts();
    expect(facts.baseTokens).toBeGreaterThan(0);
    expect(facts.baseTokens).toBeLessThan(facts.budgetTokens);
    const small = answerBudgetUse({ ...facts, chars: 15_000 + facts.headingChars });
    expect(small.near).toBe(false);
    const huge = answerBudgetUse({ ...facts, chars: facts.budgetTokens * facts.charsPerToken });
    expect(huge.near).toBe(true);
  });
});
