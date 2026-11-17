/**
 * Tests apps/web/app/api/answer/route.ts with Google's Gemini and OpenAI as answer models (ADR-0099), with
 * sign-in, the Anthropic SDK and both providers' streams mocked: a Gemini or GPT session's answer streams from
 * that provider with the same prompt Claude gets, with the model id from the environment, and its done event
 * names the model; it is counted as that provider's request; a screenshot goes to the provider with its image;
 * OpenAI gets the call's id as the cache key; a failure before any text is answered by Claude Haiku and
 * recorded; a warm-up warms the provider and Claude Haiku together; an account outside the rollout, or a
 * provider turned off, answers with Claude Haiku; Ask AI keeps its Claude model; the call id is validated.
 * Logs carry ids, the reason and the model only, never text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplyResult } from '@/server/claude';
import { fakeMessageStream } from '../../helpers/fakeClaude';

/** Spy standing in for countRequest(): allows every request. */
const countRequestMock = vi.hoisted(() =>
  vi.fn(async (_userId: string, _now?: Date, _options?: { provider?: string }) => ({
    allowed: true,
    count: 1,
    limit: 300,
    ms: 0,
  })),
);
vi.mock('@/server/usage', () => ({ countRequest: countRequestMock }));

/** The providers' switches, and the accounts in the rollout (as the real getProviderEnabled() combines them). */
const access = vi.hoisted(() => ({
  gemini: true,
  openai: true,
  rollout: new Set(['u1']),
}));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/modelAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/modelAccess')>()),
  getDeepModelEnabled: async () => true,
  getGroqEnabled: async () => true,
  getProviderEnabled: async (provider: 'gemini' | 'openai', userId: string) =>
    access.rollout.has(userId) && access[provider],
}));

/** The default global prompt for every block. */
vi.mock('@/server/aiInstructions', async () => {
  const { DEFAULT_PROMPTS } = await import('@/server/prompts/defaults');
  return {
    companySettings: async (block: 'live' | 'notes' | 'ask') => ({
      globalPrompt: DEFAULT_PROMPTS[block],
      isDefault: true,
    }),
  };
});

/** Spies standing in for the two providers (the real withFirstTokenFallback() is kept). */
const geminiMock = vi.hoisted(() => vi.fn());
const geminiWarmMock = vi.hoisted(() => vi.fn());
const openaiMock = vi.hoisted(() => vi.fn());
const openaiWarmMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/gemini')>()),
  streamGeminiReply: geminiMock,
  warmGemini: geminiWarmMock,
}));
vi.mock('@/server/openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/openai')>()),
  streamOpenAIReply: openaiMock,
  warmOpenAI: openaiWarmMock,
}));

/** Spies standing in for the Claude SDK. */
const streamMock = vi.fn();
const createMock = vi.fn();
const getSessionMock = vi.fn();
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends actual.default {
    override messages = { stream: streamMock, create: createMock } as never;
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});
vi.mock('@/server/auth', () => ({
  getCachedSession: async () => ({ session: await getSessionMock(), setCookies: [] }),
}));

vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');
vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
vi.stubEnv('KITE_MODEL_GEMINI_LITE', 'gemini-lite-from-env');

const { POST } = await import('../../../app/api/answer/route');
const { ProviderError } = await import('@/server/providerStream');

/** A signed-in user (in the rollout). */
const SIGNED_IN = { user: { id: 'u1', role: 'user', mustChangePassword: false } };

/** An invented session. */
const SESSION = {
  type: 'regular',
  company: 'Northwind Logistics',
  role: 'Account review',
  description: 'SECRET-DESCRIPTION-TEXT',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [],
};

/** A tiny "JPEG" data URL (its bytes start as a JPEG). */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAADSECRETPIXELS';

/**
 * A POST /api/answer request.
 *
 * @param body The JSON body.
 * @returns The request.
 */
function post(body: unknown) {
  return new Request('http://localhost:3000/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The usage every fake reply returns. */
const USAGE = {
  input_tokens: 10,
  output_tokens: 3,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/**
 * A fake provider reply.
 *
 * @param pieces Its text pieces.
 * @returns The generator.
 */
async function* reply(...pieces: string[]): AsyncGenerator<string, ReplyResult, undefined> {
  for (const piece of pieces) yield piece;
  return { usage: USAGE, stopReason: 'end_turn' };
}

/**
 * The chat question a session with this model asks.
 *
 * @param model The session's model.
 * @returns The request body.
 */
function chat(model: string) {
  return { mode: 'chat', model, session: SESSION, question: 'SECRET-QUESTION', callId: 'call-123' };
}

beforeEach(() => {
  access.gemini = true;
  access.openai = true;
  access.rollout = new Set(['u1']);
  for (const mock of [
    geminiMock,
    geminiWarmMock,
    openaiMock,
    openaiWarmMock,
    streamMock,
    createMock,
  ]) {
    mock.mockReset();
  }
  countRequestMock.mockClear();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/answer with Gemini and OpenAI (ADR-0099)', () => {
  it("streams a Gemini session's question from Gemini, with Claude's prompt, and names the model", async () => {
    geminiMock.mockImplementation(() => reply('[[call|general]]', 'Gemini says hi.'));
    const text = await (await POST(post(chat('gemini-lite')))).text();
    expect(text).toContain('event: delta\ndata: {"text":"Gemini says hi."}');
    expect(text).toMatch(/event: done\ndata: \{[^\n]*"model":"gemini-lite"/);
    expect(streamMock).not.toHaveBeenCalled();
    const [input] = geminiMock.mock.calls[0]!;
    // The model id comes from the environment (KITE_MODEL_GEMINI_LITE).
    expect(input.model).toBe('gemini-lite-from-env');
    expect(input.apiKey).toBe('test-gemini-key');
    const systemText = input.system.map((block: { text: string }) => block.text).join(' ');
    expect(systemText).toContain('Company: Northwind Logistics');
    expect(input.messages[0].content.at(-1).text).toContain('Question typed by the user');
    expect(countRequestMock).toHaveBeenLastCalledWith('u1', undefined, { provider: 'gemini' });
  });

  it('uses the default model ids when their variables are not set, and Gemini 3.6 Flash for gemini-flash', async () => {
    geminiMock.mockImplementation(() => reply('x'));
    openaiMock.mockImplementation(() => reply('x'));
    await (await POST(post(chat('gemini-flash')))).text();
    await (await POST(post(chat('gpt-luna')))).text();
    await (await POST(post(chat('gpt-terra')))).text();
    expect(geminiMock.mock.calls[0]![0].model).toBe('gemini-3.6-flash');
    expect(openaiMock.mock.calls[0]![0].model).toBe('gpt-5.6-luna');
    expect(openaiMock.mock.calls[1]![0].model).toBe('gpt-5.6-terra');
  });

  it("sends OpenAI the call's id as its cache key, and counts the request as OpenAI's", async () => {
    openaiMock.mockImplementation(() => reply('[[call|general]]', 'GPT says hi.'));
    const text = await (await POST(post(chat('gpt-luna')))).text();
    expect(text).toMatch(/"model":"gpt-luna"/);
    expect(openaiMock.mock.calls[0]![0].cacheKey).toBe('call-123');
    expect(countRequestMock).toHaveBeenLastCalledWith('u1', undefined, { provider: 'openai' });
  });

  it('sends a screenshot to the provider, with the image', async () => {
    geminiMock.mockImplementation(() => reply('[[call|general]]', 'I see it.'));
    const text = await (
      await POST(post({ mode: 'screenshot', model: 'gemini-lite', session: SESSION, image: JPEG }))
    ).text();
    expect(streamMock).not.toHaveBeenCalled();
    expect(text).toMatch(/"model":"gemini-lite"/);
    const content = geminiMock.mock.calls[0]![0].messages[0].content as { type: string }[];
    expect(content.some((block) => block.type === 'image')).toBe(true);
  });

  it('answers with Claude Haiku when the provider fails before any text, and records it', async () => {
    openaiMock.mockImplementation(async function* () {
      throw new ProviderError('openai', 'http', 500);
    });
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Claude answers.'] }));
    const text = await (await POST(post(chat('gpt-luna')))).text();
    expect(text).toContain('Claude answers.');
    expect(text).toMatch(/event: done\ndata: \{[^\n]*"model":"fast","fallback":"error"/);
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
    const warned = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(warned).toContain('openai fallback to haiku');
    expect(warned).toContain('500');
    expect(warned).not.toContain('SECRET');
  });

  it('answers with Claude Haiku when the provider sends no first token within 4 s', async () => {
    vi.useFakeTimers();
    try {
      geminiMock.mockImplementation(async function* (input: { signal: AbortSignal }) {
        await new Promise((_resolve, reject) =>
          input.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
        yield 'never';
        return { usage: USAGE, stopReason: 'end_turn' };
      });
      streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Claude answers.'] }));
      const response = POST(post(chat('gemini-lite')));
      await vi.advanceTimersByTimeAsync(4_100);
      const text = await (await response).text();
      expect(text).toMatch(/"model":"fast","fallback":"timeout"/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('warms the provider and Claude Haiku together, with the cache key', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    openaiWarmMock.mockResolvedValue({
      usage: { ...USAGE, input_tokens: 4000 },
      stopReason: 'max_tokens',
    });
    const text = await (
      await POST(post({ mode: 'warm', model: 'gpt-luna', session: SESSION, callId: 'call-123' }))
    ).text();
    expect(createMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
    expect(openaiWarmMock.mock.calls[0]![0]).toMatchObject({
      model: 'gpt-5.6-luna',
      cacheKey: 'call-123',
      maxTokens: 1,
    });
    // The session's model's usage, and its name.
    expect(text).toMatch(/event: done\ndata: \{[^\n]*"input_tokens":4000/);
    expect(text).toMatch(/"model":"gpt-luna"/);
    // A warm-up is never counted.
    expect(countRequestMock).not.toHaveBeenCalled();
  });

  it("still finishes a warm-up with Claude's usage when the provider's warm-up fails", async () => {
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 7, output_tokens: 0 },
    });
    geminiWarmMock.mockRejectedValue(new ProviderError('gemini', 'http', 503));
    const text = await (
      await POST(post({ mode: 'warm', model: 'gemini-lite', session: SESSION }))
    ).text();
    expect(text).toMatch(/event: done/);
    expect(text).toMatch(/"input_tokens":7/);
  });

  it('answers with Claude Haiku for an account outside the rollout', async () => {
    access.rollout = new Set(['someone-else']);
    streamMock.mockReturnValue(fakeMessageStream());
    const text = await (await POST(post(chat('gemini-lite')))).text();
    expect(geminiMock).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
    expect(text).toMatch(/"model":"fast"/);
    expect(countRequestMock).toHaveBeenLastCalledWith('u1', undefined, { provider: undefined });
  });

  it('answers with Claude Haiku while the provider is turned off', async () => {
    access.openai = false;
    streamMock.mockReturnValue(fakeMessageStream());
    await (await POST(post(chat('gpt-terra')))).text();
    expect(openaiMock).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
  });

  it('keeps Ask AI on its Claude model', async () => {
    streamMock.mockReturnValue(fakeMessageStream());
    await (await POST(post({ mode: 'kite', model: 'gemini-lite', question: 'Hello?' }))).text();
    expect(geminiMock).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-sonnet-5-5');
  });

  it('rejects a call id with anything but id characters', async () => {
    const response = await POST(post({ ...chat('gpt-luna'), callId: 'bad id; drop' }));
    expect(response.status).toBe(400);
    expect(openaiMock).not.toHaveBeenCalled();
  });
});
