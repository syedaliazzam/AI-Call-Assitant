/**
 * Tests for apps/web/src/core/storage/answers.ts, on an in-memory IndexedDB (fake-indexeddb):
 * saveAnswer() stores an answer (and replaces one with the same id); listAnswers() returns one
 * session's answers oldest first; rateAnswer() sets and removes a rating; setAnswerNote()
 * trims and caps the note; both throw ANSWER_NOT_FOUND for an unknown id; deleting the session
 * deletes its answers. All text is invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  countAnswersBySession,
  MAX_NOTE_CHARS,
  listAnswers,
  rateAnswer,
  reportAnswer,
  saveAnswer,
  setAnswerNote,
} from '@/core/storage/answers';
import { createSession, deleteSession } from '@/core/storage/sessions';
import type { StoredAnswer } from '@/core/storage/types';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/**
 * An invented answer.
 *
 * @param id        Answer id.
 * @param sessionId Session it belongs to.
 * @param createdAt When it was asked (Unix ms).
 * @returns The answer.
 */
function answer(id: string, sessionId: string, createdAt: number): StoredAnswer {
  return {
    id,
    sessionId,
    mode: 'answer',
    question: 'Invented question?',
    text: 'Invented answer.',
    model: 'fast',
    msFirstToken: 600,
    msTotal: 1_200,
    createdAt,
    rating: null,
    note: '',
  };
}

describe('answers', () => {
  it('counts answers per session, and has no entry for a session with none', async () => {
    expect((await countAnswersBySession()).size).toBe(0);
    await saveAnswer(answer('a1', 's1', 1_000));
    await saveAnswer(answer('a2', 's1', 2_000));
    await saveAnswer(answer('x1', 's2', 500));
    const counts = await countAnswersBySession();
    expect(counts.get('s1')).toBe(2);
    expect(counts.get('s2')).toBe(1);
    expect(counts.has('s3')).toBe(false);
  });

  it('saves and lists one session’s answers, oldest first', async () => {
    await saveAnswer(answer('a2', 's1', 2_000));
    await saveAnswer(answer('a1', 's1', 1_000));
    await saveAnswer(answer('x1', 's2', 500));
    expect((await listAnswers('s1')).map((row) => row.id)).toEqual(['a1', 'a2']);
    await saveAnswer({ ...answer('a1', 's1', 1_000), text: 'Replaced.' });
    expect((await listAnswers('s1'))[0]!.text).toBe('Replaced.');
  });

  it('rates an answer, and removes the rating', async () => {
    await saveAnswer(answer('a1', 's1', 1_000));
    await rateAnswer('a1', 'down');
    expect((await listAnswers('s1'))[0]!.rating).toBe('down');
    await rateAnswer('a1', 'down');
    await rateAnswer('a1', null);
    expect((await listAnswers('s1'))[0]!.rating).toBeNull();
  });

  it('saves a trimmed, capped note', async () => {
    await saveAnswer(answer('a1', 's1', 1_000));
    await setAnswerNote('a1', '  Give the price per seat.  ');
    expect((await listAnswers('s1'))[0]!.note).toBe('Give the price per seat.');
    await setAnswerNote('a1', 'x'.repeat(MAX_NOTE_CHARS + 50));
    expect((await listAnswers('s1'))[0]!.note).toHaveLength(MAX_NOTE_CHARS);
  });

  it('throws ANSWER_NOT_FOUND for an unknown answer', async () => {
    await expect(rateAnswer('none', 'up')).rejects.toThrow('ANSWER_NOT_FOUND');
    await expect(setAnswerNote('none', 'x')).rejects.toThrow('ANSWER_NOT_FOUND');
  });

  it('deleting the session deletes its answers', async () => {
    const session = await createSession({
      type: 'regular',
      company: 'Invented Co',
      role: '',
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
    });
    await saveAnswer(answer('a1', session.id, 1_000));
    await saveAnswer(answer('a2', session.id, 2_000));
    await deleteSession(session.id);
    expect(await listAnswers(session.id)).toEqual([]);
  });
});

describe('reportAnswer (ADR-0029)', () => {
  it('marks the answer and keeps the note; an empty note keeps the earlier one', async () => {
    const session = await createSession(sessionInput());
    await saveAnswer({
      id: 'r1',
      sessionId: session.id,
      mode: 'answer',
      question: 'Invented question?',
      text: 'Invented answer.',
      model: 'fast',
      msFirstToken: 1,
      msTotal: 2,
      createdAt: 3,
      rating: null,
      note: '',
    });
    await reportAnswer('r1', '  The price was wrong.  ');
    let [saved] = await listAnswers(session.id);
    expect(saved?.reported).toBe(true);
    expect(saved?.note).toBe('The price was wrong.');
    await reportAnswer('r1', '');
    [saved] = await listAnswers(session.id);
    expect(saved?.note).toBe('The price was wrong.');
    await expect(reportAnswer('missing', '')).rejects.toThrow('ANSWER_NOT_FOUND');
  });
});
