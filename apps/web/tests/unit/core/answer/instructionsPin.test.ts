/**
 * Tests for apps/web/src/core/answer/instructionsPin.ts (ADR-0083) and its use by the request builders:
 * - pinInstructions() fetches the versions in force once per call (never on a reconnect), keeps only a
 *   valid pin, and never throws (a failure leaves the call unpinned);
 * - a live call keeps its starting version: every answer (buildAnswerRequest()), warm-up
 *   (warmSession()) and the notes (generateNotes()) of that call send the pin, even after a later pin
 *   for another call; requests outside a pinned call send none (so their bytes are unchanged).
 */
import 'fake-indexeddb/auto';
import type { AnswerRequest, NotesRequest } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { streamAnswer } from '@/core/answer/answerClient';
import { buildAnswerRequest, emptyLog } from '@/core/answer/context';
import { forgetInstructionPins, pinFor, pinInstructions } from '@/core/answer/instructionsPin';
import { forgetRecentWarmUps, warmSession } from '@/core/answer/warm';
import { generateNotes } from '@/core/notes/generate';
import type { Session } from '@/core/storage/types';

/** Two invented version ids. */
const V1 = '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f';
/** The second invented version id. */
const V2 = '1c8d6b2f-4e0a-4b3c-8d7e-2b3c4d5e6f70';

/** When the invented call started (Unix ms). */
const START = 1_000_000;

/** An invented session. */
const SESSION: Session = {
  id: 's1',
  type: 'regular',
  company: 'Northwind (invented)',
  role: 'Renewal',
  description: '',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: '',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
  createdAt: 1,
  status: 'live',
  lastActiveAt: null,
};

/**
 * A fetch that answers the pin route with the given body.
 *
 * @param body   The JSON body.
 * @param status The HTTP status.
 * @returns The spy.
 */
function pinFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => Response.json(body, { status }));
}

/**
 * A chat request built for the call that started at `callStartedAt`.
 *
 * @param callStartedAt The call's start.
 * @returns The request.
 */
function chat(callStartedAt: number): AnswerRequest {
  return buildAnswerRequest({
    session: SESSION,
    documents: [],
    lines: [],
    answers: [],
    mode: 'chat',
    typedQuestion: 'What does it cost?',
    now: callStartedAt + 5_000,
    callStartedAt,
    log: emptyLog(),
  }).request;
}

beforeEach(() => {
  forgetInstructionPins();
  forgetRecentWarmUps();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pinInstructions', () => {
  it('fetches once per call, uncached, and keeps the pin', async () => {
    const fetchImpl = pinFetch({ live: V1, notes: 'none' });
    expect(await pinInstructions(START, fetchImpl)).toEqual({ live: V1, notes: 'none' });
    // A reconnect of the same call keeps its pin and asks nothing.
    expect(await pinInstructions(START, fetchImpl)).toEqual({ live: V1, notes: 'none' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/ai-instructions/pin');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ cache: 'no-store' });
    expect(pinFor(START)).toEqual({ live: V1, notes: 'none' });
  });

  it('leaves the call unpinned on a failure or an unexpected body, and never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await pinInstructions(START, pinFetch({ code: 'internal' }, 503))).toBeNull();
    expect(
      await pinInstructions(START + 1, pinFetch({ live: 'latest', notes: 'none' })),
    ).toBeNull();
    const offline = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('offline')));
    expect(await pinInstructions(START + 2, offline)).toBeNull();
    expect(pinFor(START)).toBeUndefined();
    expect(pinFor(null)).toBeUndefined();
  });
});

describe('a live call keeps the version it started with', () => {
  it('every answer of the call sends its pin, also after another call pinned a newer one', async () => {
    await pinInstructions(START, pinFetch({ live: V1, notes: V1 }));
    expect(chat(START).instructionsVersion).toBe(V1);
    // A later call (another window, after an admin saved) pins the new version…
    await pinInstructions(START + 60_000, pinFetch({ live: V2, notes: V2 }));
    expect(chat(START + 60_000).instructionsVersion).toBe(V2);
    // …and the running call still sends its own.
    expect(chat(START).instructionsVersion).toBe(V1);
  });

  it('a request outside a pinned call sends no pin, so its bytes are as before', () => {
    expect(chat(START)).not.toHaveProperty('instructionsVersion');
  });

  it('the warm-ups of the call send the same pin as its answers', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await pinInstructions(START, pinFetch({ live: V1, notes: 'none' }));
    const send = vi.fn<typeof streamAnswer>((_request, handlers) => {
      handlers.onDone({
        usage: {
          input_tokens: 1,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        serverMs: { auth: 1, toStreamOpen: 1, streamOpenToFirstText: 0, toFirstText: 1, total: 1 },
        msToFirstText: 1,
        msTotal: 1,
      } as never);
      return { cancel: () => undefined };
    });
    await warmSession(SESSION, [], { send, callStartedAt: START });
    // The page-open warm-up (before any call) sends none.
    await warmSession(SESSION, [], { send });
    expect(send.mock.calls[0]![0].instructionsVersion).toBe(V1);
    expect(send.mock.calls[1]![0]).not.toHaveProperty('instructionsVersion');
  });

  it("the call's notes send its notes pin", async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await pinInstructions(START, pinFetch({ live: V1, notes: V2 }));
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        notes: { summary: [], questions: [], nextSteps: [], unclear: [], lessons: [] },
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        ms: 1,
      }),
    );
    await generateNotes(
      {
        session: SESSION,
        documents: [],
        lines: [{ speaker: 'them', text: 'What does it cost?', tStart: START + 3_000 }],
        answers: [],
        callStartedAt: START,
      },
      { fetchImpl, save: async () => undefined },
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as NotesRequest;
    expect(body.instructionsVersion).toBe(V2);
  });
});
