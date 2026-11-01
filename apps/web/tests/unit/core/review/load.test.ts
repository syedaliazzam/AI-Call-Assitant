/**
 * Tests for apps/web/src/core/review/load.ts: loadReview() returns the session with its
 * documents, saved transcript lines, answers and notes from IndexedDB, only that session's,
 * oldest first; null for a session this device does not have; and empty lines and null notes
 * when nothing was saved. formatCallTime() writes "m:ss", then "h:mm:ss" from the first hour.
 * All text is invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatCallTime, loadReview } from '@/core/review/load';
import { saveAnswer } from '@/core/storage/answers';
import { addDocument } from '@/core/storage/documents';
import { saveNotes } from '@/core/storage/notes';
import { createSession } from '@/core/storage/sessions';
import type { StoredAnswer } from '@/core/storage/types';
import { saveUtterance } from '@/core/storage/utterances';
import { resetDb, sessionInput } from '../storage/helpers';

beforeEach(resetDb);

/**
 * An invented answer.
 *
 * @param id        Id.
 * @param sessionId Session.
 * @param createdAt When asked.
 * @returns The answer.
 */
function answer(id: string, sessionId: string, createdAt: number): StoredAnswer {
  return {
    id,
    sessionId,
    mode: 'answer',
    question: 'What does it cost?',
    text: '52 dollars per seat.',
    model: 'fast',
    msFirstToken: 1,
    msTotal: 2,
    createdAt,
    rating: 'up',
    note: '',
  };
}

describe('loadReview', () => {
  it("loads one session's documents, lines, answers and notes, oldest first", async () => {
    const session = await createSession(sessionInput());
    const other = await createSession(sessionInput({ company: 'Other' }));
    await addDocument({ sessionId: session.id, name: 'price-list.txt', text: 'Prices' });
    for (const [id, tStart] of [
      ['l2', 2_000],
      ['l1', 1_000],
    ] as const) {
      await saveUtterance({
        id,
        sessionId: session.id,
        speaker: 'them',
        text: id,
        tStart,
        tEnd: tStart + 500,
      });
    }
    await saveUtterance({
      id: 'x',
      sessionId: other.id,
      speaker: 'you',
      text: 'x',
      tStart: 1,
      tEnd: 2,
    });
    await saveAnswer(answer('a2', session.id, 3_000));
    await saveAnswer(answer('a1', session.id, 1_500));
    await saveAnswer(answer('ax', other.id, 1_500));
    const notes = {
      sessionId: session.id,
      notes: { summary: ['S'], questions: [], nextSteps: [], unclear: [], lessons: [] },
      callStartedAt: 900,
      createdAt: 4_000,
      fromAnswersOnly: false,
    };
    await saveNotes(notes);

    const review = await loadReview(session.id);
    expect(review?.session.id).toBe(session.id);
    expect(review?.documents.map((document) => document.name)).toEqual(['price-list.txt']);
    expect(review?.lines.map((line) => line.id)).toEqual(['l1', 'l2']);
    expect(review?.answers.map((stored) => stored.id)).toEqual(['a1', 'a2']);
    expect(review?.notes).toEqual(notes);
  });

  it('returns null for an unknown session, and empty parts when nothing was saved', async () => {
    expect(await loadReview('missing')).toBeNull();
    const session = await createSession(sessionInput({ saveTranscript: false }));
    expect(await loadReview(session.id)).toMatchObject({
      documents: [],
      lines: [],
      answers: [],
      notes: null,
      lessonDecisions: [],
    });
  });
});

describe('formatCallTime', () => {
  it('writes m:ss, then h:mm:ss', () => {
    expect(formatCallTime(0)).toBe('0:00');
    expect(formatCallTime(245.9)).toBe('4:05');
    expect(formatCallTime(3_729)).toBe('1:02:09');
    expect(formatCallTime(-5)).toBe('0:00');
  });
});
