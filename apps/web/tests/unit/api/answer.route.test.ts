/**
 * Tests for apps/web/app/api/answer/route.ts (POST), with sign-in and the Anthropic SDK mocked.
 * Day 5: the session comes from the cookie cache, and its Set-Cookie values are sent back on
 * the stream and on errors; mode screenshot needs a JPEG image (checked by its bytes, size
 * capped), puts it uncached before the question, and logs only its size. Earlier days:
 * 401 without a session (or with a temporary password), 400 for bad bodies, and a streamed reply (delta events, then done with usage and timings);
 * a Claude refusal ends with an error event. Mode 'warm' (Day 3): a 400 naming the field without
 * a session; otherwise one max_tokens 0 request with the session's cached blocks and a done event
 * with the cache usage (no delta); session text never reaches the logs. Modes 'answer' and
 * 'chat' (Day 4): streamed with max_tokens 400, the tier's thinking setting and three cache
 * breakpoints (rules, session, last conversation chunk); delta events in order, then done with
 * cache usage; a failure before any text is an error event; 401 when signed out; logs carry
 * sizes, timings and token counts, never transcript, question, answer or session text.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AnswerTimings } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMessageStream } from '../../helpers/fakeClaude';

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
  type: 'sales',
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

  it('streams with max_tokens 400, the tier thinking and three breakpoints', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Headline'] }));
    await (await POST(post(JSON.stringify(ANSWER_REQUEST)))).text();
    const [params] = streamMock.mock.calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(400);
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
    expect(params.max_tokens).toBe(400);
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
