/**
 * Tests apps/web/src/server/budget.ts and its use in src/server/prompt.ts buildPrompt() (Batch C, P2-1):
 * - every live answer request stays under MAX_ANSWER_INPUT_TOKENS whatever the documents' size: 500k
 *   characters of documents from an older page (every document in full), the most of every other field,
 *   with and without a screenshot;
 * - the session block's ceiling depends only on the session, so the warm-up and the answers send the same
 *   cached bytes; a session under it is sent unchanged (byte for byte);
 * - a current page's request (CV + documents summary) puts the summary in the cached session block and the
 *   matching document parts in the uncached tail, escaped;
 * - only when the counted prompt is still too big do the document parts, the similar answer, the oldest
 *   "latest" lines and the oldest conversation chunks go, in that order.
 * All text is invented.
 */
import {
  MAX_ANSWER_INPUT_TOKENS,
  MAX_DOCUMENT_CHUNK_CHARS,
  MAX_DOCUMENT_CHUNKS,
  MAX_LINE_CHARS,
  MAX_SESSION_DOCUMENT_CHARS,
  MAX_TAIL_LINES,
  type AnswerRequest,
  type SessionContext,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_TOKENS,
  capSessionDocuments,
  countPromptTokens,
  fitToBudget,
  SESSION_BLOCK_MAX_CHARS,
  SHORTENED_NOTE,
} from '@/server/budget';
import { buildPrompt, DOCUMENT_PARTS_HEADING, sessionBlock } from '@/server/prompt';

/** An invented session. */
const BASE: SessionContext = {
  type: 'interview',
  company: 'Northwind',
  role: 'Backend engineer',
  description: 'Second round.',
  instructions: 'Keep it short.',
  keyTerms: ['Bluefin'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'cv.txt', text: 'Built a rate limiter in Go.', kind: 'resume' }],
};

/** A tiny JPEG data URL (validation is not run here). */
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQ';

/**
 * Text of a given length.
 *
 * @param chars How many characters.
 * @returns The text.
 */
function text(chars: number): string {
  return 'word '.repeat(Math.ceil(chars / 5)).slice(0, chars);
}

/**
 * The largest request the other limits allow, with 500k characters of documents in full (an older page).
 *
 * @param mode The mode.
 * @returns The request.
 */
function hugeRequest(mode: AnswerRequest['mode'] = 'answer'): AnswerRequest {
  return {
    mode,
    session: {
      ...BASE,
      description: text(5_000),
      instructions: text(5_000),
      documents: [
        { name: 'cv.txt', text: text(100_000), kind: 'resume' },
        { name: 'a.txt', text: text(200_000) },
        { name: 'b.txt', text: text(MAX_SESSION_DOCUMENT_CHARS - 300_000) },
      ],
    },
    conversation: Array.from({ length: 30 }, (_, chunk) =>
      Array.from({ length: 10 }, (_, i) => ({
        kind: 'line' as const,
        speaker: 'them' as const,
        text: text(MAX_LINE_CHARS),
        at: chunk * 10 + i,
      })),
    ),
    tail: Array.from({ length: MAX_TAIL_LINES }, (_, i) => ({
      speaker: 'them' as const,
      text: text(MAX_LINE_CHARS),
      at: 400 + i,
    })),
    question: text(MAX_LINE_CHARS),
    similar: { question: text(MAX_LINE_CHARS), text: text(6_000), at: 1 },
    documentChunks: Array.from({ length: MAX_DOCUMENT_CHUNKS }, (_, i) => ({
      name: `part${i}.txt`,
      text: text(MAX_DOCUMENT_CHUNK_CHARS),
    })),
    ...(mode === 'screenshot' ? { image: IMAGE } : {}),
  };
}

describe('the 100k input token cap (Batch C, P2-1)', () => {
  it('keeps the largest possible answer request under the limit', () => {
    for (const mode of ['answer', 'chat', 'screenshot', 'warm'] as const) {
      const prompt = buildPrompt(hugeRequest(mode));
      const tokens = countPromptTokens(prompt);
      expect(tokens).toBeLessThanOrEqual(BUDGET_TOKENS);
      expect(tokens).toBeLessThan(MAX_ANSWER_INPUT_TOKENS);
    }
  });

  it('caps the session block by the session alone, the same for the warm-up and every answer', () => {
    const warm = buildPrompt({ ...hugeRequest('warm') });
    const answer = buildPrompt(hugeRequest('answer'));
    expect(warm.system[1]!.text).toBe(answer.system[1]!.text);
    expect(answer.system[1]!.text.length).toBeLessThanOrEqual(SESSION_BLOCK_MAX_CHARS);
    expect(answer.system[1]!.text).toContain(SHORTENED_NOTE);
  });

  it('shortens the documents at the end first and keeps the CV whole when it fits', () => {
    const capped = capSessionDocuments(hugeRequest().session!);
    expect(capped.documents[0]!.text.length).toBe(100_000);
    expect(capped.documents.at(-1)!.text.endsWith(SHORTENED_NOTE)).toBe(true);
  });

  it('leaves a session under the ceiling exactly as it was (its cached bytes do not change)', () => {
    const small: SessionContext = {
      ...BASE,
      documents: [...BASE.documents, { name: 'pricing.txt', text: text(30_000) }],
    };
    expect(capSessionDocuments(small)).toBe(small);
    const prompt = buildPrompt({ mode: 'answer', session: small, question: 'Why Go?' });
    expect(prompt.system[1]!.text).toBe(sessionBlock(small));
  });
});

describe('document parts in the tail (Batch C, P2-1)', () => {
  it('puts the summary in the cached block and the parts, escaped, in the uncached tail', () => {
    const request: AnswerRequest = {
      mode: 'answer',
      session: { ...BASE, documentsSummary: 'The job is about APIs.' },
      question: 'How would you rate limit a public API?',
      documentChunks: [{ name: 'job "full".pdf', text: 'Token bucket <per key> & Redis.' }],
    };
    const prompt = buildPrompt(request);
    expect(prompt.system[1]!.text).toContain('The job is about APIs.');
    expect(prompt.system[1]!.text).not.toContain('Token bucket');
    const content = prompt.messages[0]!.content as { type: string; text?: string }[];
    const tail = content.at(-1)!.text!;
    expect(tail).toContain(DOCUMENT_PARTS_HEADING);
    expect(tail).toContain('<part document="job &quot;full&quot;.pdf">');
    expect(tail).toContain('Token bucket &lt;per key&gt; &amp; Redis.');
    // The parts come before the question.
    expect(tail.indexOf('<document_parts>')).toBeLessThan(tail.indexOf('Question to answer:'));
    // The tail is never cached.
    expect((content.at(-1) as { cache_control?: unknown }).cache_control).toBeUndefined();
  });

  it('writes no parts section without parts', () => {
    const prompt = buildPrompt({ mode: 'answer', session: BASE, question: 'Why Go?' });
    const content = prompt.messages[0]!.content as { type: string; text?: string }[];
    expect(content.at(-1)!.text).not.toContain('<document_parts>');
  });
});

describe('fitToBudget', () => {
  it('drops the parts, the similar answer, the oldest latest lines, then the oldest chunks, in order', () => {
    const order: string[] = [];
    let calls = 0;
    const request = hugeRequest();
    const { shrunk } = fitToBudget(request, (current) => {
      calls += 1;
      if (calls > 1) {
        if (!current.documentChunks?.length && !order.includes('parts')) order.push('parts');
        if (!current.similar && !order.includes('similar')) order.push('similar');
        if ((current.tail?.length ?? 0) < MAX_TAIL_LINES && !order.includes('tail'))
          order.push('tail');
      }
      // Pretend the prompt fits once 10 latest lines have gone.
      const fits = (current.tail?.length ?? 0) <= MAX_TAIL_LINES - 10;
      return {
        system: [{ type: 'text' as const, text: fits ? 'small' : 'x'.repeat(BUDGET_TOKENS * 4) }],
        messages: [],
      };
    });
    expect(order).toEqual(['parts', 'similar', 'tail']);
    expect(shrunk).toBe(12);
  });

  it('builds once when the prompt fits', () => {
    let calls = 0;
    fitToBudget({ mode: 'answer', session: BASE }, () => {
      calls += 1;
      return { system: [{ type: 'text' as const, text: 'small' }], messages: [] };
    });
    expect(calls).toBe(1);
  });
});
