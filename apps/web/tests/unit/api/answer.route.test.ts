/**
 * Tests for apps/web/app/api/answer/route.ts (POST), with sign-in and the Anthropic SDK mocked:
 * 401 without a session (or with a temporary password), 400 for bad bodies and for modes that
 * are not built yet, and a streamed reply (delta events, then done with usage and timings);
 * a Claude refusal ends with an error event.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AnswerTimings } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMessageStream } from '../../helpers/fakeClaude';

/** Spy standing in for client.messages.stream(). */
const streamMock = vi.fn();
/** Spy standing in for getSession() from src/server/auth.ts. */
const getSessionMock = vi.fn();

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Subclass the real client so its static error classes stay real for instanceof.
  class FakeAnthropic extends actual.default {
    override messages = { stream: streamMock } as unknown as Anthropic['messages'];
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});
vi.mock('@/server/auth', () => ({ getSession: getSessionMock }));

vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');

const { POST } = await import('../../../app/api/answer/route');

/** A signed-in user who has already changed their password. */
const SIGNED_IN = { user: { id: 'u1', role: 'user', mustChangePassword: false } };

/** Builds a POST /api/answer request with a raw body. */
function post(body: string) {
  return new Request('http://localhost:3000/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  streamMock.mockReset();
  getSessionMock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

  it('returns 400 "not implemented yet: Day N" for later modes', async () => {
    getSessionMock.mockResolvedValue(SIGNED_IN);
    const response = await POST(post('{"mode":"answer"}'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'not_implemented',
      message: 'not implemented yet: Day 4',
    });
    expect(streamMock).not.toHaveBeenCalled();
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
