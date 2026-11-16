/**
 * Tests for apps/web/app/api/answer/route.ts (POST), with sign-in and the Anthropic SDK mocked.
 * Day 5: the session comes from the cookie cache, and its Set-Cookie values are sent back on
 * the stream and on errors; mode screenshot needs a JPEG image (checked by its bytes, size
 * capped), puts it uncached before the question, and logs only its size. Earlier days:
 * 401 without a session (or with a temporary password), 400 for bad bodies, and a streamed reply (delta events, then done with usage and timings);
 * a Claude refusal ends with an error event. Mode 'warm' (Day 3): a 400 naming the field without
 * a session; otherwise one max_tokens 0 request with the session's cached blocks and a done event
 * with the cache usage (no delta); session text never reaches the logs. Modes 'answer' and
 * 'chat' (Day 4): streamed with max_tokens 1,500, the tier's thinking setting and three cache
 * breakpoints (rules, session, last conversation chunk); delta events in order, then done with
 * cache usage; a failure before any text is an error event; 401 when signed out; logs carry
 * sizes, timings and token counts, never transcript, question, answer or session text. The usage
 * limit and an overload (even mid-stream) end with claude_unavailable and the fixed message.
 * v1.0.2 (ADR-0036): over the daily limit, 429 daily_limit and Claude is never called; answer,
 * chat and screenshot count (msLimit logged), warm-ups and hello never do.
 * ADR-0089: the global prompt: live answers and warm-ups read the version the call pinned (ADR-0083) and
 * send the locked contract first, then the prompt, in the first cached block (the same bytes for the
 * warm-up); Ask AI reads its own tab; hello reads none; the rollback rules stay as they are; only the
 * prompt's size and whether it is the default are logged. The contract fallback: a reply with no hidden
 * lines gets the default type and no raw tags, logged as counts only.
 */
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_UNAVAILABLE_MESSAGES, dailyLimitMessage, type AnswerTimings } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Spy standing in for countRequest() (the daily limit, ADR-0036): allows every request by default. */
const countRequestMock = vi.hoisted(() =>
  vi.fn(async (_userId: string) => ({ allowed: true, count: 1, limit: 300, ms: 0 })),
);
vi.mock('@/server/usage', () => ({ countRequest: countRequestMock }));

/** Spy standing in for the deeper model's switch (spec §6): on by default. */
const deepModelMock = vi.hoisted(() => vi.fn(async () => true));
// The real module is kept for allowedTier(); it needs no database here, since the switch is mocked.
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/modelAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/modelAccess')>()),
  getDeepModelEnabled: deepModelMock,
}));
import { fakeMessageStream } from '../../helpers/fakeClaude';

/**
 * Spy standing in for companySettings() (ADR-0089): the global prompt a request uses, or null for the tab's
 * default prompt (the default, so every other test sees today's prompts).
 */
const companyMock = vi.hoisted(() =>
  vi.fn(async (_block: string, _pin?: string): Promise<string | null> => null),
);
vi.mock('@/server/aiInstructions', async () => {
  const { DEFAULT_PROMPTS } = await import('@/server/prompts/defaults');
  return {
    companySettings: async (block: 'live' | 'notes' | 'ask', pin?: string) => {
      const text = await companyMock(block, pin);
      return text === null
        ? { globalPrompt: DEFAULT_PROMPTS[block], isDefault: true }
        : { globalPrompt: text, isDefault: false };
    },
  };
});

/** Spy standing in for client.messages.stream(). */
const streamMock = vi.fn();
/** Spy standing in for client.messages.create() (the warm-up). */
const createMock = vi.fn();
/** Spy standing in for the session read of getCachedSession() from src/server/auth.ts. */
const getSessionMock = vi.fn();
/** Set-Cookie values the fake getCachedSession() returns (the refreshed cookie cache). */
let setCookies: string[] = [];

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
vi.mock('@/server/auth', () => ({
  getCachedSession: async () => ({ session: await getSessionMock(), setCookies: [...setCookies] }),
}));

vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');

const { POST } = await import('../../../app/api/answer/route');

/** A signed-in user who has already changed their password. */
const SIGNED_IN = { user: { id: 'u1', role: 'user', mustChangePassword: false } };

/**
 * Builds a POST /api/answer request with a raw body.
 *
 * @param body Request body exactly as sent (it may be invalid JSON on purpose).
 * @returns The request.
 */
function post(body: string) {
  return new Request('http://localhost:3000/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  streamMock.mockReset();
  createMock.mockReset();
  getSessionMock.mockReset();
  setCookies = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/answer, session cookie cache (Day 5)', () => {
  it('sends the refreshed session cookie back on the streamed answer', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    setCookies = [
      'better-auth.session_data=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60',
      'better-auth.session_token=def; Path=/; HttpOnly; Secure; SameSite=Lax',
    ];
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Hi'] }));
    const response = await POST(post('{"mode":"hello"}'));
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(response.headers.getSetCookie()).toEqual(setCookies);
    await response.text();
  });

  it('sends the cookie back on an error too (an expired cache cookie is cleared)', async () => {
    getSessionMock.mockResolvedValue(null);
    setCookies = ['better-auth.session_data=; Path=/; Max-Age=0'];
    const response = await POST(post('{"mode":"hello"}'));
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual(setCookies);
  });

  it('sends no Set-Cookie when the cache was used as it is', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream());
    const response = await POST(post('{"mode":"hello"}'));
    expect(response.headers.getSetCookie()).toEqual([]);
    await response.text();
  });
});

describe('POST /api/answer', () => {
  it('returns 401 without a session and never calls Claude', async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await POST(post('{"mode":"hello"}'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('returns 401 for a user who still has a temporary password', async () => {
    getSessionMock.mockResolvedValue({ user: { ...SIGNED_IN.user, mustChangePassword: true } });
    expect((await POST(post('{"mode":"hello"}'))).status).toBe(401);
  });

  it('returns 400 for a body that is not JSON', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const response = await POST(post('not json'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'bad_request' });
  });

  it('returns 400 for a body that fails validation', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    expect((await POST(post('{"mode":"poem"}'))).status).toBe(400);
  });

  it('streams delta events, then done with usage and timings', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Hello', ' Northwind.'] }));

    const response = await POST(post('{"mode":"hello"}'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const text = await response.text();
    expect(text).toContain('event: delta\ndata: {"text":"Hello"}\n\n');
    expect(text).toContain('event: delta\ndata: {"text":" Northwind."}\n\n');
    expect(text).toMatch(/event: done\ndata: \{"usage":\{"input_tokens":40/);
    expect(text).toMatch(
      /"ms":\{"auth":\d+,"toStreamOpen":\d+,"streamOpenToFirstText":\d+,"toFirstText":\d+,"total":\d+\}/,
    );
    // Events arrive in order: both deltas before done.
    expect(text.indexOf('event: done')).toBeGreaterThan(text.lastIndexOf('event: delta'));
  });

  it('uses the fast model and the cached hello system prompt', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream());
    await (await POST(post('{"mode":"hello"}'))).text();

    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('ends with an error event when Claude refuses', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: [], stopReason: 'refusal' }));
    const text = await (await POST(post('{"mode":"hello"}'))).text();
    expect(text).toContain('event: error\ndata: {"code":"refused"');
    expect(text).not.toContain('event: done');
  });

  it('sends an error event (not the API text) when Claude fails mid-stream', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const error = new Anthropic.APIError(500, undefined, 'internal upstream detail', new Headers());
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Hel'], error }));
    const text = await (await POST(post('{"mode":"hello"}'))).text();
    expect(text).toContain('event: delta');
    expect(text).toContain('event: error\ndata: {"code":"upstream_error"');
    expect(text).not.toContain('internal upstream detail');
  });

  it('splits the server time to first word into auth, reaching Claude and Claude itself', async () => {
    // Make the session lookup take a measurable 30 ms.
    getSessionMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(SIGNED_IN), 30)),
    );
    streamMock.mockReturnValue(fakeMessageStream());
    const text = await (await POST(post('{"mode":"hello"}'))).text();

    const done = JSON.parse(text.split('event: done\ndata: ')[1]!.trim()) as {
      ms: AnswerTimings;
    };
    expect(done.ms.auth).toBeGreaterThanOrEqual(25);
    // Each later point in time includes the earlier ones.
    expect(done.ms.toStreamOpen).toBeGreaterThanOrEqual(done.ms.auth);
    // Each value is rounded on its own, so the sum may be 1 ms off.
    expect(
      Math.abs(done.ms.toFirstText - (done.ms.toStreamOpen + done.ms.streamOpenToFirstText)),
    ).toBeLessThanOrEqual(1);
    expect(done.ms.total).toBeGreaterThanOrEqual(done.ms.toFirstText);
  });

  it('logs ids, timings and token counts only (no reply text)', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['SECRET-REPLY-TEXT'] }));
    await (await POST(post('{"mode":"hello"}'))).text();
    const logged = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logged).toContain('"userId":"u1"');
    expect(logged).toMatch(/"auth":\d+,"toStreamOpen":\d+,"streamOpenToFirstText":\d+/);
    expect(logged).not.toContain('SECRET-REPLY-TEXT');
  });
});

/** An invented session, as the browser sends it. */
const SESSION = {
  type: 'regular',
  company: 'Northwind Logistics',
  role: 'Account review',
  description: 'SECRET-DESCRIPTION-TEXT',
  instructions: 'SECRET-INSTRUCTION-TEXT',
  keyTerms: ['Bluefin Route'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'pricing.pdf', text: 'SECRET-DOCUMENT-TEXT' }],
};

describe('POST /api/answer, mode warm', () => {
  it('returns 400 naming the field when the session is missing', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const response = await POST(post('{"mode":"warm"}'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'bad_request',
      message: 'session: required for mode warm',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('writes the cache with max_tokens 0 and returns done with usage, without text', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 2100 },
    });

    const response = await POST(post(JSON.stringify({ mode: 'warm', session: SESSION })));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('event: delta');
    expect(text).toContain(
      'event: done\ndata: {"usage":{"input_tokens":5,"output_tokens":0,"cache_creation_input_tokens":2100,"cache_read_input_tokens":0}',
    );
    expect(text).toMatch(/"ms":\{"auth":\d+,"toStreamOpen":\d+/);

    expect(streamMock).not.toHaveBeenCalled();
    const [params] = createMock.mock.calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(0);
    expect(params.system).toHaveLength(2);
    expect(params.system[1].text).toContain('Company: Northwind Logistics');
    expect(params.system[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('uses the smart model and its thinking setting when asked', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 0 },
    });
    await (
      await POST(post(JSON.stringify({ mode: 'warm', model: 'smart', session: SESSION })))
    ).text();
    const [params] = createMock.mock.calls[0]!;
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.thinking).toEqual({ type: 'between_tools' });
  });

  it('falls back to the fast model when an admin has turned the smart one off', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 0 },
    });
    deepModelMock.mockResolvedValueOnce(false);
    await (
      await POST(post(JSON.stringify({ mode: 'warm', model: 'smart', session: SESSION })))
    ).text();
    expect(createMock.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
  });

  it('reads the switch only for a request that wants the smart model', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 0 },
    });
    deepModelMock.mockClear();
    await (await POST(post(JSON.stringify({ mode: 'warm', session: SESSION })))).text();
    expect(deepModelMock).not.toHaveBeenCalled();
  });

  it('refuses a model that is not on the allow-list', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const response = await POST(
      post(JSON.stringify({ mode: 'warm', model: 'claude-opus-5-5', session: SESSION })),
    );
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('sends an error event when the warm-up fails', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockRejectedValue(new Anthropic.APIError(500, undefined, 'detail', new Headers()));
    const text = await (
      await POST(post(JSON.stringify({ mode: 'warm', session: SESSION })))
    ).text();
    expect(text).toContain('event: error\ndata: {"code":"upstream_error"');
    expect(text).not.toContain('detail');
  });

  it('logs mode, timings and token counts, never session or document text', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 2100 },
    });
    await (await POST(post(JSON.stringify({ mode: 'warm', session: SESSION })))).text();
    const logged = JSON.stringify([
      vi.mocked(console.info).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);
    expect(logged).toContain('"mode":"warm"');
    expect(logged).toContain('"cache_read_input_tokens":2100');
    expect(logged).not.toContain('SECRET-INSTRUCTION-TEXT');
    expect(logged).not.toContain('SECRET-DOCUMENT-TEXT');
    expect(logged).not.toContain('SECRET-DESCRIPTION-TEXT');
    expect(logged).not.toContain('Northwind');
  });
});

/** An invented answer request: two conversation chunks, a tail line and the question. */
const ANSWER_REQUEST = {
  mode: 'answer',
  session: SESSION,
  conversation: [
    [{ kind: 'line', speaker: 'them', text: 'SECRET-LINE-ONE', at: 3 }],
    [
      { kind: 'answer', mode: 'answer', question: 'SECRET-Q', text: 'SECRET-EARLIER', at: 5 },
      { kind: 'line', speaker: 'you', text: 'SECRET-LINE-TWO', at: 9 },
    ],
  ],
  tail: [{ speaker: 'them', text: 'SECRET-TAIL', at: 14 }],
  question: 'SECRET-QUESTION',
};

describe('POST /api/answer, modes answer and chat', () => {
  it('returns 401 when signed out, before reading the body', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await POST(post(JSON.stringify(ANSWER_REQUEST)))).status).toBe(401);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('streams with max_tokens 1,500, the tier thinking and three breakpoints', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Headline'] }));
    await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(1_500);
    expect(params.thinking).toEqual({ type: 'disabled' });
    const blocks = [...params.system, ...params.messages[0].content] as {
      cache_control?: unknown;
    }[];
    // rules, session, chunk 1, chunk 2 (breakpoint), tail
    expect(blocks.map((block) => block.cache_control !== undefined)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
  });

  it('streams delta events in order, then done with the cache usage', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(
      fakeMessageStream({
        pieces: ['Ten dollars', ' per seat.', '\n- Billed monthly'],
        usage: {
          input_tokens: 30,
          output_tokens: 12,
          cache_creation_input_tokens: 40,
          cache_read_input_tokens: 2_400,
        },
      }),
    );
    const text = await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    const first = text.indexOf('{"text":"Ten dollars"}');
    const second = text.indexOf('{"text":" per seat."}');
    // JSON writes the newline as the two characters \n.
    const third = text.indexOf('{"text":"\\n- Billed monthly"}');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(text.indexOf('event: done')).toBeGreaterThan(third);
    expect(text).toContain('"cache_creation_input_tokens":40,"cache_read_input_tokens":2400');
  });

  it('uses the smart model and its thinking setting for a chat question', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream());
    const chat = { mode: 'chat', model: 'smart', session: SESSION, question: 'Seat price?' };
    await (await POST(post(JSON.stringify(chat)))).text();
    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.thinking).toEqual({ type: 'between_tools' });
    expect(params.messages[0].content.at(-1).text).toContain('Question typed by the user');
  });

  it('sends claude_unavailable with the fixed message for the usage limit and an overload', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const limit = Anthropic.APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'You have reached your specified API usage limits. SECRET',
        },
      },
      undefined,
      new Headers(),
    );
    streamMock.mockReturnValue(fakeMessageStream({ pieces: [], error: limit }));
    const text = await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    expect(text).toContain(
      `event: error\ndata: ${JSON.stringify({ code: 'claude_unavailable', message: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit })}`,
    );
    expect(text).not.toContain('SECRET');
    // An overloaded_error event after some text: the text already sent stays, then the message.
    const overloaded = new Anthropic.APIError(
      undefined,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      undefined,
      new Headers(),
    );
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Fifty'], error: overloaded }));
    const midStream = await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    expect(midStream).toContain('event: delta');
    expect(midStream).toContain(CLAUDE_UNAVAILABLE_MESSAGES.overloaded);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('"code":"claude_unavailable"');
    expect(logged).not.toContain('SECRET');
  });

  it('sends an error event when Claude fails before any text', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const error = new Anthropic.RateLimitError(429, undefined, 'detail', new Headers());
    streamMock.mockReturnValue(fakeMessageStream({ pieces: [], error }));
    const text = await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    expect(text).not.toContain('event: delta');
    expect(text).toContain('event: error\ndata: {"code":"upstream_error"');
  });

  it('logs sizes, timings and token counts, never call or session text', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['SECRET-ANSWER'] }));
    await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    streamMock.mockReturnValue(
      fakeMessageStream({
        pieces: [],
        error: new Anthropic.APIError(500, undefined, 'x', new Headers()),
      }),
    );
    await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    const logged = JSON.stringify([
      vi.mocked(console.info).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);
    expect(logged).toContain('"mode":"answer"');
    expect(logged).toContain('"chunks":2,"tailLines":1');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('Northwind');
  });
});

/** The part of an image block's source the test reads. */
interface SentImageSource {
  /** Media type, for example image/jpeg. */
  media_type: string;
  /** Base64 data. */
  data: string;
}

/** A content block as sent to the SDK (only the fields the test reads). */
interface SentBlock {
  /** Block type: text or image. */
  type: string;
  /** The cache breakpoint, if any. */
  cache_control?: unknown;
  /** An image block's source. */
  source?: SentImageSource;
  /** A text block's text. */
  text?: string;
}

/** A tiny "JPEG" data URL: base64 "/9j/" decodes to FF D8 FF (the JPEG start bytes). */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAADSECRETPIXELS';

describe('POST /api/answer, mode screenshot (Day 5)', () => {
  it('needs the image, and takes it only in screenshot mode', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const noImage = await POST(post(JSON.stringify({ mode: 'screenshot', session: SESSION })));
    expect(await noImage.json()).toEqual({
      code: 'bad_request',
      message: 'image: required for mode screenshot',
    });
    const wrongMode = await POST(
      post(JSON.stringify({ mode: 'answer', session: SESSION, image: JPEG })),
    );
    expect(await wrongMode.json()).toMatchObject({ message: 'image: only for mode screenshot' });
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('refuses a PNG, a renamed PNG, and an image over the size limit, without echoing it', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const send = async (image: string) =>
      (await (
        await POST(post(JSON.stringify({ mode: 'screenshot', session: SESSION, image })))
      ).json()) as { message: string };
    expect((await send('data:image/png;base64,iVBORw0KGgo=')).message).toContain('image');
    // The prefix says JPEG, but the bytes are a PNG (89 50 4E 47).
    const renamed = await send('data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUg==');
    expect(renamed.message).toBe('image: must be a JPEG image');
    expect(renamed.message).not.toContain('iVBOR');
    const huge = await send(`data:image/jpeg;base64,/9j/${'A'.repeat(1_400_000)}`);
    expect(huge.message).toContain('image: at most');
  });

  it('streams, with the image uncached and before the question, after the cached chunks', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['The slide shows'] }));
    const body = {
      mode: 'screenshot',
      session: SESSION,
      conversation: [[{ kind: 'line', speaker: 'them', text: 'Can you see my slide?', at: 3 }]],
      image: JPEG,
    };
    const text = await (await POST(post(JSON.stringify(body)))).text();
    expect(text).toContain('event: done');
    const [params] = streamMock.mock.calls[0]!;
    expect(params.max_tokens).toBe(1_500);
    const content = params.messages[0].content as SentBlock[];
    expect(content.map((block) => block.type)).toEqual(['text', 'image', 'text']);
    expect(content[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(content[1]).toMatchObject({
      source: { media_type: 'image/jpeg', data: JPEG.slice(23) },
    });
    expect(content[1]!.cache_control).toBeUndefined();
    expect(content[2]!.text).toContain(
      "Question about the screenshot: What's on screen and how should I respond?",
    );
  });

  it('logs the image size only, never its data', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['x'] }));
    await (
      await POST(post(JSON.stringify({ mode: 'screenshot', session: SESSION, image: JPEG })))
    ).text();
    const logged = JSON.stringify([
      vi.mocked(console.info).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);
    expect(logged).toContain(`"imageChars":${JPEG.length}`);
    expect(logged).not.toContain('SECRETPIXELS');
  });
});

describe('POST /api/answer, daily limit (v1.0.2, ADR-0036)', () => {
  it('returns 429 daily_limit with the friendly message and stops the Claude request at once', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    countRequestMock.mockResolvedValueOnce({ allowed: false, count: 301, limit: 300, ms: 4 });
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|call|general]] Hi'] }));
    const response = await POST(post(JSON.stringify(ANSWER_REQUEST)));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      code: 'daily_limit',
      message: dailyLimitMessage(300),
    });
    // Batch C (P1-2): Claude's request starts while the count is read, and is stopped when it says no.
    expect(streamMock).toHaveBeenCalledTimes(1);
    const [, options] = streamMock.mock.calls[0]! as [unknown, { signal: AbortSignal }];
    expect(options.signal.aborted).toBe(true);
    expect(countRequestMock).toHaveBeenLastCalledWith('u1');
  });

  it('starts Claude before the daily-limit count has answered (Batch C, P1-2)', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    let answerCount: (value: {
      allowed: boolean;
      count: number;
      limit: number;
      ms: number;
    }) => void = () => undefined;
    countRequestMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answerCount = resolve;
      }),
    );
    streamMock.mockReturnValue(
      fakeMessageStream({ pieces: ['[[concept|call|general]] Hi there'] }),
    );
    const pending = POST(post(JSON.stringify(ANSWER_REQUEST)));
    await vi.waitFor(() => expect(streamMock).toHaveBeenCalledTimes(1));
    answerCount({ allowed: true, count: 1, limit: 300, ms: 40 });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Hi there');
  });

  it('counts answer, chat and screenshot requests, and logs the check time as msLimit', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    countRequestMock.mockClear();
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|call|general]] Hi'] }));
    await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    await (await POST(post(JSON.stringify({ ...ANSWER_REQUEST, mode: 'chat' })))).text();
    expect(countRequestMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain('"msLimit":0');
  });

  it('never counts warm-ups or the hello test', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    countRequestMock.mockClear();
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 0 },
      content: [],
    });
    await (await POST(post(JSON.stringify({ mode: 'warm', session: SESSION })))).text();
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Hi'] }));
    await (await POST(post('{"mode":"hello"}'))).text();
    expect(countRequestMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/answer, global prompt (ADR-0089)', () => {
  /** An invented version id the call pinned. */
  const PIN = '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f';

  beforeEach(() => {
    companyMock.mockReset();
    companyMock.mockResolvedValue(null);
  });

  it('reads the live tab with the pin the call sent, and sends the contract first, then the prompt', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    companyMock.mockResolvedValue('Say customers, never users.');
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|call|general]] Hi'] }));
    const body = { ...ANSWER_REQUEST, instructionsVersion: PIN };
    await (await POST(post(JSON.stringify(body)))).text();
    expect(companyMock).toHaveBeenCalledWith('live', PIN);
    const [params] = streamMock.mock.calls[0]!;
    const rules: string = params.system[0].text;
    const { LIVE_CONTRACT, GLOBAL_HEADING } = await import('@/server/prompts/contract');
    expect(rules).toBe(`${LIVE_CONTRACT}\n\n${GLOBAL_HEADING}\nSay customers, never users.`);
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    // The session block (the user's preferences and instructions) comes after it.
    expect(params.system[1].text).toContain('These user preferences override the general rules');
    expect(params.system[1].text).toContain('Instructions from the user:');
  });

  it('warms the cache with the same pinned prompt as the answers', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    companyMock.mockResolvedValue('Say customers, never users.');
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 0 },
      content: [],
    });
    const warm = { mode: 'warm', session: SESSION, instructionsVersion: PIN };
    await (await POST(post(JSON.stringify(warm)))).text();
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|call|general]] Hi'] }));
    await (
      await POST(post(JSON.stringify({ ...ANSWER_REQUEST, instructionsVersion: PIN })))
    ).text();
    expect(companyMock.mock.calls).toEqual([
      ['live', PIN],
      ['live', PIN],
    ]);
    expect(createMock.mock.calls[0]![0].system[0]).toEqual(streamMock.mock.calls[0]![0].system[0]);
  });

  it('sends the contract and the default prompt when no version was saved', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|call|general]] Hi'] }));
    await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    const { rulesBlock } = await import('@/server/prompt');
    expect(streamMock.mock.calls[0]![0].system[0].text).toBe(rulesBlock());
  });

  it('uses the Ask AI tab for the Ask AI page and nothing for hello', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    companyMock.mockResolvedValue('ASK PROMPT');
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|kite|general]] Hi'] }));
    await (await POST(post(JSON.stringify({ mode: 'kite', question: 'What is 2 + 2?' })))).text();
    expect(companyMock).toHaveBeenCalledWith('ask', undefined);
    const { ASK_CHAT_CONTRACT } = await import('@/server/prompts/contract');
    const system: string = streamMock.mock.calls[0]![0].system[0].text;
    expect(system.startsWith(ASK_CHAT_CONTRACT)).toBe(true);
    expect(system.endsWith('ASK PROMPT')).toBe(true);
    companyMock.mockClear();
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Hi'] }));
    await (await POST(post('{"mode":"hello"}'))).text();
    expect(companyMock).not.toHaveBeenCalled();
  });

  it('refuses a pin that is not a version id', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const body = { ...ANSWER_REQUEST, instructionsVersion: 'latest' };
    expect((await POST(post(JSON.stringify(body)))).status).toBe(400);
    expect(companyMock).not.toHaveBeenCalled();
  });

  it('logs the prompt size and whether it is the default only, never its text or the pin', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    companyMock.mockResolvedValue('Say customers, never users.');
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|call|general]] Hi'] }));
    await (
      await POST(post(JSON.stringify({ ...ANSWER_REQUEST, instructionsVersion: PIN })))
    ).text();
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('"globalPromptChars":27');
    expect(logs).toContain('"defaultPrompt":false');
    expect(logs).not.toContain('customers');
    expect(logs).not.toContain(PIN);
  });

  it('keeps the rollback rules (v-previous) for an admin, whatever the global prompt', async () => {
    getSessionMock.mockResolvedValue({ ...SIGNED_IN, user: { ...SIGNED_IN.user, role: 'admin' } });
    companyMock.mockResolvedValue('Say customers.');
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['[[concept|call|general]] Hi'] }));
    const body = { ...ANSWER_REQUEST, styleVersion: 'previous', instructionsVersion: PIN };
    await (await POST(post(JSON.stringify(body)))).text();
    const rules: string = streamMock.mock.calls[0]![0].system[0].text;
    expect(rules.startsWith('You are Kite, a live call assistant.')).toBe(true);
    expect(rules).not.toContain('Say customers.');
  });
});

describe('POST /api/answer, contract fallback (ADR-0089)', () => {
  beforeEach(() => {
    companyMock.mockReset();
    companyMock.mockResolvedValue(null);
  });

  it('shows a reply with no hidden lines cleanly: the default type, no raw tags, counts in the log', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(
      fakeMessageStream({ pieces: ['We ship in two days.', ' [[sales|call|docs]]', ' Thanks.'] }),
    );
    const response = await POST(post(JSON.stringify(ANSWER_REQUEST)));
    const text = await response.text();
    // The default meta comes before the first words, and no "[[" reaches the browser.
    expect(text.indexOf('"type":"meta"')).toBeLessThan(text.indexOf('We ship'));
    expect(text).toContain('"type":"other"');
    expect(text).not.toContain('[[');
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('"missingMeta":true');
    expect(logs).toContain('"missingQuestion":true');
    expect(logs).toContain('"strippedTags":1');
    expect(logs).not.toContain('ship');
  });

  it('changes nothing for a reply that keeps the contract', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(
      fakeMessageStream({
        pieces: ['[[sales|call|docs]]\nWe ship in two days.\n[[question|How fast do you ship?]]'],
      }),
    );
    const text = await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    expect(text).toContain('"type":"sales"');
    expect(text).not.toContain('"type":"other"');
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('"missingMeta":false');
    expect(logs).toContain('"missingQuestion":false');
  });
});
