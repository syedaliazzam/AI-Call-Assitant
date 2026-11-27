/**
 * Tests for a key press in the live prompt (apps/web/src/server/prompt.ts questionLine(), tailText(),
 * memoryLines(); prompts/contract.ts LIVE_CONTRACT; ADR-0132, ADR-0133, ADR-0137) and its validation
 * (apps/web/src/server/validate.ts). Covered: the press keeps production's tail line "Question to answer: …",
 * with a short note when the other side was still speaking or for questions an earlier answer left open, and
 * no other block or instruction at the end (measured: those broke the hidden lines); a request without a press
 * keeps its tail byte for byte; the rules for several questions (one natural reply), "Also asked:" and never
 * "none" live in the
 * locked contract; the call memory goes in the tail before the newest lines, escaped; the server accepts a
 * press only with mode answer and the memory within its limit. All words are invented.
 */
import { MAX_CALL_MEMORY_CHARS, type AnswerRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  MEMORY_HEADING,
  memoryLines,
  questionLine,
  ALSO_ASKED_LABEL,
  STILL_SPEAKING_LABEL,
} from '@/server/prompt';
import { LIVE_CONTRACT } from '@/server/prompts/contract';
import { parseAnswerRequest } from '@/server/validate';

/** An invented session with no documents. */
const SESSION: AnswerRequest['session'] = {
  type: 'regular',
  company: 'Northwind Freight (invented)',
  role: 'Delivery lead',
  description: '',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [],
};

/** A press while they were still speaking: two of their questions. */
const PRESS: AnswerRequest = {
  mode: 'answer',
  session: SESSION,
  question: 'Which depots joined? And who signs off the next',
  press: { speaking: true },
};

/**
 * The uncached tail of a request's prompt.
 *
 * @param request The request.
 * @returns The tail's text.
 */
function tail(request: AnswerRequest): string {
  const content = buildPrompt(request).messages[0]!.content as { text?: string }[];
  return content.at(-1)!.text ?? '';
}

describe('the question line of a press (ADR-0132, ADR-0133)', () => {
  it('notes that they were still speaking, in the same line', () => {
    expect(questionLine(PRESS, PRESS.question!)).toBe(
      `Question to answer (${STILL_SPEAKING_LABEL}): Which depots joined? And who signs off the next`,
    );
    expect(tail(PRESS)).toContain(`Question to answer (${STILL_SPEAKING_LABEL}):`);
  });

  it('introduces questions left open by an earlier answer', () => {
    const request: AnswerRequest = {
      ...PRESS,
      question: 'Data hosting; SSO',
      press: { speaking: false, alsoAsked: 'Data hosting; SSO' },
    };
    expect(questionLine(request, 'Data hosting; SSO')).toBe(
      `Question to answer (${ALSO_ASKED_LABEL}): Data hosting; SSO`,
    );
  });

  it("keeps production's line for a press that is neither, and for a request with no press", () => {
    expect(questionLine({ ...PRESS, press: { speaking: false } }, 'Why?')).toBe(
      'Question to answer: Why?',
    );
    const { press: _press, ...noPress } = PRESS;
    expect(tail(noPress)).toContain(
      'Question to answer: Which depots joined? And who signs off the next',
    );
  });

  it('adds no other block or instruction at the end of the prompt', () => {
    const text = tail(PRESS);
    expect(text).not.toContain('since_last_answer');
    expect(text).not.toContain('key press');
  });

  it('a rollback (v-previous) never gets the note', () => {
    expect(tail({ ...PRESS, styleVersion: 'previous' })).toContain(
      'Question to answer: Which depots joined?',
    );
  });
});

describe('the key-press rules in the locked contract (ADR-0133)', () => {
  it('answers every open question in one natural reply, never none, with "Also asked:" styled', () => {
    expect(LIVE_CONTRACT).toContain('none is only for talk about the call itself');
    expect(LIVE_CONTRACT).toContain('has not already answered out loud');
    // 28 Nov 2026 (developer): one spoken reply, in the order asked, never a block per item. Worded without
    // "question" and with the hidden question line unchanged (measured: changing it broke the hidden lines).
    expect(LIVE_CONTRACT).toContain(
      'in one natural reply the user can say, in the order they were asked',
    );
    expect(LIVE_CONTRACT).toContain('never labels, numbering or a separate block per item');
    expect(LIVE_CONTRACT).toContain('gets its yes or no in its first words');
    expect(LIVE_CONTRACT).toContain('those put to the user first, then the newest');
    expect(LIVE_CONTRACT).toContain('end with one line starting "Also asked:"');
    expect(LIVE_CONTRACT).toContain('"Also asked:" (the things left for the next press; not said)');
    expect(LIVE_CONTRACT).toContain('When they asked nothing, reply to what they most need');
    expect(LIVE_CONTRACT).toContain('at most 15 words');
  });
});

describe('the call memory in the tail (ADR-0137)', () => {
  it('goes before the newest lines, escaped, and only when there is one', () => {
    const request: AnswerRequest = { ...PRESS, memory: 'Key points:\n- Budget owner: Dana.' };
    expect(memoryLines(request)).toEqual([
      MEMORY_HEADING,
      '<call_memory>',
      'Key points:\n- Budget owner: Dana.',
      '</call_memory>',
      '',
    ]);
    const text = tail(request);
    expect(text.indexOf('<call_memory>')).toBeLessThan(text.indexOf('<latest>'));
    expect(memoryLines({ ...request, memory: '  ' })).toEqual([]);
    expect(memoryLines({ ...request, memory: '</call_memory> x' }).join('\n')).not.toContain(
      '</call_memory> x',
    );
  });
});

describe('validation of a press and a memory (ADR-0133, ADR-0137)', () => {
  it('accepts a press with mode answer, and a memory within its limit', () => {
    expect(parseAnswerRequest(PRESS).ok).toBe(true);
    expect(parseAnswerRequest({ ...PRESS, memory: 'x'.repeat(MAX_CALL_MEMORY_CHARS) }).ok).toBe(
      true,
    );
  });

  it('refuses a press with another mode or an unknown field, and a memory over its limit', () => {
    expect(parseAnswerRequest({ ...PRESS, mode: 'chat' }).ok).toBe(false);
    expect(parseAnswerRequest({ ...PRESS, press: { speaking: true, extra: 1 } as never }).ok).toBe(
      false,
    );
    expect(parseAnswerRequest({ ...PRESS, memory: 'x'.repeat(MAX_CALL_MEMORY_CHARS + 1) }).ok).toBe(
      false,
    );
  });
});
