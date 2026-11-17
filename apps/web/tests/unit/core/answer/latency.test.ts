/**
 * Tests for apps/web/src/core/answer/latency.ts with the request faked: runLatencyTest() sends
 * one warm-up and then N answers one after another, each appending one conversation chunk
 * (the previous answer and two new lines) and reading the question from the call; samples hold
 * numbers only; summarise() gives nearest-rank p50/p95 and counts cache hits; a failed answer
 * stops the run with its code. The latency document is large enough to be cached.
 */
import type { AnswerRequest } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AnswerHandlers, streamAnswer } from '@/core/answer/answerClient';
import { latencyDocuments, runLatencyTest, summarise } from '@/core/answer/latency';

/**
 * A fake send that answers every request at once with fixed usage.
 *
 * @param fail Request number (1-based, warm-up included) that fails, if any.
 * @returns The fake and the requests it received.
 */
function fakeSend(fail?: number) {
  const requests: AnswerRequest[] = [];
  const send = vi.fn<typeof streamAnswer>((request, handlers: AnswerHandlers) => {
    requests.push(structuredClone(request));
    if (requests.length === fail) {
      handlers.onError({ code: 'upstream_error', message: 'x' });
    } else {
      if (request.mode !== 'warm') handlers.onDelta('Headline.\n- Detail');
      handlers.onDone({
        usage: {
          input_tokens: 40,
          output_tokens: request.mode === 'warm' ? 0 : 30,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: request.mode === 'warm' ? 0 : 5_000,
        },
        serverMs: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 3, toFirstText: 4, total: 5 },
        msToFirstText: 1,
        msTotal: 2,
      });
    }
    return { cancel: () => undefined };
  });
  return { send, requests };
}

describe('runLatencyTest', () => {
  it('warms up, then appends one chunk per answer, with numbers-only samples', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { send, requests } = fakeSend();
    const onSample = vi.fn();
    const { samples, summary } = await runLatencyTest({ count: 3, send, onSample });
    expect(requests.map((request) => request.mode)).toEqual(['warm', 'answer', 'answer', 'answer']);
    const answers = requests.slice(1);
    expect(answers.map((request) => request.conversation?.length)).toEqual([1, 2, 3]);
    // Append-only: each request starts with the previous request's chunks.
    expect(answers[2]!.conversation!.slice(0, 2)).toEqual(answers[1]!.conversation);
    // From answer 2 on, the new chunk starts with the previous answer.
    expect(answers[1]!.conversation![1]![0]).toMatchObject({ kind: 'answer' });
    expect(answers[0]!.question).toBe('WHAT DOES THE PROFESSIONAL PLAN COST PER SEAT');
    expect(samples).toHaveLength(3);
    expect(onSample).toHaveBeenCalledTimes(3);
    expect(Object.keys(samples[0]!).sort()).toEqual(
      [
        // ADR-0099: which model answered, and any fallback (no text).
        'answeredBy',
        'fallback',
        'cacheRead',
        'cacheWrite',
        'input',
        'n',
        'output',
        'serverToFirstText',
        'serverToStreamOpen',
        'toDone',
        'toFirstWord',
        'toHeadline',
        'toSent',
      ].sort(),
    );
    expect(summary.count).toBe(3);
    expect(summary.cacheHits).toBe(3);
  });

  it('stops with the error code when an answer fails', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { send } = fakeSend(3);
    await expect(runLatencyTest({ count: 5, send })).rejects.toThrow(
      'ANSWER_FAILED: upstream_error',
    );
  });
});

describe('summarise', () => {
  it('gives nearest-rank p50 and p95', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      n: i + 1,
      toSent: 5,
      toFirstWord: (i + 1) * 100,
      toHeadline: 0,
      toDone: 0,
      cacheRead: i === 0 ? 0 : 10,
      cacheWrite: 1,
      input: 1,
      output: 1,
      serverToFirstText: 500,
      serverToStreamOpen: 300,
      answeredBy: 'fast' as const,
      fallback: null,
    }));
    const summary = summarise(samples);
    expect(summary.toFirstWord).toEqual({ p50: 1_000, p95: 1_900 });
    expect(summary.cacheHits).toBe(19);
    expect(summary.fallbacks).toBe(0);
  });
});

describe('latencyDocuments', () => {
  it('is large enough for the prompt cache (about 2,000 words)', () => {
    const [document] = latencyDocuments();
    expect(document!.text.split(/\s+/).length).toBeGreaterThan(1_500);
  });
});

describe('runLatencyTest with a model and the CV session (ADR-0099)', () => {
  it('sends the chosen model, the CV as the resume, interview questions, and one call id throughout', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { send, requests } = fakeSend();
    await runLatencyTest({ count: 2, send, model: 'gemini-lite', fixture: 'cv' });
    expect(requests.map((request) => request.model)).toEqual([
      'gemini-lite',
      'gemini-lite',
      'gemini-lite',
    ]);
    const ids = new Set(requests.map((request) => request.callId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^latency-[a-z0-9]+$/);
    expect(requests[0]!.session!.type).toBe('interview');
    expect(requests[0]!.session!.documents[0]).toMatchObject({ kind: 'resume' });
    expect(requests[1]!.question ?? JSON.stringify(requests[1]!.tail)).toContain('DATABASE');
    // Default tier unless asked.
    expect(requests.every((request) => request.serviceTier === undefined)).toBe(true);
  });

  it('sends priority processing with every request of the run when asked', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { send, requests } = fakeSend();
    await runLatencyTest({ count: 2, send, model: 'gpt-luna', serviceTier: 'priority' });
    expect(requests.map((request) => request.serviceTier)).toEqual([
      'priority',
      'priority',
      'priority',
    ]);
  });
});
