/**
 * Tests apps/web/app/api/answer/route.ts with Groq as the answer model (ADR-0095), with sign-in, the Anthropic
 * SDK and Groq's stream mocked: a Groq session's text answer streams from Groq with the same prompt Claude
 * gets and its done event says 'groq'; it is counted as a Groq request; a Groq failure before any text is
 * answered by Claude Haiku and recorded ('fallback'); a screenshot, a warm-up and Ask AI never go to Groq;
 * with Groq off (no key or the admin's switch), the answer is Claude Haiku's; the allow-list rejects any
 * other model. Logs carry ids, the reason and the model only, never text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplyResult } from '@/server/claude';
import { fakeMessageStream } from '../../helpers/fakeClaude';

/** Spy standing in for countRequest(): allows every request. */
const countRequestMock = vi.hoisted(() =>
  vi.fn(async (_userId: string, _now?: Date, _options?: { groq?: boolean }) => ({
    allowed: true,
    count: 1,
    limit: 300,
    ms: 0,
  })),
);
vi.mock('@/server/usage', () => ({ countRequest: countRequestMock }));

/** Spies standing in for the two admin switches. */
const switches = vi.hoisted(() => ({ deep: true, groq: true }));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/modelAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/modelAccess')>()),
  getDeepModelEnabled: async () => switches.deep,
  getGroqEnabled: async () => switches.groq,
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

/**
 * Spy standing in for streamGroqReply(): what Groq streams (the real withFirstTokenFallback() is kept).
 */
const groqMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/groq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/groq')>()),
  streamGroqReply: groqMock,
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
vi.stubEnv('GROQ_API_KEY', 'test-groq-key');

const { POST } = await import('../../../app/api/answer/route');
const { GroqError } = await import('@/server/groq');

/** A signed-in user. */
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

/**
 * A fake Groq reply.
 *
 * @param pieces Its text pieces.
 * @returns The generator.
 */
async function* groqReply(...pieces: string[]): AsyncGenerator<string, ReplyResult, undefined> {
  for (const piece of pieces) yield piece;
  return {
    usage: {
      input_tokens: 10,
      output_tokens: 3,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    stopReason: 'end_turn',
  };
}

/** The chat question a Groq session asks. */
const CHAT = { mode: 'chat', model: 'groq', session: SESSION, question: 'SECRET-QUESTION' };

beforeEach(() => {
  switches.deep = true;
  switches.groq = true;
  groqMock.mockReset();
  streamMock.mockReset();
  createMock.mockReset();
  countRequestMock.mockClear();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/answer with Groq (ADR-0095)', () => {
  it("streams a Groq session's question from Groq, with Claude's prompt, and says 'groq'", async () => {
    groqMock.mockImplementation(() => groqReply('[[call|general]]', 'Groq says hi.'));
    const text = await (await POST(post(CHAT))).text();
    expect(text).toContain('event: delta\ndata: {"text":"Groq says hi."}');
    expect(text).toMatch(/event: done\ndata: \{[^\n]*"model":"groq"/);
    expect(text).not.toContain('"fallback"');
    expect(streamMock).not.toHaveBeenCalled();
    const [input] = groqMock.mock.calls[0]!;
    expect(input.model).toBe('openai/gpt-oss-120b');
    expect(input.apiKey).toBe('test-groq-key');
    // The same system blocks and messages Claude would get (the locked contract first).
    const systemText = input.system.map((block: { text: string }) => block.text).join(' ');
    expect(systemText).toContain('Company: Northwind Logistics');
    expect(input.messages[0].content.at(-1).text).toContain('Question typed by the user');
    expect(countRequestMock).toHaveBeenLastCalledWith('u1', undefined, { groq: true });
  });

  it('answers with Claude Haiku when Groq fails before any text, and records it', async () => {
    groqMock.mockImplementation(async function* () {
      throw new GroqError('http', 503);
    });
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Claude answers.'] }));
    const text = await (await POST(post(CHAT))).text();
    expect(text).toContain('Claude answers.');
    expect(text).toMatch(/event: done\ndata: \{[^\n]*"model":"fast","fallback":"error"/);
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
    const warned = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(warned).toContain('groq fallback');
    expect(warned).toContain('503');
    expect(warned).not.toContain('SECRET');
  });

  it('keeps a screenshot, and any image, on Claude Haiku', async () => {
    streamMock.mockReturnValue(fakeMessageStream());
    const text = await (
      await POST(post({ mode: 'screenshot', model: 'groq', session: SESSION, image: JPEG }))
    ).text();
    expect(groqMock).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
    expect(text).toMatch(/"model":"fast"/);
    expect(countRequestMock).toHaveBeenLastCalledWith('u1', undefined, { groq: false });
  });

  it("warms Claude Haiku's cache for a Groq session (screenshots and the fallback read it)", async () => {
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await (await POST(post({ mode: 'warm', model: 'groq', session: SESSION }))).text();
    expect(groqMock).not.toHaveBeenCalled();
    expect(createMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
  });

  it('answers with Claude Haiku while Groq is off', async () => {
    switches.groq = false;
    streamMock.mockReturnValue(fakeMessageStream());
    const text = await (await POST(post(CHAT))).text();
    expect(groqMock).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
    expect(text).toMatch(/"model":"fast"/);
  });

  it('keeps Ask AI on its Claude model', async () => {
    streamMock.mockReturnValue(fakeMessageStream());
    await (await POST(post({ mode: 'kite', model: 'groq', question: 'Hello?' }))).text();
    expect(groqMock).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0]![0].model).toBe('claude-sonnet-5-5');
  });

  it('rejects any model outside the allow-list', async () => {
    const response = await POST(post({ ...CHAT, model: 'gpt-5' }));
    expect(response.status).toBe(400);
    expect(groqMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });
});
