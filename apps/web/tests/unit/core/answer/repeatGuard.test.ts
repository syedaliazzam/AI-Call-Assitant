/**
 * Tests apps/web/src/core/answer/repeatGuard.ts (v1.0.1): Answer is idempotent. A second trigger
 * while an answer streams is ignored; the same question (ignoring case, spacing and punctuation)
 * within 3 s is ignored; a different question, or the same one after 3 s, is answered.
 */
import { describe, expect, it } from 'vitest';
import { createRepeatGuard, REPEAT_WINDOW_MS } from '@/core/answer/repeatGuard';

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
