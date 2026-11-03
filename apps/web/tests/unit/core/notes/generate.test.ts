/**
 * Tests for apps/web/src/core/notes/generate.ts and src/core/storage/notes.ts: notesRequest()
 * turns lines and this call's answers into times since the call started, leaves out empty lines
 * and earlier calls' answers, and keeps the newest lines of a call over the character limit;
 * generateNotes() posts once, saves the notes (and they can be read back from IndexedDB),
 * returns 'skipped' without posting when there is nothing to write about, and 'failed' (never
 * throws) on a failure, with the reason when Claude was unavailable (usage limit or overload),
 * leaving the saved transcript and answers as they were; its logs hold ids, sizes, times and
 * token counts only.
 * All text is invented.
 */
import 'fake-indexeddb/auto';
import { CLAUDE_UNAVAILABLE_MESSAGES, MAX_NOTES_CHARS } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateNotes, notesRequest, type NotesInput } from '@/core/notes/generate';
import { listAnswers, saveAnswer } from '@/core/storage/answers';
import { getNotes } from '@/core/storage/notes';
import type { Session, StoredAnswer } from '@/core/storage/types';
import { listUtterances, saveUtterance } from '@/core/storage/utterances';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

/** When the invented call started. */
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
  status: 'ended',
  lastActiveAt: null,
};

/**
 * An invented answer.
 *
 * @param id        Id.
 * @param createdAt When asked.
 * @returns The answer.
 */
function answer(id: string, createdAt: number): StoredAnswer {
  return {
    id,
    sessionId: 's1',
    mode: 'answer',
    question: 'SECRET-Q',
    text: 'SECRET-A',
    model: 'fast',
    msFirstToken: 1,
    msTotal: 2,
    createdAt,
    rating: 'down',
    note: 'SECRET-NOTE',
  };
}

/** The invented call. */
const INPUT: NotesInput = {
  session: SESSION,
  documents: [],
  lines: [
    { speaker: 'them', text: 'SECRET what does it cost', tStart: START + 10_500 },
    { speaker: 'you', text: '   ', tStart: START + 12_000 },
    { speaker: 'you', text: 'fifty two per seat', tStart: START + 20_000 },
  ],
  answers: [answer('old', START - 60_000), answer('a1', START + 15_000)],
  callStartedAt: START,
};

describe('notesRequest', () => {
  it('uses seconds since the call started, this call only, and no empty lines', () => {
    const request = notesRequest(INPUT);
    expect(request.lines).toEqual([
      { speaker: 'them', text: 'SECRET what does it cost', at: 10 },
      { speaker: 'you', text: 'fifty two per seat', at: 20 },
    ]);
    expect(request.answers).toEqual([
      {
        at: 15,
        mode: 'answer',
        question: 'SECRET-Q',
        text: 'SECRET-A',
        rating: 'down',
        note: 'SECRET-NOTE',
      },
    ]);
    expect(request.session.company).toBe('Northwind (invented)');
  });

  it('leaves out a private Ask Kite answer: it was never part of the call (ADR-0030)', () => {
    const answer = {
      id: 'a',
      sessionId: 's',
      mode: 'chat' as const,
      question: 'What is 2 + 2?',
      text: 'It is 4.',
      model: 'fast' as const,
      msFirstToken: 1,
      msTotal: 2,
      createdAt: Date.now() + 1_000,
      rating: null,
      note: '',
    };
    const base = {
      session: { ...SESSION },
      documents: [],
      lines: [],
      callStartedAt: Date.now(),
    };
    const request = notesRequest({
      ...base,
      answers: [
        answer,
        { ...answer, id: 'b', meta: { type: 'concept', target: 'kite', source: 'general' } },
      ],
    });
    expect(request.answers).toHaveLength(1);
  });

  it('keeps the newest lines when the call is over the character limit', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({
      speaker: 'them' as const,
      text: `${i} `.padEnd(2_000, 'x'),
      tStart: START + i * 1_000,
    }));
    const request = notesRequest({ ...INPUT, lines });
    const total = request.lines.reduce((sum, line) => sum + line.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_NOTES_CHARS);
    expect(request.lines.at(-1)!.at).toBe(199);
    expect(request.lines[0]!.at).toBe(200 - MAX_NOTES_CHARS / 2_000);
  });
});

describe('generateNotes', () => {
  it('posts once, saves the notes, and logs numbers only', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const notes = {
      summary: ['SECRET-SUMMARY'],
      questions: [],
      nextSteps: [],
      unclear: [],
      lessons: [],
    };
    const fetchImpl = vi.fn(async () =>
      Response.json({
        notes,
        usage: {
          input_tokens: 900,
          output_tokens: 120,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        ms: 4_000,
      }),
    );
    const outcome = await generateNotes(INPUT, { fetchImpl, now: () => 42 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = {
      sessionId: 's1',
      notes,
      callStartedAt: START,
      createdAt: 42,
      fromAnswersOnly: false,
    };
    expect(outcome).toEqual({ status: 'saved', stored: saved });
    expect(await getNotes('s1')).toEqual(saved);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"input":900');
    expect(logged).not.toContain('SECRET');
  });

  it('does nothing for an empty call, and never throws on failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => Response.json({ code: 'upstream_error' }, { status: 502 }));
    const empty = await generateNotes({ ...INPUT, lines: [], answers: [] }, { fetchImpl });
    expect(empty).toEqual({ status: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await generateNotes(INPUT, { fetchImpl })).toEqual({
      status: 'failed',
      unavailable: null,
    });
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await generateNotes(INPUT, { fetchImpl: offline })).toEqual({
      status: 'failed',
      unavailable: null,
    });
    expect(await getNotes('s1')).toBeNull();
  });

  it('says when Claude was unavailable, and leaves the saved transcript and answers as they were', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // What End has already saved before the notes are asked for.
    await saveUtterance({
      id: 'u1',
      sessionId: 's1',
      speaker: 'them',
      text: 'SECRET what does it cost',
      tStart: START + 10_500,
      tEnd: START + 12_000,
    });
    await saveAnswer(answer('a1', START + 15_000));
    for (const [reason, message] of Object.entries(CLAUDE_UNAVAILABLE_MESSAGES)) {
      const fetchImpl = vi.fn(async () =>
        Response.json({ code: 'claude_unavailable', message }, { status: 503 }),
      );
      expect(await generateNotes(INPUT, { fetchImpl })).toEqual({
        status: 'failed',
        unavailable: reason,
      });
    }
    expect(await getNotes('s1')).toBeNull();
    expect((await listUtterances('s1')).map((line) => line.id)).toEqual(['u1']);
    expect((await listAnswers('s1')).map((stored) => stored.id)).toEqual(['a1']);
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain('"code":"claude_unavailable"');
    expect(logged).not.toContain('SECRET');
  });
});
