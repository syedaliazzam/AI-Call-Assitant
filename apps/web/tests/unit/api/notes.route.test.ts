/**
 * Tests for apps/web/app/api/notes/route.ts (POST) and apps/web/src/server/notes.ts, with
 * sign-in and the Anthropic SDK mocked: 401 when signed out (or with a temporary password),
 * with the session cookie forwarded; 400 for a bad body, too many lines, too many characters
 * and unknown fields, without echoing content; a valid call goes to the smart model as one
 * structured request with the cached notes rules and session block, and the JSON notes come
 * back with question ratings taken from the request (never from the model; linked by answer id,
 * each answer rating at most one question) and the counts
 * capped (6 summary bullets, 3 lessons); a Claude failure is 502 with a safe message (503
 * claude_unavailable with the fixed message for the usage limit); logs hold
 * sizes, counts, times and token counts, never transcript, answer, note or notes text.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  CLAUDE_UNAVAILABLE_MESSAGES,
  MAX_NOTES_CHARS,
  MAX_NOTES_LINES,
  type NotesResponse,
} from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Spy standing in for client.messages.create(). */
const createMock = vi.fn();
/** The fake session read. */
const getSessionMock = vi.fn();
/** Set-Cookie values the fake getCachedSession() returns. */
let setCookies: string[] = [];

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends actual.default {
    override messages = { create: createMock } as unknown as Anthropic['messages'];
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});
vi.mock('@/server/auth', () => ({
  getCachedSession: async () => ({ session: await getSessionMock(), setCookies: [...setCookies] }),
}));

vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');

const { POST } = await import('../../../app/api/notes/route');

/** A signed-in user. */
const SIGNED_IN = { user: { id: 'u1', role: 'user', mustChangePassword: false } };

/** An invented session. */
const SESSION = {
  type: 'regular',
  company: 'SECRET-COMPANY Ltd',
  role: 'Renewal',
  description: '',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [],
};

/** An invented call with two answers (one rated down, with a note). */
const BODY = {
  session: SESSION,
  lines: [
    { speaker: 'them', text: 'SECRET-LINE what does it cost', at: 10 },
    { speaker: 'you', text: 'SECRET-LINE fifty two per seat', at: 20 },
  ],
  answers: [
    {
      at: 12,
      mode: 'answer',
      question: 'SECRET-Q cost',
      text: 'SECRET-A 52',
      rating: 'down',
      note: 'SECRET-NOTE monthly too',
    },
    { at: 30, mode: 'chat', question: 'SECRET-Q2', text: 'SECRET-A2', rating: null, note: '' },
  ],
};

/**
 * The model's reply: notes with a made-up answer time for one question, and too many bullets
 * and lessons.
 *
 * @returns A Message-like object.
 */
function modelReply() {
  const notes = {
    summary: ['SECRET-S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
    questions: [
      { question: 'SECRET cost?', at: 10, answered: 'yes', answerId: 'A1' },
      { question: 'Renewal?', at: 25, answered: 'partly', answerId: 'A9' },
      { question: 'Training?', at: 40, answered: 'no', answerId: null },
      { question: 'Follow-up?', at: 50, answered: 'yes', answerId: 'A1' },
    ],
    nextSteps: [{ step: 'Send the price list', owner: 'You' }],
    unclear: [{ from: 60, to: 90, reason: 'garbled' }],
    lessons: [
      { text: 'L1', evidence: 'e' },
      { text: 'L2', evidence: 'e' },
      { text: 'L3', evidence: 'e' },
      { text: 'L4', evidence: 'e' },
    ],
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(notes) }],
    usage: { input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 0 },
  };
}

/**
 * A POST /api/notes request.
 *
 * @param body The raw body.
 * @returns The request.
 */
function post(body: string) {
  return new Request('http://localhost:3000/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  createMock.mockReset();
  getSessionMock.mockReset();
  setCookies = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/notes', () => {
  it('401 when signed out or with a temporary password, with the session cookie forwarded', async () => {
    getSessionMock.mockResolvedValue(null);
    setCookies = ['better-auth.session_data=; Max-Age=0'];
    const response = await POST(post(JSON.stringify(BODY)));
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual(setCookies);
    getSessionMock.mockResolvedValue({ user: { ...SIGNED_IN.user, mustChangePassword: true } });
    expect((await POST(post(JSON.stringify(BODY)))).status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('400 for bad bodies and over-limit calls, without echoing content', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const message = async (body: unknown) => {
      const response = await POST(post(typeof body === 'string' ? body : JSON.stringify(body)));
      expect(response.status).toBe(400);
      return ((await response.json()) as { message: string }).message;
    };
    expect(await message('not json')).toBe('Body must be JSON');
    expect(await message({ ...BODY, extra: 1 })).toContain('extra');
    const many = Array.from({ length: MAX_NOTES_LINES + 1 }, () => BODY.lines[0]);
    expect(await message({ ...BODY, lines: many })).toContain('lines');
    const long = Array.from({ length: Math.ceil(MAX_NOTES_CHARS / 2_000) + 1 }, (_, i) => ({
      speaker: 'them',
      text: 'SECRET'.padEnd(2_000, 'x'),
      at: i,
    }));
    const tooLong = await message({ ...BODY, lines: long });
    expect(tooLong).toContain(`lines: at most ${MAX_NOTES_CHARS} characters in all`);
    expect(tooLong).not.toContain('SECRET');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('writes the notes with the smart model; ratings come from the request; counts capped', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockResolvedValue(modelReply());
    const response = await POST(post(JSON.stringify(BODY)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as NotesResponse;
    expect(body.notes.summary).toHaveLength(6);
    expect(body.notes.lessons).toHaveLength(3);
    // A1 → the down-rated answer; A9 is not an answer id (made up) → no rating and "no";
    // null → none; A1 again (already used for the first question) → no rating and "no", so one
    // answer's rating is never copied onto a follow-up the user answered (Day 6 Stage 4b).
    expect(body.notes.questions.map((q) => q.rating)).toEqual(['down', null, null, null]);
    expect(body.notes.questions.map((q) => q.answered)).toEqual(['yes', 'no', 'no', 'no']);
    // Each answer is labelled with its id in the prompt.
    const sent = JSON.stringify(createMock.mock.calls[0]![0]);
    expect(sent).toContain('id=\\"A1\\"');
    expect(sent).toContain('id=\\"A2\\"');
    expect(body.usage.input_tokens).toBe(2_000);

    const [params, options] = createMock.mock.calls[0]!;
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.thinking).toEqual({ type: 'between_tools' });
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.system).toHaveLength(2);
    for (const block of params.system) expect(block.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.system[0].text).toContain('could not be understood');
    // Silence is not unclear (Day 6 Stage 4b).
    expect(params.system[0].text).toContain('Silence, or a gap where nobody spoke, is not unclear');
    expect(params.messages[0].content).toContain('[00:10] Them: SECRET-LINE what does it cost');
    expect(params.messages[0].content).toContain("User's note: SECRET-NOTE monthly too");
    expect(options.timeout).toBeGreaterThan(60_000);
  });

  it('503 claude_unavailable with the fixed message when the usage limit is reached', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockRejectedValueOnce(
      Anthropic.APIError.generate(
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
      ),
    );
    const response = await POST(post(JSON.stringify(BODY)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'claude_unavailable',
      message: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit,
    });
  });

  it('502 when Claude fails, with a safe message; logs never hold call or notes text', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    createMock.mockRejectedValueOnce(
      new Anthropic.APIError(500, undefined, 'SECRET detail', new Headers()),
    );
    const failed = await POST(post(JSON.stringify(BODY)));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('SECRET');
    createMock.mockResolvedValue(modelReply());
    await (await POST(post(JSON.stringify(BODY)))).text();
    const logged = JSON.stringify([
      vi.mocked(console.info).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);
    expect(logged).toContain('"lines":2');
    expect(logged).toContain('"lessons":3');
    expect(logged).not.toContain('SECRET');
  });
});
