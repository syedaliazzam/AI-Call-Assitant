/**
 * Tests apps/web/src/core/answer/answerClient.ts, the 1.5.1 additions (ADR-0069): requestBody() gzips a
 * large request (and leaves a small one as it is), and the answer runner sends a request again once when
 * nothing comes back within the first-reply timeout, then reports "slow" if the second try is silent too;
 * any reply stops the timer.
 */
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAnswerRunner,
  GZIP_FROM_CHARS,
  requestBody,
  SLOW_REPLY_MESSAGE,
  type AnswerHandlers,
} from '@/core/answer/answerClient';
import type { AnswerRequest } from '@kite/shared';

afterEach(() => vi.useRealTimers());

describe('requestBody', () => {
  it('leaves a small body as it is', async () => {
    expect(await requestBody('{"a":1}')).toEqual({ data: '{"a":1}', gzip: false });
  });

  it('gzips a large body, and it unpacks to the same text', async () => {
    const json = JSON.stringify({ text: 'Invented handbook text. '.repeat(GZIP_FROM_CHARS / 10) });
    const body = await requestBody(json);
    expect(body.gzip).toBe(true);
    const packed = body.data as Uint8Array;
    expect(packed.byteLength).toBeLessThan(json.length / 4);
    expect(gunzipSync(packed).toString('utf8')).toBe(json);
  });
});

describe('createAnswerRunner: the first reply', () => {
  const REQUEST = { mode: 'answer' } as unknown as AnswerRequest;

  /**
   * A send() whose handlers the test drives; counts the sends and the cancels.
   *
   * @returns The calls made, and the send function.
   */
  function controllable() {
    const calls: { handlers: AnswerHandlers; cancelled: boolean }[] = [];
    const send = vi.fn((_request: AnswerRequest, handlers: AnswerHandlers) => {
      const call = { handlers, cancelled: false };
      calls.push(call);
      return {
        cancel: () => {
          call.cancelled = true;
        },
      };
    });
    return { calls, send };
  }

  it('sends again once after a silent start, then reports the slow reply', () => {
    vi.useFakeTimers();
    const { calls, send } = controllable();
    const runner = createAnswerRunner({ send, firstReplyTimeoutMs: 8_000, now: () => 0 });
    const onRetry = vi.fn();
    const onError = vi.fn();
    runner.run(REQUEST, 0, { onText: vi.fn(), onDone: vi.fn(), onError, onRetry });
    vi.advanceTimersByTime(8_000);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.cancelled).toBe(true);
    vi.advanceTimersByTime(8_000);
    expect(onError).toHaveBeenCalledWith({ code: 'timeout', message: SLOW_REPLY_MESSAGE });
    expect(runner.busy()).toBe(false);
  });

  it('keeps waiting once any reply has come', () => {
    vi.useFakeTimers();
    const { calls, send } = controllable();
    const runner = createAnswerRunner({ send, firstReplyTimeoutMs: 8_000, now: () => 0 });
    const onRetry = vi.fn();
    runner.run(REQUEST, 0, { onText: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onRetry });
    calls[0]!.handlers.onMeta?.({ type: 'technical' } as never);
    vi.advanceTimersByTime(30_000);
    expect(onRetry).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});
