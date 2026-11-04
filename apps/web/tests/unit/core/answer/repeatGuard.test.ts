/**
 * Tests apps/web/src/core/answer/repeatGuard.ts (v1.0.1, widened in v1.0.2): Answer is
 * idempotent. A second trigger while an answer streams is ignored; the same question (ignoring
 * case, spacing and punctuation) within 3 s is ignored; a different question, or the same one after
 * 3 s, is answered. v1.0.2: speech already answered is never answered again by auto-answer, and a
 * manual press for it within 10 s shows the existing answer, whatever the words now say.
 */
import { describe, expect, it } from 'vitest';
import {
  createRepeatGuard,
  REPEAT_WINDOW_MS,
  sameSpeech,
  SHOW_EXISTING_MS,
} from '@/core/answer/repeatGuard';

const QUESTION = 'WHAT HAPPENS WHEN THE SOURCES DO NOT COVER THE QUESTION';

describe('createRepeatGuard', () => {
  it('ignores the same question twice within 3 s (the shortcut and the overlay both firing)', () => {
    const guard = createRepeatGuard();
    expect(guard.accept({ question: QUESTION, streaming: false, now: 1_000 })).toBe(true);
    expect(
      guard.accept({
        question: 'what happens when the sources do not cover the question?',
        streaming: false,
        now: 3_000,
      }),
    ).toBe(false);
  });

  it('ignores any trigger while an answer is streaming', () => {
    const guard = createRepeatGuard();
    expect(guard.accept({ question: 'Another question', streaming: true, now: 1_000 })).toBe(false);
  });

  it('answers a different question at once, and the same one again after 3 s', () => {
    const guard = createRepeatGuard();
    expect(guard.accept({ question: QUESTION, streaming: false, now: 0 })).toBe(true);
    expect(guard.accept({ question: 'How is it priced', streaming: false, now: 500 })).toBe(true);
    expect(guard.accept({ question: QUESTION, streaming: false, now: 600 })).toBe(true);
    expect(
      guard.accept({ question: QUESTION, streaming: false, now: 600 + REPEAT_WINDOW_MS }),
    ).toBe(true);
  });
});

describe('createRepeatGuard: the same speech (v1.0.2)', () => {
  const span = { start: 10_000, end: 14_000 };

  it('auto-answer after a slow manual answer is ignored (the v1.0.1 gap)', () => {
    const guard = createRepeatGuard();
    expect(guard.decide({ question: QUESTION, streaming: false, now: 0, span })).toEqual({
      kind: 'answer',
    });
    guard.remember(span, 'a1', 0);
    // The manual answer streamed for 5 s; auto-answer fires when it finishes.
    expect(
      guard.decide({ question: QUESTION, streaming: false, now: 5_000, span, auto: true }),
    ).toEqual({ kind: 'ignore' });
    // Still ignored a minute later: auto-answer never repeats speech.
    expect(
      guard.decide({ question: QUESTION, streaming: false, now: 60_000, span, auto: true }),
    ).toEqual({ kind: 'ignore' });
  });

  it('the same speech with different words (words settling, accurate engine) shows the answer', () => {
    const guard = createRepeatGuard();
    guard.decide({ question: 'what happens when i type a url', streaming: false, now: 0, span });
    guard.remember(span, 'a1', 0);
    // The grey line's end was "when it last changed"; the finished line ends a little later.
    const settled = { start: 10_050, end: 14_400 };
    expect(
      guard.decide({
        question: 'What happens when I type a URL into the browser?',
        streaming: false,
        now: 1_000,
        span: settled,
      }),
    ).toEqual({ kind: 'show', answerId: 'a1' });
  });

  it('a manual press for answered speech after 10 s is a deliberate new answer', () => {
    const guard = createRepeatGuard();
    guard.decide({ question: QUESTION, streaming: false, now: 0, span });
    guard.remember(span, 'a1', 0);
    expect(
      guard.decide({ question: QUESTION, streaming: false, now: SHOW_EXISTING_MS + 1, span }),
    ).toEqual({ kind: 'answer' });
  });

  it('new speech from Them after the answered speech is a new question', () => {
    const guard = createRepeatGuard();
    guard.remember(span, 'a1', 0);
    expect(
      guard.decide({
        question: 'And how is it priced',
        streaming: false,
        now: 1_000,
        span: { start: 16_000, end: 18_000 },
        auto: true,
      }),
    ).toEqual({ kind: 'answer' });
  });
});

describe('sameSpeech', () => {
  it('is the same when nothing ended later than the answered speech (within the slack)', () => {
    const answered = { start: 1_000, end: 5_000 };
    expect(sameSpeech({ start: 1_000, end: 5_000 }, answered)).toBe(true);
    expect(sameSpeech({ start: 1_200, end: 5_600 }, answered)).toBe(true);
    expect(sameSpeech({ start: 1_000, end: 6_000 }, answered)).toBe(false);
    expect(sameSpeech({ start: 0, end: 200 }, answered)).toBe(false);
  });
});

describe('createRepeatGuard: looking back (v1.1.0, ADR-0043)', () => {
  it('shows the answer that exists, however long ago, when Answer went back to a question', () => {
    const guard = createRepeatGuard();
    const span = { start: 1_000, end: 2_000 };
    expect(guard.decide({ question: QUESTION, streaming: false, now: 5_000, span }).kind).toBe(
      'answer',
    );
    guard.remember(span, 'a1', 5_000);
    const later = 5_000 + 60 * 60_000;
    expect(guard.decide({ question: QUESTION, streaming: false, now: later, span }).kind).toBe(
      'answer',
    );
    expect(
      guard.decide({ question: QUESTION, streaming: false, now: later, span, lookedBack: true }),
    ).toEqual({ kind: 'show', answerId: 'a1' });
  });
});
