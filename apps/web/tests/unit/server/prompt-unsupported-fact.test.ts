/**
 * Tests for the unsupported-fact sentence (ADR-0088), UNSUPPORTED_FACT_RULE in
 * apps/web/src/server/prompts/contract.ts, kept word for word at the end of the automatic end reminder
 * (ADR-0089):
 * it is in the tail of every current-rules answer (not v-previous, so a rollback keeps its bytes); it
 * forbids yes/no and guessing, asks for a short promise with no bullets and a Note; it keeps the hidden
 * lines' order (first line, answer, Note, [[question|…]]); it leaves small talk and off-topic questions
 * out; its example answer lines are 12 words or fewer; and (ADR-0090) it keeps the promise away from a
 * fact the documents cover, even as a limit, which is answered from them, declining what they do not allow.
 */
import type { AnswerRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@/server/prompt';
import { UNSUPPORTED_FACT_RULE } from '@/server/prompts/contract';
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
    expect(sentence).toContain('never answer yes or no and never guess');
    expect(sentence).toContain('after the hidden first line as always');
    expect(sentence).toContain('with no bullets at all');
    expect(sentence).toContain(
      'then a "Note:" line naming what to check, then the hidden [[question|…]] line.',
    );
    expect(sentence).toContain('not small talk or an off-topic question');
  });

  it('applies only to a fact nothing gives, not one the documents cover as a limit (ADR-0090)', () => {
    expect(sentence).toContain('This promise is only for a fact nothing gives');
    expect(sentence).toContain('even as a limit (such as the most discount allowed)');
    expect(sentence).toContain('say plainly what they do not allow');
  });

  it('gives example answer lines of 12 words or fewer', () => {
    const examples = [...sentence.matchAll(/"(I'll confirm[^"]*)"/g)].map((match) => match[1]!);
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) expect(example.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it('is in the tail of a current-rules answer, and not in a rollback (v-previous) answer', () => {
    expect(tail(REQUEST).trimEnd().endsWith(UNSUPPORTED_FACT_RULE)).toBe(true);
    const rollback = tail({ ...REQUEST, styleVersion: 'previous' });
    expect(rollback).toContain(CALL_REMINDER_PREVIOUS);
    expect(rollback).not.toContain('never answer yes or no');
  });
});
