/**
 * Tests for the live prompt's tail with a key press and the call memory (apps/web/src/server/prompt.ts
 * tailText(), memoryLines(); ADR-0132, ADR-0137) and their validation (apps/web/src/server/validate.ts).
 * Covered: a press keeps production's tail line "Question to answer: …" (the press window stays on the
 * device, ADR-0132); the call memory goes in the tail before the newest lines, escaped, only when there is
 * one, so a request without a memory keeps production's tail byte for byte; the server accepts a memory
 * within its limit. All words are invented.
 */
import { MAX_CALL_MEMORY_CHARS, type AnswerRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { buildPrompt, MEMORY_HEADING, memoryLines } from '@/server/prompt';
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

/** A press's request, as the page sends it. */
const PRESS: AnswerRequest = {
  mode: 'answer',
  session: SESSION,
  question: 'Which depots joined? And who signs off the next',
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

describe('the tail of a press (ADR-0132)', () => {
  it('is production\'s "Question to answer: …" line, with no memory block when there is no memory', () => {
    const text = tail(PRESS);
    expect(text).toContain('Question to answer: Which depots joined? And who signs off the next');
    expect(text).not.toContain('call_memory');
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

  it('is accepted within its limit and refused over it', () => {
    expect(parseAnswerRequest({ ...PRESS, memory: 'x'.repeat(MAX_CALL_MEMORY_CHARS) }).ok).toBe(
      true,
    );
    expect(parseAnswerRequest({ ...PRESS, memory: 'x'.repeat(MAX_CALL_MEMORY_CHARS + 1) }).ok).toBe(
      false,
    );
  });
});
