/**
 * Tests for apps/web/src/core/answer/warm.ts with the request faked: toSessionContext() turns a
 * stored session into the request's session details (key terms split per line, documents oldest
 * first, the same JSON whatever order the documents were read in); warmSession() sends mode
 * 'warm' with the session's model tier (and the conversation chunks for the idle re-warm),
 * resolves with the usage, resolves null on failure
 * (never throws), and logs only the id, times and token counts. ADR-0067: the CV goes first,
 * marked kind 'resume' (sortDocuments()). All text is invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerDone, AnswerHandlers, streamAnswer } from '@/core/answer/answerClient';
import {
  forgetRecentWarmUps,
  sortDocuments,
  toSessionContext,
  warmSession,
} from '@/core/answer/warm';
import type { Session, StoredDocument } from '@/core/storage/types';

/** An invented session. */
const SESSION: Session = {
  id: 's1',
  type: 'regular',
  company: 'Northwind Logistics',
  role: 'Account review',
  description: 'Renewal call',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: 'Bluefin Route\n\n  Professional plan  \n',
  },
  instructions: 'SECRET-INSTRUCTION-TEXT',
  saveTranscript: true,
  autoAnswer: false,
  createdAt: 1,
  status: 'not-started',
  lastActiveAt: null,
};

/**
 * An invented document.
 *
 * @param id      Document id.
 * @param addedAt When it was added (Unix ms).
 * @returns The document.
 */
function doc(id: string, addedAt: number): StoredDocument {
  return { id, sessionId: 's1', name: `${id}.txt`, text: `SECRET ${id}`, chars: 9, addedAt };
}

/** A successful warm-up result. */
const DONE: AnswerDone = {
  usage: {
    input_tokens: 5,
    output_tokens: 0,
    cache_creation_input_tokens: 2100,
    cache_read_input_tokens: 0,
  },
  serverMs: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 0, toFirstText: 2, total: 2 },
  msToFirstText: 10,
  msTotal: 10,
};

/**
 * A fake streamAnswer() that finishes at once.
 *
 * @param finish Calls the handler the fake should call.
 * @returns The fake, a vi.fn spy.
 */
function fakeSend(finish: (handlers: AnswerHandlers) => void) {
  return vi.fn<typeof streamAnswer>((_request, handlers) => {
    finish(handlers);
    return { cancel: () => undefined };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toSessionContext', () => {
  it('builds the session details: key terms per line, style and documents oldest first', () => {
    const context = toSessionContext(SESSION, [doc('b', 2), doc('a', 1)]);
    expect(context).toEqual({
      type: 'regular',
      company: 'Northwind Logistics',
      role: 'Account review',
      description: 'Renewal call',
      instructions: 'SECRET-INSTRUCTION-TEXT',
      keyTerms: ['Bluefin Route', 'Professional plan'],
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      documents: [
        { name: 'a.txt', text: 'SECRET a' },
        { name: 'b.txt', text: 'SECRET b' },
      ],
    });
  });

  it('never sends the company domain with an answer (ADR-0048)', () => {
    const context = toSessionContext({ ...SESSION, companyDomain: 'alder.example' }, []);
    expect(JSON.stringify(context)).not.toContain('alder.example');
  });

  it('sends STAR only when it is on, so a session without it sends what it always has', () => {
    const on = {
      ...SESSION,
      preferences: {
        ...SESSION.preferences,
        style: { ...SESSION.preferences.style, star: true },
      },
    };
    expect(toSessionContext(on, []).style).toEqual({
      format: 'headline+bullets',
      length: 'short',
      tone: 'simple',
      star: true,
    });
    expect(toSessionContext(SESSION, []).style).not.toHaveProperty('star');
  });

  it('gives the same JSON whatever order the documents were read in (ties by id)', () => {
    const one = toSessionContext(SESSION, [doc('a', 1), doc('c', 5), doc('b', 5)]);
    const two = toSessionContext(SESSION, [doc('b', 5), doc('a', 1), doc('c', 5)]);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });
});

describe('warmSession', () => {
  // 1.5.1: each test starts with no recent warm-up to reuse.
  afterEach(() => forgetRecentWarmUps());

  it('sends mode warm with the session tier and resolves with the usage', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const send = fakeSend((handlers) => handlers.onDone(DONE));
    const result = await warmSession(
      { ...SESSION, preferences: { ...SESSION.preferences, model: 'smart' } },
      [],
      { send },
    );
    expect(result).toBe(DONE);
    const [request] = send.mock.calls[0]!;
    expect(request.mode).toBe('warm');
    expect(request.model).toBe('smart');
    expect(request.session?.company).toBe('Northwind Logistics');
  });

  it('sends the conversation chunks for the idle re-warm, and none by default', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const send = fakeSend((handlers) => handlers.onDone(DONE));
    const conversation = [[{ kind: 'line' as const, speaker: 'them' as const, text: 'x', at: 1 }]];
    await warmSession(SESSION, [], { send, conversation });
    await warmSession(SESSION, [], { send });
    expect(send.mock.calls[0]![0].conversation).toEqual(conversation);
    expect(send.mock.calls[1]![0]).not.toHaveProperty('conversation');
  });

  it('sends the approved lessons exactly as given (Day 5 Stage 7), and none by default', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const send = fakeSend((handlers) => handlers.onDone(DONE));
    const lessons = ['Give prices per seat and per month.', 'Answer in first person.'];
    await warmSession(SESSION, [], { send, lessons });
    await warmSession(SESSION, [], { send, lessons: [] });
    expect(send.mock.calls[0]![0].lessons).toEqual(lessons);
    expect(send.mock.calls[1]![0]).not.toHaveProperty('lessons');
  });

  it('resolves null on failure, and when sending throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = fakeSend((handlers) =>
      handlers.onError({ code: 'upstream_error', message: 'x' }),
    );
    expect(await warmSession(SESSION, [], { send: failing })).toBeNull();
    const throwing = vi.fn<typeof streamAnswer>(() => {
      throw new Error('offline');
    });
    expect(await warmSession(SESSION, [], { send: throwing })).toBeNull();
  });

  it('logs the id, times and token counts only', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await warmSession(SESSION, [doc('a', 1)], { send: fakeSend((h) => h.onDone(DONE)) });
    await warmSession(SESSION, [doc('a', 1)], {
      send: fakeSend((h) => h.onError({ code: 'internal', message: 'x' })),
    });
    const logged = JSON.stringify([info.mock.calls, warn.mock.calls]);
    expect(logged).toContain('"sessionId":"s1"');
    expect(logged).toContain('"cacheWrite":2100');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('Northwind');
  });
});

describe('the CV first (ADR-0067)', () => {
  it('puts the CV before older documents and marks it, the rest oldest first', () => {
    const cv: StoredDocument = { ...doc('cv', 9), kind: 'resume' };
    const context = toSessionContext(SESSION, [doc('b', 2), cv, doc('a', 1)]);
    expect(context.documents.map((document) => document.name)).toEqual([
      'cv.txt',
      'a.txt',
      'b.txt',
    ]);
    expect(context.documents[0]).toEqual({ name: 'cv.txt', text: 'SECRET cv', kind: 'resume' });
    expect(context.documents[1]).not.toHaveProperty('kind');
  });

  it('sorts the same whatever the order read, ties by id', () => {
    const one = [doc('b', 1), doc('a', 1), { ...doc('cv', 5), kind: 'resume' as const }];
    expect(sortDocuments(one).map((document) => document.id)).toEqual(['cv', 'a', 'b']);
    expect(sortDocuments([...one].reverse())).toEqual(sortDocuments(one));
  });
});

describe('1.5.1 (ADR-0069): one warm-up per open', () => {
  afterEach(() => forgetRecentWarmUps());

  it('reuses a warm-up for the same session within a minute, and sends again after a failure', async () => {
    const ok = vi.fn(fakeSend((h) => h.onDone(DONE)));
    await warmSession(SESSION, [doc('a', 1)], { send: ok });
    await warmSession(SESSION, [doc('a', 1)], { send: ok });
    expect(ok).toHaveBeenCalledTimes(1);
    // Other documents are a different warm-up.
    await warmSession(SESSION, [doc('b', 1)], { send: ok });
    expect(ok).toHaveBeenCalledTimes(2);
    // The idle re-warm (with the conversation) always runs.
    await warmSession(SESSION, [doc('a', 1)], { send: ok, conversation: [] });
    await warmSession(SESSION, [doc('a', 1)], {
      send: ok,
      conversation: [{ lines: [], answers: [] } as never],
    });
    expect(ok).toHaveBeenCalledTimes(3);
    forgetRecentWarmUps();
    const failing = vi.fn(fakeSend((h) => h.onError({ code: 'internal', message: 'x' })));
    await warmSession(SESSION, [doc('c', 1)], { send: failing });
    await warmSession(SESSION, [doc('c', 1)], { send: failing });
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
