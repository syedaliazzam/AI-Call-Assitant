/**
 * Tests for createAnswerRunner() in apps/web/src/core/answer/answerClient.ts, with the request
 * and the clock faked: the whole text so far is passed on each piece; one answer at a time (a
 * new run cancels the one streaming, and its late callbacks are ignored); cancel() stops the
 * answer; busy() follows the run; the timeline (key press → sent → first word → headline →
 * done) is measured, with the headline at the first line break or at the end of a one-line
 * answer. All text is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createAnswerRunner,
  type AnswerDone,
  type AnswerHandlers,
  type streamAnswer,
} from '@/core/answer/answerClient';

/** A finished answer's server details. */
const DONE: AnswerDone = {
  usage: {
    input_tokens: 1,
    output_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 3,
  },
  serverMs: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 3, toFirstText: 4, total: 5 },
  msToFirstText: 1,
  msTotal: 2,
};

/**
 * A fake send that records each request's handlers and cancel spy.
 *
 * @returns The fake and the recorded calls.
 */
function fakeSend() {
  const calls: { handlers: AnswerHandlers; cancel: ReturnType<typeof vi.fn> }[] = [];
  const send = vi.fn<typeof streamAnswer>((_request, handlers) => {
    const cancel = vi.fn();
    calls.push({ handlers, cancel });
    return { cancel };
  });
  return { send, calls };
}

/**
 * Handlers that record what the runner reports.
 *
 * @returns The handlers and the recorded events.
 */
function recorder() {
  const events: string[] = [];
  return {
    events,
    handlers: {
      onText: (text: string) => events.push(`text ${text}`),
      onDone: (text: string, _done: AnswerDone, timeline: unknown) =>
        events.push(`done ${text} ${JSON.stringify(timeline)}`),
      onError: (failure: { code: string }) => events.push(`error ${failure.code}`),
    },
  };
}

describe('createAnswerRunner', () => {
  it('passes the text so far and measures the timeline', () => {
    let clock = 100;
    const { send, calls } = fakeSend();
    const runner = createAnswerRunner({ send, now: () => clock });
    const { events, handlers } = recorder();
    clock = 108;
    runner.run({ mode: 'chat' }, 100, handlers);
    expect(runner.busy()).toBe(true);
    clock = 700;
    calls[0]!.handlers.onDelta('Fifty two');
    clock = 900;
    calls[0]!.handlers.onDelta(' dollars.\n- Per');
    clock = 1_400;
    calls[0]!.handlers.onDone(DONE);
    expect(events).toEqual([
      'text Fifty two',
      'text Fifty two dollars.\n- Per',
      `done Fifty two dollars.\n- Per ${JSON.stringify({
        toSent: 8,
        toFirstWord: 600,
        toHeadline: 800,
        toDone: 1_300,
      })}`,
    ]);
    expect(runner.busy()).toBe(false);
  });

  it('a one-line answer has its headline at the end', () => {
    let clock = 0;
    const { send, calls } = fakeSend();
    const runner = createAnswerRunner({ send, now: () => clock });
    const done = vi.fn();
    runner.run({ mode: 'chat' }, 0, { onText: () => undefined, onDone: done, onError: vi.fn() });
    clock = 500;
    calls[0]!.handlers.onDelta('Yes.');
    clock = 650;
    calls[0]!.handlers.onDone(DONE);
    expect(done.mock.calls[0]![2]).toMatchObject({ toHeadline: 650, toDone: 650 });
  });

  it('runs one answer at a time: a new one cancels the old, whose late events are ignored', () => {
    const { send, calls } = fakeSend();
    const runner = createAnswerRunner({ send, now: () => 0 });
    const first = recorder();
    const second = recorder();
    runner.run({ mode: 'answer' }, 0, first.handlers);
    runner.run({ mode: 'answer' }, 0, second.handlers);
    expect(calls[0]!.cancel).toHaveBeenCalledTimes(1);
    calls[0]!.handlers.onDelta('OLD');
    calls[0]!.handlers.onDone(DONE);
    calls[1]!.handlers.onDelta('NEW');
    expect(first.events).toEqual([]);
    expect(second.events).toEqual(['text NEW']);
  });

  it('cancel() stops the answer and nothing more is reported', () => {
    const { send, calls } = fakeSend();
    const runner = createAnswerRunner({ send, now: () => 0 });
    const { events, handlers } = recorder();
    runner.run({ mode: 'answer' }, 0, handlers);
    runner.cancel();
    expect(calls[0]!.cancel).toHaveBeenCalled();
    expect(runner.busy()).toBe(false);
    calls[0]!.handlers.onDelta('LATE');
    calls[0]!.handlers.onError({ code: 'internal', message: 'x' });
    expect(events).toEqual([]);
  });

  it('reports an error once', () => {
    const { send, calls } = fakeSend();
    const runner = createAnswerRunner({ send, now: () => 0 });
    const { events, handlers } = recorder();
    runner.run({ mode: 'answer' }, 0, handlers);
    calls[0]!.handlers.onError({ code: 'upstream_error', message: 'busy' });
    expect(events).toEqual(['error upstream_error']);
    expect(runner.busy()).toBe(false);
  });
});
