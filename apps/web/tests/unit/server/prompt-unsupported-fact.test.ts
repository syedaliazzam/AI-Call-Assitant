/**
 * Tests for the unsupported-fact sentence of CALL_REMINDER in apps/web/src/server/prompt.ts (ADR-0088):
 * it is in the tail of every current-rules answer (not v-previous, so a rollback keeps its bytes); it
 * forbids yes/no and guessing, asks for a short promise with no bullets and a Note; it keeps the hidden
 * lines' order (first line, answer, Note, [[question|…]]); it leaves small talk and off-topic questions
 * out; and its example answer lines are 12 words or fewer.
 */
import type { AnswerRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { buildPrompt, CALL_REMINDER } from '@/server/prompt';
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
  const sentence = CALL_REMINDER.slice(CALL_REMINDER.indexOf('When they ask about your company'));

  it('says what to do instead of answering yes or no, and keeps the hidden lines in order', () => {
    expect(sentence).toContain('never answer yes or no and never guess');
    expect(sentence).toContain('after the hidden first line as always');
    expect(sentence).toContain('with no bullets at all');
    expect(sentence).toContain(
      'then a "Note:" line naming what to check, then the hidden [[question|…]] line.',
    );
    expect(sentence).toContain('not small talk or an off-topic question');
  });

  it('gives example answer lines of 12 words or fewer', () => {
    const examples = [...sentence.matchAll(/"(I'll confirm[^"]*)"/g)].map((match) => match[1]!);
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) expect(example.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it('is in the tail of a current-rules answer, and not in a rollback (v-previous) answer', () => {
    expect(tail(REQUEST)).toContain('never answer yes or no and never guess');
    const rollback = tail({ ...REQUEST, styleVersion: 'previous' });
    expect(rollback).toContain(CALL_REMINDER_PREVIOUS);
    expect(rollback).not.toContain('never answer yes or no');
  });
});
