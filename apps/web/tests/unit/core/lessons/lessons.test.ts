/**
 * Tests for apps/web/src/core/lessons (match.ts, decide.ts, active.ts), Day 5 Stage 7:
 * - matching: the same normalised text, or a reworded proposal from the same session whose
 *   words overlap ≥ 80%, is the same lesson; a different lesson, or one from another session,
 *   is not;
 * - decisions: approve and reject are stored; nothing is stored without a decision; deciding
 *   on a reworded proposal after Regenerate changes the earlier decision instead of adding one,
 *   keeping its approval time; edits are cleaned to one line of at most 200 characters; an
 *   empty lesson is refused; remove and clear work;
 * - active lessons: approved only, for all calls or this session type, oldest approval first
 *   (an edit does not move a lesson), at most 20 (the newest approvals).
 * All text is invented.
 */
import 'fake-indexeddb/auto';
import { MAX_ACTIVE_LESSONS, MAX_LESSON_CHARS, type ProposedLesson } from '@kite/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { activeLessons, loadActiveLessons } from '@/core/lessons/active';
import { clearLessons, decideLesson, editLesson, removeLesson } from '@/core/lessons/decide';
import {
  findDecision,
  lessonOverlap,
  LESSON_MATCH_OVERLAP,
  normaliseLesson,
} from '@/core/lessons/match';
import { listLessons } from '@/core/storage/lessons';
import type { StoredLesson } from '@/core/storage/types';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

/** A proposal from the notes. */
const PROPOSAL: ProposedLesson = {
  text: 'Give the monthly and yearly totals for the seat count they mention.',
  evidence: 'The 40-seat price answer was rated down with that note.',
};

/** The same lesson, reworded by a regenerated set of notes. */
const REWORDED = 'Give monthly and yearly totals for the seat count they mention';

/** A different lesson. */
const OTHER = 'Answer in first person when the session is an interview.';

describe('match', () => {
  it('normalises case, punctuation and numbers', () => {
    expect(normaliseLesson('Give prices for 40 seats!')).toBe('give prices for forty seats');
  });

  it('treats a reworded proposal as the same lesson, and a different one as not', () => {
    expect(lessonOverlap(PROPOSAL.text, REWORDED)).toBeGreaterThanOrEqual(LESSON_MATCH_OVERLAP);
    expect(lessonOverlap(PROPOSAL.text, OTHER)).toBeLessThan(LESSON_MATCH_OVERLAP);
    expect(lessonOverlap('', OTHER)).toBe(0);
  });

  it('finds a decision by its source text, a reworded proposal or the edited text, in this session only', () => {
    const decision: StoredLesson = {
      id: 'd1',
      text: 'Always give monthly and yearly totals.',
      scope: 'regular',
      status: 'approved',
      sourceSessionId: 's1',
      sourceKey: normaliseLesson(PROPOSAL.text),
      evidence: '',
      decidedAt: 1,
      approvedAt: 1,
    };
    expect(findDecision(PROPOSAL.text, 's1', [decision])).toBe(decision);
    expect(findDecision(REWORDED, 's1', [decision])).toBe(decision);
    expect(findDecision('Always give the monthly and yearly totals', 's1', [decision])).toBe(
      decision,
    );
    expect(findDecision(OTHER, 's1', [decision])).toBeNull();
    expect(findDecision(PROPOSAL.text, 's2', [decision])).toBeNull();
  });
});

describe('decide', () => {
  it('stores nothing without a decision; approve and reject are stored', async () => {
    expect(await listLessons()).toEqual([]);
    const approved = await decideLesson(
      {
        sessionId: 's1',
        proposal: PROPOSAL,
        status: 'approved',
        text: PROPOSAL.text,
        scope: 'regular',
      },
      100,
    );
    expect(approved).toMatchObject({
      status: 'approved',
      scope: 'regular',
      approvedAt: 100,
      sourceSessionId: 's1',
      evidence: PROPOSAL.evidence,
    });
    await decideLesson(
      {
        sessionId: 's1',
        proposal: { text: OTHER, evidence: 'e' },
        status: 'rejected',
        text: OTHER,
        scope: 'all',
      },
      200,
    );
    expect((await listLessons()).map((row) => row.status)).toEqual(['approved', 'rejected']);
  });

  it('after Regenerate, a reworded proposal changes the earlier decision instead of adding one', async () => {
    const first = await decideLesson(
      {
        sessionId: 's1',
        proposal: PROPOSAL,
        status: 'approved',
        text: PROPOSAL.text,
        scope: 'regular',
      },
      100,
    );
    // The regenerated notes propose it in other words; the user approves it with an edit.
    const second = await decideLesson(
      {
        sessionId: 's1',
        proposal: { text: REWORDED, evidence: 'again' },
        status: 'approved',
        text: 'Give monthly and yearly totals.',
        scope: 'all',
      },
      500,
    );
    expect(second.id).toBe(first.id);
    expect(second.approvedAt).toBe(100);
    expect(await listLessons()).toHaveLength(1);
    expect((await listLessons())[0]).toMatchObject({
      text: 'Give monthly and yearly totals.',
      scope: 'all',
    });
  });

  it('cleans edits to one line of at most 200 characters, and refuses an empty lesson', async () => {
    const lesson = await decideLesson(
      {
        sessionId: 's1',
        proposal: PROPOSAL,
        status: 'approved',
        text: `  Line one\n\nline   two ${'x'.repeat(300)}`,
        scope: 'all',
      },
      1,
    );
    expect(lesson.text.startsWith('Line one line two x')).toBe(true);
    expect(lesson.text.length).toBe(MAX_LESSON_CHARS);
    await editLesson(lesson.id, ' Edited\nlesson ', 'regular');
    expect((await listLessons())[0]).toMatchObject({ text: 'Edited lesson', scope: 'regular' });
    await expect(editLesson(lesson.id, ' \n ', 'all')).rejects.toThrow('EMPTY_LESSON');
    await expect(
      decideLesson({
        sessionId: 's1',
        proposal: PROPOSAL,
        status: 'approved',
        text: ' ',
        scope: 'all',
      }),
    ).rejects.toThrow('EMPTY_LESSON');
  });

  it('removes one decision, or all of them', async () => {
    const a = await decideLesson(
      {
        sessionId: 's1',
        proposal: PROPOSAL,
        status: 'approved',
        text: PROPOSAL.text,
        scope: 'all',
      },
      1,
    );
    await decideLesson(
      {
        sessionId: 's1',
        proposal: { text: OTHER, evidence: '' },
        status: 'rejected',
        text: OTHER,
        scope: 'all',
      },
      2,
    );
    await removeLesson(a.id);
    expect(await listLessons()).toHaveLength(1);
    expect(await clearLessons()).toBe(1);
    expect(await listLessons()).toEqual([]);
  });
});

describe('activeLessons', () => {
  /**
   * An invented decision.
   *
   * @param id         Id.
   * @param changes    Fields to replace.
   * @returns The decision.
   */
  function lesson(id: string, changes: Partial<StoredLesson>): StoredLesson {
    return {
      id,
      text: `Lesson ${id}`,
      scope: 'all',
      status: 'approved',
      sourceSessionId: 's1',
      sourceKey: `lesson ${id}`,
      evidence: '',
      decidedAt: 1,
      approvedAt: 1,
      ...changes,
    };
  }

  it('approved, for all calls or this type, oldest approval first', () => {
    const rows = [
      lesson('c', { approvedAt: 30 }),
      lesson('a', { approvedAt: 10, scope: 'regular' }),
      lesson('x', { approvedAt: 5, scope: 'interview' }),
      lesson('r', { status: 'rejected', approvedAt: null }),
      lesson('b', { approvedAt: 20, text: 'Lesson b, edited later' }),
    ];
    expect(activeLessons(rows, 'regular')).toEqual([
      'Lesson a',
      'Lesson b, edited later',
      'Lesson c',
    ]);
    expect(activeLessons(rows, 'interview')).toEqual([
      'Lesson x',
      'Lesson b, edited later',
      'Lesson c',
    ]);
  });

  it('sends at most 20: the newest approvals, still oldest first', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      lesson(`l${i}`, { approvedAt: i, text: `L${i}` }),
    );
    const active = activeLessons(rows, 'regular');
    expect(active).toHaveLength(MAX_ACTIVE_LESSONS);
    expect(active[0]).toBe('L5');
    expect(active.at(-1)).toBe('L24');
  });

  it('loads from this device', async () => {
    await decideLesson(
      {
        sessionId: 's1',
        proposal: PROPOSAL,
        status: 'approved',
        text: 'Give totals.',
        scope: 'regular',
      },
      1,
    );
    expect(await loadActiveLessons('regular')).toEqual(['Give totals.']);
    expect(await loadActiveLessons('mock')).toEqual([]);
  });
});
