/**
 * Tests for the unsupported-fact sentence (ADR-0088), UNSUPPORTED_FACT_RULE in
 * apps/web/src/server/prompts/contract.ts, kept word for word at the end of the automatic end reminder
 * (ADR-0089):
 * it is in the tail of every current-rules answer (not v-previous, so a rollback keeps its bytes); it
 * forbids yes/no and guessing, asks (ADR-0134) for a line that keeps the call moving, at most one more line
 * (a helpful question or a related stated fact), never "not sure", and a Note; it keeps the hidden
 * lines' order (first line, answer, Note, [[question|…]]); it leaves small talk and off-topic questions
 * out; its example answer lines are 12 words or fewer; and (ADR-0090) it keeps the promise away from a
 * fact the documents cover, even as a limit, which is answered from them, declining what they do not allow.
 */
import type { AnswerRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@/server/prompt';
import { GENERAL_KNOWLEDGE_RULE, UNSUPPORTED_FACT_RULE } from '@/server/prompts/contract';
import { CALL_REMINDER_PREVIOUS } from '@/server/prompts/rules-previous';

/** An invented answer request. */
const REQUEST: AnswerRequest = {
  mode: 'answer',
  session: {
    type: 'regular',
    company: 'Northwind (invented)',
    role: '',
    description: '',
    instructions: '',
    keyTerms: [],
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    documents: [],
  },
  question: 'Do you host our data in Germany?',
};

/**
 * The uncached tail text of a request's prompt.
 *
 * @param request The request.
 * @returns The tail.
 */
function tail(request: AnswerRequest): string {
  const content = buildPrompt(request).messages[0]!.content as { text?: string }[];
  return content.at(-1)!.text ?? '';
}

describe('the unsupported-fact sentence (ADR-0088)', () => {
  const sentence = UNSUPPORTED_FACT_RULE;

  it('says what to do instead of answering yes or no, and keeps the hidden lines in order', () => {
    // ADR-0134: the one hard rule, with a confident line and what can be said, never a bare hedge.
    expect(sentence).toContain('The one hard rule: never invent a specific fact');
    expect(sentence).toContain('never answer yes or no to it and never guess it');
    expect(sentence).toContain('a yes or a no about what you offer, support, host or commit to');
    expect(sentence).toContain('then what you can stand behind');
    expect(sentence).toContain('Never say "not sure" or "I don\'t know"');
    expect(sentence).toContain(
      'then a "Note:" line naming what to check, then the hidden [[question|…]] line.',
    );
  });

  it('applies only to a fact nothing gives, not one the documents cover as a limit (ADR-0090)', () => {
    expect(sentence).toContain('When such a fact is asked for and nothing gives it');
    expect(sentence).toContain(
      'a range or a limit (such as the most discount allowed), say it as given',
    );
  });

  it('gives example answer lines of 12 words or fewer', () => {
    const examples = [...sentence.matchAll(/"((?:I'll|Let me) [^"]*)"/g)].map((match) => match[1]!);
    expect(examples.length).toBeGreaterThanOrEqual(1);
    for (const example of examples) expect(example.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it('is in the tail of a current-rules answer, and not in a rollback (v-previous) answer', () => {
    // ADR-0103: the general-knowledge limit follows it, so the ADR-0088 sentence stays word for word.
    expect(
      tail(REQUEST).trimEnd().endsWith(`${UNSUPPORTED_FACT_RULE} ${GENERAL_KNOWLEDGE_RULE}`),
    ).toBe(true);
    const rollback = tail({ ...REQUEST, styleVersion: 'previous' });
    expect(rollback).toContain(CALL_REMINDER_PREVIOUS);
    expect(rollback).not.toContain('never answer yes or no');
  });
});

describe('the general-knowledge limit on the promise (ADR-0103)', () => {
  it('keeps "I\'ll confirm" to company or offer facts, never general knowledge', () => {
    expect(GENERAL_KNOWLEDGE_RULE).toContain(
      'Everything that is not such a specific fact (how a technology',
    );
    expect(GENERAL_KNOWLEDGE_RULE).toContain('with no promise to confirm and no hedging');
  });

  it('ADR-0134: the reminder asks for a confident reply, and keeps CV projects as the CV states them', () => {
    const text = tail(REQUEST);
    expect(text).toContain('always give a confident reply the user can say as it is');
    expect(text).toContain('keep every real CV project as the CV states it');
    expect(text).not.toContain('add no detail the session');
  });
});
