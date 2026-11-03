/**
 * Tests apps/web/src/core/answer/answerType.ts (v1.0.1): the same question keeps its first label
 * in a call, and a clearly technical question the model labelled behavioural or small talk is
 * shown as a technical concept, unless it asks about the user's past. Questions are from the real
 * call that showed the drift.
 */
import { describe, expect, it } from 'vitest';
import { settleAnswerType } from '@/core/answer/answerType';

describe('settleAnswerType', () => {
  it('shows a technical "what happens when…" question as a concept, not behavioural', () => {
    expect(
      settleAnswerType("What happens when the sources don't cover the question", 'behavioural', []),
    ).toBe('concept');
    expect(settleAnswerType('How does the system rank the documents', 'smalltalk', [])).toBe(
      'concept',
    );
  });

  it('keeps a real past-experience question behavioural', () => {
    expect(
      settleAnswerType(
        'Tell me about a time when you had to explain how the system works',
        'behavioural',
        [],
      ),
    ).toBe('behavioural');
  });

  it('gives the same question the same label as the first time', () => {
    const earlier = [
      { question: 'HOW DID YOU GET INTO DATA ENGINEERING', type: 'smalltalk' as const },
    ];
    expect(settleAnswerType('how did you get into data engineering?', 'behavioural', earlier)).toBe(
      'smalltalk',
    );
  });

  it("leaves the model's type for other questions", () => {
    expect(settleAnswerType('What does the Professional plan cost', 'sales', [])).toBe('sales');
  });
});
