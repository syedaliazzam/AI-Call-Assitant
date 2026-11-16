/**
 * Tests for apps/web/src/server/aiTry.ts (ADR-0083), with the Anthropic SDK mocked:
 * - handleTry(): 401 signed out or temporary password, 403 for a non-admin (nothing counted or run),
 *   400 for a bad body or a draft over 4,000 characters, 429 over the daily limit (Claude never
 *   called), 200 with the reply, and Claude failures as 503/502; logs never hold the draft, sample or
 *   reply;
 * - runTry(): the DRAFT goes after the locked rules (live answers, notes, Ask AI), the hidden lines are
 *   removed from the answer, the sample call is read for the notes;
 * - parseSampleCall(), lockedRulesFor(), and the budget check (budgetFacts() with answerBudgetUse()).
 * - ADR-0086: a draft full prompt missing the output format is refused (400, what is missing, nothing
 *   counted); a tried prompt comes back with its token; a draft prompt replaces the built-in rules
 *   (live core and reminder, notes, Ask AI); the built-in prompts pass the check and carry the fixed
 *   wording (Paramount AI; cloud speech recognition with an on-device fallback).
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  answerBudgetUse,
  checkCustomPrompt,
  MAX_AI_INSTRUCTIONS_CHARS,
  type AiTryRequest,
  type CustomPrompt,
} from '@kite/shared';
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

const { budgetFacts, handleTry, lockedRulesFor, parseSampleCall, runTry } =
  await import('@/server/aiTry');
const { CALL_REMINDER, CORE_RULES } = await import('@/server/prompt');
const { NOTES_RULES } = await import('@/server/notes');
const { KITE_CHAT_RULES } = await import('@/server/kite-chat');

/** The models a try uses (invented names are fine: the SDK is mocked). */
const MODELS = { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' };

/** An admin who has changed their password. */
const ADMIN = { id: 'admin-1', role: 'admin', mustChangePassword: false };

/** A valid try. */
const TRY: AiTryRequest = {
  block: 'live',
  draft: 'DRAFT-SECRET: say customers.',
  sample: 'SAMPLE-SECRET: what does it cost?',
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
      response: { kind: 'answer' as const, text: 'REPLY-SECRET', meta: null },
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      model: MODELS.fast,
    })),
    tokenFor: vi.fn(() => 'TOKEN-1'),
    ...overrides,
  };
}

/** An invented live prompt that keeps every rule the app needs (ADR-0086). */
const LIVE_PROMPT: CustomPrompt = {
  core: [
    'PROMPT-SECRET custom rules. Every reply starts with [[type|for|source]].',
    'Every reply ends with [[question|the question you answered]].',
    '- garbled: write only the two hidden lines.',
    '- none: write only the two hidden lines.',
  ].join('\n'),
  reminder: 'CUSTOM-REMINDER.',
  screenshot: 'A screenshot reply starts with [[type|for|source]].',
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
    const long = { ...TRY, draft: 'x'.repeat(MAX_AI_INSTRUCTIONS_CHARS + 1) };
    expect((await handleTry(ADMIN, JSON.stringify(long), d, signal)).status).toBe(400);
    const noSample = { ...TRY, sample: '   ' };
    expect((await handleTry(ADMIN, JSON.stringify(noSample), d, signal)).status).toBe(400);
    const unknown = { ...TRY, block: 'other' };
    expect((await handleTry(ADMIN, JSON.stringify(unknown), d, signal)).status).toBe(400);
    expect(d.run).not.toHaveBeenCalled();
  });

  it('counts as a normal request: over the daily limit it is 429 and Claude is never called', async () => {
    const d = deps({ count: vi.fn(async () => ({ allowed: false, limit: 5 })) });
    const response = await handleTry(ADMIN, JSON.stringify(TRY), d, signal);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'daily_limit' });
    expect(d.run).not.toHaveBeenCalled();
  });

  it('returns the reply, counts once, and logs no draft, sample, reply or id', async () => {
    const d = deps();
    const response = await handleTry(ADMIN, JSON.stringify(TRY), d, signal);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ kind: 'answer', text: 'REPLY-SECRET', meta: null });
    expect(d.count).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('ai try: done');
    expect(logs).not.toMatch(/SECRET|admin-1/);
  });

  it('turns a Claude failure into a status with a safe message', async () => {
    const overloaded = new Anthropic.APIError(
      529,
      { error: { type: 'overloaded_error', message: 'detail' } },
      'detail',
      new Headers(),
    );
    const d = deps({ run: vi.fn(async () => Promise.reject(overloaded)) });
    const response = await handleTry(ADMIN, JSON.stringify(TRY), d, signal);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('detail');
  });

  it('ADR-0086: refuses a draft prompt missing the output format with what is missing, spending nothing', async () => {
    const d = deps();
    const broken = { ...TRY, prompt: { ...LIVE_PROMPT, screenshot: 'Describe the screen.' } };
    const response = await handleTry(ADMIN, JSON.stringify(broken), d, signal);
    expect(response.status).toBe(400);
    const { message } = (await response.json()) as { message: string };
    expect(message).toBe(
      'Added for a screenshot: The hidden first line is missing: keep the rule that a screenshot reply starts with the line [[type|for|source]], with the kind of screen as the type.',
    );
    expect(d.count).not.toHaveBeenCalled();
    expect(d.run).not.toHaveBeenCalled();
    // An unknown part name is refused too.
    const extra = { ...TRY, prompt: { ...LIVE_PROMPT, other: 'x' } };
    expect((await handleTry(ADMIN, JSON.stringify(extra), d, signal)).status).toBe(400);
  });

  it('ADR-0086: a tried prompt comes back with its token; a try with no prompt gets none', async () => {
    const d = deps();
    const response = await handleTry(
      ADMIN,
      JSON.stringify({ ...TRY, prompt: LIVE_PROMPT }),
      d,
      signal,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'answer', promptToken: 'TOKEN-1' });
    expect(d.tokenFor).toHaveBeenCalledWith('live', LIVE_PROMPT);
    expect(d.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: LIVE_PROMPT }),
      MODELS,
      signal,
    );
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).not.toMatch(/SECRET|TOKEN-1/);
    const plain = await handleTry(ADMIN, JSON.stringify(TRY), deps(), signal);
    expect(await plain.json()).not.toHaveProperty('promptToken');
  });
});

describe('runTry', () => {
  it('live answers: the draft follows the locked rules, and the hidden lines are removed', async () => {
    streamMock.mockReturnValue(
      fakeMessageStream({
        pieces: [
          '[[sales|call|general]]\n',
          'It is priced per seat.',
          '\n[[question|What does it cost?]]',
        ],
      }),
    );
    const result = await runTry(TRY, MODELS);
    expect(result.response).toEqual({
      kind: 'answer',
      text: 'It is priced per seat.',
      meta: { type: 'sales', target: 'call', source: 'general' },
    });
    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe(MODELS.fast);
    const rules: string = params.system[0].text;
    expect(rules.startsWith(CORE_RULES)).toBe(true);
    expect(rules).toContain('DRAFT-SECRET: say customers.');
  });

  it('notes: reads the sample call and puts the draft after the notes rules', async () => {
    createMock.mockResolvedValue({
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
    });
    const result = await runTry(
      { block: 'notes', draft: 'Use British spelling.', sample: 'Them: Price?\nYou: Per seat.' },
      MODELS,
    );
    expect(result.response.kind).toBe('notes');
    const [params] = createMock.mock.calls[0]!;
    expect(params.model).toBe(MODELS.smart);
    expect(params.system[0].text.startsWith(NOTES_RULES)).toBe(true);
    expect(params.system[0].text).toContain('Use British spelling.');
    expect(params.messages[0].content).toContain('Them: Price?');
    expect(params.messages[0].content).toContain('You: Per seat.');
  });

  it('Ask AI: the Ask AI page prompt with the draft, and the session attached when picked', async () => {
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|kite|general]] Four.'] }));
    await runTry(
      {
        block: 'ask',
        draft: 'Answer briefly.',
        sample: 'What is 2 + 2?',
        session: {
          type: 'regular',
          company: 'Northwind (invented)',
          role: '',
          description: '',
          instructions: '',
          keyTerms: [],
          style: { format: 'paragraph', length: 'short', tone: 'simple' },
          documents: [],
        },
      },
      MODELS,
    );
    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe(MODELS.smart);
    expect(params.system[0].text.startsWith(KITE_CHAT_RULES)).toBe(true);
    expect(params.system[0].text).toContain('Answer briefly.');
    expect(params.system[1].text).toContain('Northwind (invented)');
  });

  it('ADR-0086: a draft live prompt replaces the core rules and the reminder, with the draft instructions after it', async () => {
    streamMock.mockReturnValue(
      fakeMessageStream({ pieces: ['[[sales|call|general]]\nPer seat.'] }),
    );
    await runTry({ ...TRY, prompt: LIVE_PROMPT }, MODELS);
    const [params] = streamMock.mock.calls[0]!;
    const rules: string = params.system[0].text;
    expect(rules.startsWith(LIVE_PROMPT.core!)).toBe(true);
    expect(rules).not.toContain(CORE_RULES.slice(0, 60));
    expect(rules).toContain('DRAFT-SECRET: say customers.');
    const tail: string = params.messages[0].content.at(-1).text;
    expect(tail).toContain('CUSTOM-REMINDER.');
    expect(tail).not.toContain(CALL_REMINDER);
  });

  it('ADR-0086: draft notes and Ask AI prompts replace their rules', async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: [],
            questions: [],
            nextSteps: [],
            unclear: [],
            lessons: [],
          }),
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await runTry(
      { block: 'notes', draft: '', sample: 'Them: Hi', prompt: { rules: 'CUSTOM NOTES RULES' } },
      MODELS,
    );
    expect(createMock.mock.calls[0]![0].system[0].text).toBe('CUSTOM NOTES RULES');
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|kite|general]] Four.'] }));
    await runTry(
      {
        block: 'ask',
        draft: '',
        sample: 'What is 2 + 2?',
        prompt: { chat: 'CUSTOM CHAT [[type|kite|source]]', review: 'CUSTOM REVIEW' },
      },
      MODELS,
    );
    expect(streamMock.mock.calls[0]![0].system[0].text).toBe('CUSTOM CHAT [[type|kite|source]]');
  });
});

describe('parseSampleCall', () => {
  it('reads one turn per line, carrying the speaker on, with times 20 s apart', () => {
    expect(parseSampleCall('Them: Hello\n\nyou : Hi there\nand more\n  ')).toEqual([
      { speaker: 'them', text: 'Hello', at: 0 },
      { speaker: 'you', text: 'Hi there', at: 20 },
      { speaker: 'you', text: 'and more', at: 40 },
    ]);
    expect(parseSampleCall('No speaker given')).toEqual([
      { speaker: 'them', text: 'No speaker given', at: 0 },
    ]);
  });
});

describe('locked rules and the budget check', () => {
  it('shows each block its locked rules, the live answers core first', () => {
    expect(lockedRulesFor('live')[0]!.text).toBe(CORE_RULES);
    expect(lockedRulesFor('notes')[0]!.text).toBe(NOTES_RULES);
    expect(lockedRulesFor('ask')[0]!.text).toBe(KITE_CHAT_RULES);
    // ADR-0086: each part carries its key, in prompt order.
    expect(lockedRulesFor('live').map((part) => part.key)).toEqual([
      'core',
      'reminder',
      'screenshot',
    ]);
    expect(lockedRulesFor('ask').map((part) => part.key)).toEqual(['chat', 'review']);
  });

  it('ADR-0086: the built-in prompts pass the format check, and say Paramount AI and cloud speech recognition', () => {
    for (const block of ['live', 'notes', 'ask'] as const) {
      const prompt = Object.fromEntries(lockedRulesFor(block).map((part) => [part.key, part.text]));
      expect(checkCustomPrompt(block, prompt)).toEqual([]);
    }
    expect(CORE_RULES.startsWith('You are Paramount AI, a live call assistant.')).toBe(true);
    expect(NOTES_RULES.startsWith('You are Paramount AI.')).toBe(true);
    expect(CORE_RULES).toContain('cloud speech recognition (Deepgram)');
    expect(CORE_RULES).toContain("speech recognition on the user's device as a fallback");
    expect(CORE_RULES).not.toContain("on the user's computer");
    expect(CORE_RULES).not.toContain('You are Kite');
  });

  it('ADR-0086: a longer custom prompt counts against the budget', () => {
    const facts = budgetFacts();
    const longer = answerBudgetUse({ ...facts, chars: 0, extraChars: 3_000 });
    expect(longer.largestTokens).toBe(facts.baseTokens + Math.ceil(3_000 / facts.charsPerToken));
  });

  it('counts what a full block adds, and warns only near the budget', () => {
    const facts = budgetFacts();
    const empty = answerBudgetUse({ ...facts, chars: 0 });
    expect(empty.blockTokens).toBe(0);
    const full = answerBudgetUse({ ...facts, chars: MAX_AI_INSTRUCTIONS_CHARS });
    expect(full.blockTokens).toBe(
      Math.ceil((MAX_AI_INSTRUCTIONS_CHARS + facts.overheadChars) / facts.charsPerToken),
    );
    expect(full.largestTokens).toBe(facts.baseTokens + full.blockTokens);
    // With today's limits a full block keeps the largest request below the warning line.
    expect(full.near).toBe(false);
    // The warning fires at 90 % of the budget.
    const tight = answerBudgetUse({
      ...facts,
      baseTokens: Math.ceil(facts.budgetTokens * 0.9),
      chars: 100,
    });
    expect(tight.near).toBe(true);
  });
});
