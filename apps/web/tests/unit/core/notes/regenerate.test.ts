/**
 * Tests for apps/web/src/core/notes/regenerate.ts, with /api/notes mocked (no Claude call):
 * regenerateInput() uses the old notes' call start, else the earliest saved line or answer,
 * and sends only that call's lines; regenerateNotes() replaces the saved notes (nothing else
 * changes), marks notes written without transcript lines "from answers only", skips when
 * nothing was saved, and reports the usage limit without throwing or saving.
 * All text is invented.
 */
import 'fake-indexeddb/auto';
import { CLAUDE_UNAVAILABLE_MESSAGES, type CallNotes } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { regenerateInput, regenerateNotes } from '@/core/notes/regenerate';
import type { ReviewData } from '@/core/review/load';
import { getNotes, saveNotes } from '@/core/storage/notes';
import type { Session, StoredAnswer, StoredUtterance } from '@/core/storage/types';
import { resetDb } from '../storage/helpers';

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

/** An invented session. */
const SESSION: Session = {
  id: 's1',
  type: 'sales',
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
  saveTranscript: true,
  autoAnswer: false,
  createdAt: 1,
  status: 'ended',
  lastActiveAt: null,
};

/**
 * An invented line.
 *
 * @param id     Id.
 * @param tStart Start (Unix ms).
 * @returns The line.
 */
function line(id: string, tStart: number): StoredUtterance {
  return { id, sessionId: 's1', speaker: 'them', text: `line ${id}`, tStart, tEnd: tStart + 1 };
}

/** An invented answer at 25 s into the second call. */
const ANSWER: StoredAnswer = {
  id: 'a1',
  sessionId: 's1',
  mode: 'answer',
  question: 'cost?',
  text: '52 dollars.',
  model: 'fast',
  msFirstToken: 1,
  msTotal: 2,
  createdAt: 100_000 + 25_000,
  rating: 'down',
  note: 'monthly too',
};

/** Notes as the model returns them. */
const NEW_NOTES: CallNotes = {
  summary: ['New summary'],
  questions: [],
  nextSteps: [],
  unclear: [],
  lessons: [],
};

/**
 * A mocked /api/notes that returns NEW_NOTES.
 *
 * @returns The fetch spy.
 */
function okFetch() {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({
      notes: NEW_NOTES,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      ms: 1,
    }),
  );
}

/**
 * Review data with two calls' lines (one at 1 s, the latest from 100 s) and the answer.
 *
 * @param changes Fields to replace.
 * @returns The data.
 */
function review(changes: Partial<ReviewData> = {}): ReviewData {
  return {
    session: SESSION,
    documents: [],
    lines: [line('old', 1_000), line('new1', 100_000 + 10_000), line('new2', 100_000 + 30_000)],
    answers: [ANSWER],
    notes: null,
    lessonDecisions: [],
    ...changes,
  };
}

describe('regenerateInput', () => {
  it("uses the old notes' call start and sends only that call's lines", () => {
    const old = {
      sessionId: 's1',
      notes: NEW_NOTES,
      callStartedAt: 100_000,
      createdAt: 200_000,
    };
    const input = regenerateInput(review({ notes: old }));
    expect(input.callStartedAt).toBe(100_000);
    expect(input.lines.map((saved) => saved.text)).toEqual(['line new1', 'line new2']);
  });

  it('without notes, starts at the earliest saved line or answer', () => {
    expect(regenerateInput(review()).callStartedAt).toBe(1_000);
    expect(regenerateInput(review({ lines: [] })).callStartedAt).toBe(ANSWER.createdAt);
    expect(regenerateInput(review({ lines: [], answers: [] })).callStartedAt).toBe(1);
  });
});

describe('regenerateNotes', () => {
  it('replaces the saved notes, from the transcript when it was saved', async () => {
    await saveNotes({
      sessionId: 's1',
      notes: { ...NEW_NOTES, summary: ['Old'] },
      callStartedAt: 100_000,
      createdAt: 5,
    });
    const fetchImpl = okFetch();
    const data = review({ notes: (await getNotes('s1'))! });
    const outcome = await regenerateNotes(data, { fetchImpl, now: () => 300_000 });
    expect(outcome.status).toBe('saved');
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)) as {
      lines: { at: number }[];
      answers: { at: number }[];
    };
    expect(sent.lines.map((sentLine) => sentLine.at)).toEqual([10, 30]);
    expect(sent.answers.map((sentAnswer) => sentAnswer.at)).toEqual([25]);
    expect(await getNotes('s1')).toEqual({
      sessionId: 's1',
      notes: NEW_NOTES,
      callStartedAt: 100_000,
      createdAt: 300_000,
      fromAnswersOnly: false,
    });
  });

  it('writes from the answers only when no transcript was saved, and says so', async () => {
    const data = review({ lines: [], session: { ...SESSION, saveTranscript: false } });
    const outcome = await regenerateNotes(data, { fetchImpl: okFetch(), now: () => 7 });
    expect(outcome.status === 'saved' && outcome.stored.fromAnswersOnly).toBe(true);
    expect((await getNotes('s1'))?.fromAnswersOnly).toBe(true);
  });

  it('skips when nothing was saved, and reports the usage limit without saving', async () => {
    const fetchImpl = okFetch();
    expect(await regenerateNotes(review({ lines: [], answers: [] }), { fetchImpl })).toEqual({
      status: 'skipped',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const limited = vi.fn(async () =>
      Response.json(
        { code: 'claude_unavailable', message: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit },
        { status: 503 },
      ),
    );
    expect(await regenerateNotes(review(), { fetchImpl: limited })).toEqual({
      status: 'failed',
      unavailable: 'usageLimit',
    });
    expect(await getNotes('s1')).toBeNull();
  });
});
