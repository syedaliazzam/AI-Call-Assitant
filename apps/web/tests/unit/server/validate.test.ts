/**
 * Tests for apps/web/src/server/validate.ts, parseAnswerRequest():
 * accepts a hello request, a warm request (with and without the conversation so far), a full
 * answer request and a chat request; rejects unknown modes and fields, warm/answer/chat without
 * a session, chat without a question, the old Day 1–3 transcript field, more than 100 key terms,
 * and each conversation and tail limit (tokens, chunks, empty chunk, line and answer length,
 * times); enforces the 500k-character document total (ADR-0067); and reports field paths without
 * echoing submitted values. ADR-0067: keeps the CV's kind and the documents summary, keeps Ask
 * Kite attachments at 150k, and checks POST /api/summary's body (parseSummaryRequest()). All text is
 * invented.
 * ADR-0083: the company instructions pin on answers and notes (a version id or none), none on Ask AI,
 * (the "Try it" body went with ADR-0091).
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ANSWER_CHARS,
  MAX_CONVERSATION_CHUNKS,
  MAX_CONVERSATION_TOKENS,
  MAX_IMAGE_CHARS,
  MAX_LINE_CHARS,
  MAX_TAIL_LINES,
} from '@kite/shared';
import {
  MAX_ATTACHMENT_CHARS,
  MAX_DOCUMENT_CHARS,
  MAX_KEY_TERMS,
  parseAnswerRequest,
  parseAskRequest,
  parseNotesRequest,
  parseSummaryRequest,
} from '@/server/validate';
import { MAX_DOCUMENTS_SUMMARY_CHARS } from '@kite/shared';

/** A complete, valid session block. */
const SESSION = {
  type: 'regular',
  company: 'Acme',
  role: 'Account review',
  description: 'Renewal call.',
  instructions: 'Be brief.',
  keyTerms: ['Bluefin Route'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'pricing.pdf', text: 'Price list' }],
};

/** A valid conversation: two chunks, with a line and an earlier answer. */
const CONVERSATION = [
  [{ kind: 'line', speaker: 'them', text: 'What does it cost?', at: 12 }],
  [
    { kind: 'answer', mode: 'answer', question: 'What does it cost?', text: 'Ten.', at: 15 },
    { kind: 'line', speaker: 'you', text: 'It is ten dollars.', at: 20 },
  ],
];

/**
 * An answer request with some fields replaced.
 *
 * @param fields Fields to set or replace.
 * @returns The request body.
 */
function answerWith(fields: Record<string, unknown>) {
  return { mode: 'answer', session: SESSION, conversation: CONVERSATION, ...fields };
}

/**
 * The validation message of a body that must fail.
 *
 * @param body The request body.
 * @returns The message.
 */
function failure(body: unknown): string {
  const result = parseAnswerRequest(body);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.message;
}

describe('parseAnswerRequest', () => {
  it('accepts the Day 1 hello request', () => {
    expect(parseAnswerRequest({ mode: 'hello' })).toEqual({ ok: true, data: { mode: 'hello' } });
  });

  it('accepts a full answer request', () => {
    const result = parseAnswerRequest({
      mode: 'answer',
      model: 'fast',
      session: SESSION,
      conversation: CONVERSATION,
      tail: [{ speaker: 'them', text: 'And the timeline?', at: 30 }],
      question: 'What is the timeline?',
      image: null,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an answer request with nothing said yet, and a chat request', () => {
    expect(parseAnswerRequest({ mode: 'answer', session: SESSION }).ok).toBe(true);
    expect(parseAnswerRequest(answerWith({ mode: 'chat', question: 'Price?' })).ok).toBe(true);
  });

  it('accepts a warm request carrying the conversation so far (idle re-warm)', () => {
    expect(
      parseAnswerRequest({ mode: 'warm', session: SESSION, conversation: CONVERSATION }).ok,
    ).toBe(true);
  });

  it('requires a session for answer and chat, and a question for chat', () => {
    expect(failure({ mode: 'answer' })).toBe('session: required for mode answer');
    expect(failure({ mode: 'chat', question: 'Price?' })).toBe('session: required for mode chat');
    expect(failure(answerWith({ mode: 'chat' }))).toBe('question: required for mode chat');
    expect(failure(answerWith({ mode: 'chat', question: '   ' }))).toBe(
      'question: required for mode chat',
    );
  });

  it('rejects the Day 1–3 transcript field', () => {
    expect(failure(answerWith({ transcript: [] }))).toContain('transcript');
  });

  it('rejects a conversation above the estimated-token limit, naming the field', () => {
    // One line of 2,000 characters is 500 estimated tokens.
    const line = { kind: 'line', speaker: 'them', text: 'x'.repeat(MAX_LINE_CHARS), at: 1 };
    const atLimit = Array.from({ length: MAX_CONVERSATION_TOKENS / 500 }, () => [line]);
    expect(parseAnswerRequest(answerWith({ conversation: atLimit })).ok).toBe(true);
    const over = [...atLimit, [{ ...line, text: 'xxxx' }]];
    expect(failure(answerWith({ conversation: over }))).toBe(
      `conversation: at most ${MAX_CONVERSATION_TOKENS} estimated tokens`,
    );
  });

  it('rejects too many chunks, and an empty chunk', () => {
    const many = Array.from({ length: MAX_CONVERSATION_CHUNKS + 1 }, () => CONVERSATION[0]);
    expect(failure(answerWith({ conversation: many }))).toContain('conversation');
    expect(failure(answerWith({ conversation: [[]] }))).toContain('conversation.0');
  });

  it('rejects items that break a limit, naming the item', () => {
    const line = CONVERSATION[0]![0]!;
    const answer = CONVERSATION[1]![0]!;
    const cases: [unknown, string][] = [
      [{ ...line, text: 'x'.repeat(MAX_LINE_CHARS + 1) }, 'conversation.0.0.text'],
      [{ ...answer, text: 'x'.repeat(MAX_ANSWER_CHARS + 1) }, 'conversation.0.0.text'],
      [{ ...line, at: 1.5 }, 'conversation.0.0.at'],
      [{ ...line, at: -1 }, 'conversation.0.0.at'],
      [{ ...line, speaker: 'both' }, 'conversation.0.0.speaker'],
      [{ ...line, kind: 'note' }, 'conversation.0.0'],
      [{ ...line, t: 5 }, 'conversation.0.0'],
    ];
    for (const [item, path] of cases) {
      expect(failure(answerWith({ conversation: [[item]] })), path).toContain(path);
    }
  });

  it('rejects a tail that breaks a limit', () => {
    const line = { speaker: 'them', text: 'More?', at: 40 };
    const many = Array.from({ length: MAX_TAIL_LINES + 1 }, () => line);
    expect(parseAnswerRequest(answerWith({ tail: many.slice(1) })).ok).toBe(true);
    expect(failure(answerWith({ tail: many }))).toContain('tail');
    expect(failure(answerWith({ tail: [{ ...line, kind: 'line' }] }))).toContain('tail.0');
    expect(failure(answerWith({ question: 'q'.repeat(MAX_LINE_CHARS + 1) }))).toContain('question');
  });

  it('accepts a warm request with a session', () => {
    expect(parseAnswerRequest({ mode: 'warm', model: 'fast', session: SESSION }).ok).toBe(true);
  });

  it('rejects a warm request without a session, naming the field', () => {
    expect(parseAnswerRequest({ mode: 'warm' })).toEqual({
      ok: false,
      message: 'session: required for mode warm',
    });
  });

  it('rejects a session without key terms, and keeps only the key-term limit', () => {
    const { keyTerms: _omitted, ...withoutKeyTerms } = SESSION;
    expect(parseAnswerRequest({ mode: 'warm', session: withoutKeyTerms })).toMatchObject({
      ok: false,
      message: expect.stringContaining('session.keyTerms'),
    });
    const tooMany = Array.from({ length: MAX_KEY_TERMS + 1 }, (_, i) => `Term ${i}`);
    const parsed = parseAnswerRequest({ mode: 'warm', session: { ...SESSION, keyTerms: tooMany } });
    expect(parsed.ok && parsed.data.session?.keyTerms).toHaveLength(MAX_KEY_TERMS);
  });

  it('sanitises a pasted comma list sent as one long term instead of failing (v1.0.1)', () => {
    // The real failure: one 200+ character "term" made every answer fail with
    // "session.keyTerms.0: Too big".
    const pasted = `${'Kubernetes, Terraform; BM25, H100, Retrieval-augmented generation, '.repeat(4)}${'x'.repeat(90)}`;
    const parsed = parseAnswerRequest({
      mode: 'warm',
      session: { ...SESSION, keyTerms: [pasted] },
    });
    expect(parsed.ok).toBe(true);
    const terms = parsed.ok ? (parsed.data.session?.keyTerms ?? []) : [];
    expect(terms.slice(0, 5)).toEqual([
      'Kubernetes',
      'Terraform',
      'BM25',
      'H100',
      'Retrieval-augmented generation',
    ]);
    expect(terms).toHaveLength(6);
    expect(terms.every((term) => term.length <= 60)).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = parseAnswerRequest({ mode: 'poem' });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('mode') });
  });

  it('rejects unknown fields', () => {
    expect(parseAnswerRequest({ mode: 'hello', extra: true }).ok).toBe(false);
  });

  it('rejects a body that is not an object', () => {
    expect(parseAnswerRequest('hello').ok).toBe(false);
    expect(parseAnswerRequest(null).ok).toBe(false);
  });

  it('rejects documents above the total character limit', () => {
    const half = 'x'.repeat(MAX_DOCUMENT_CHARS / 2 + 1);
    const result = parseAnswerRequest({
      mode: 'warm',
      session: {
        ...SESSION,
        documents: [
          { name: 'a.txt', text: half },
          { name: 'b.txt', text: half },
        ],
      },
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('documents') });
  });

  it('rejects an image that is not an image data URL', () => {
    expect(
      failure({ mode: 'screenshot', session: SESSION, image: 'https://example.com/a.png' }),
    ).toContain('image');
  });

  it('does not echo submitted text in the error message', () => {
    const result = parseAnswerRequest({ mode: 'hello', question: 'q'.repeat(3000) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('qqqq');
    const secret = 'SECRET-LINE-'.repeat(200);
    const message = failure(
      answerWith({ conversation: [[{ kind: 'line', speaker: 'them', text: secret, at: 1 }]] }),
    );
    expect(message).not.toContain('SECRET');
  });
});

describe('screenshot image (Day 5)', () => {
  it('accepts a JPEG data URL only in screenshot mode, checked by its first bytes', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    expect(parseAnswerRequest({ mode: 'screenshot', session: SESSION, image: jpeg }).ok).toBe(true);
    expect(failure({ mode: 'screenshot', session: SESSION })).toBe(
      'image: required for mode screenshot',
    );
    expect(failure(answerWith({ image: jpeg }))).toBe('image: only for mode screenshot');
    // A PNG with a JPEG label: the bytes decide.
    expect(
      failure({
        mode: 'screenshot',
        session: SESSION,
        image: 'data:image/jpeg;base64,iVBORw0KGgo=',
      }),
    ).toBe('image: must be a JPEG image');
    expect(
      failure({ mode: 'screenshot', session: SESSION, image: 'data:image/webp;base64,UklGR' }),
    ).toContain('image: must be a JPEG data URL');
    expect(
      failure({
        mode: 'screenshot',
        session: SESSION,
        image: `data:image/jpeg;base64,/9j/${'A'.repeat(MAX_IMAGE_CHARS)}`,
      }),
    ).toContain(`image: at most ${MAX_IMAGE_CHARS} characters`);
  });

  it('accepts earlier screenshot answers in the conversation', () => {
    const conversation = [
      [{ kind: 'answer', mode: 'screenshot', question: 'Q', text: 'A', at: 1 }],
    ];
    expect(parseAnswerRequest(answerWith({ conversation })).ok).toBe(true);
  });
});

describe('larger documents (ADR-0067)', () => {
  it('accepts 500k characters of documents in all, the CV marked, with a summary', () => {
    expect(MAX_DOCUMENT_CHARS).toBe(500_000);
    const result = parseAnswerRequest({
      mode: 'warm',
      session: {
        ...SESSION,
        documents: [
          { name: 'cv.txt', text: 'x'.repeat(250_000), kind: 'resume' },
          { name: 'b.txt', text: 'x'.repeat(250_000) },
        ],
        documentsSummary: '## b.txt\n- A short summary.',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.session?.documents[0]?.kind).toBe('resume');
      expect(result.data.session?.documentsSummary).toContain('short summary');
    }
  });

  it('rejects another document kind and a summary over its limit', () => {
    const withKind = parseAnswerRequest({
      mode: 'warm',
      session: { ...SESSION, documents: [{ name: 'a.txt', text: 'a', kind: 'other' }] },
    });
    expect(withKind.ok).toBe(false);
    const longSummary = parseAnswerRequest({
      mode: 'warm',
      session: { ...SESSION, documentsSummary: 's'.repeat(MAX_DOCUMENTS_SUMMARY_CHARS + 1) },
    });
    expect(longSummary).toMatchObject({
      ok: false,
      message: expect.stringContaining('documentsSummary'),
    });
  });

  it('keeps Ask Kite attachments at 150k characters', () => {
    expect(MAX_ATTACHMENT_CHARS).toBe(150_000);
    const kite = (chars: number) =>
      parseAnswerRequest({
        mode: 'kite',
        question: 'What does it say?',
        attachments: [{ name: 'a.txt', text: 'x'.repeat(chars) }],
      });
    expect(kite(MAX_ATTACHMENT_CHARS).ok).toBe(true);
    expect(kite(MAX_ATTACHMENT_CHARS + 1)).toMatchObject({
      ok: false,
      message: expect.stringContaining('attachments'),
    });
  });
});

describe('parseSummaryRequest (ADR-0067)', () => {
  it('accepts one or more documents up to the session total', () => {
    const result = parseSummaryRequest({
      documents: [
        { name: 'a.txt', text: 'x'.repeat(250_000) },
        { name: 'b.txt', text: 'x'.repeat(250_000) },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects no documents, too much text and unknown fields, naming paths only', () => {
    expect(parseSummaryRequest({ documents: [] }).ok).toBe(false);
    const over = parseSummaryRequest({
      documents: [
        { name: 'a.txt', text: 'SECRET'.repeat(50_000) },
        { name: 'b.txt', text: 'SECRET'.repeat(50_000) },
      ],
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).not.toContain('SECRET');
    expect(parseSummaryRequest({ documents: [{ name: 'a', text: 'b' }], extra: 1 }).ok).toBe(false);
  });
});

describe('Batch C (P2-1): documentChunks', () => {
  it('accepts up to 5 parts of at most 1,600 characters, and nothing else', () => {
    const part = { name: 'job.pdf', text: 'Token bucket.' };
    expect(
      parseAnswerRequest({ mode: 'answer', session: SESSION, documentChunks: [part, part] }).ok,
    ).toBe(true);
    expect(
      parseAnswerRequest({ mode: 'answer', session: SESSION, documentChunks: Array(6).fill(part) })
        .ok,
    ).toBe(false);
    expect(
      parseAnswerRequest({
        mode: 'answer',
        session: SESSION,
        documentChunks: [{ name: 'a', text: 'x'.repeat(1_601) }],
      }).ok,
    ).toBe(false);
    expect(
      parseAnswerRequest({
        mode: 'answer',
        session: SESSION,
        documentChunks: [{ ...part, extra: true }],
      }).ok,
    ).toBe(false);
  });
});

describe('company instructions fields (ADR-0083)', () => {
  /** An invented version id. */
  const PIN = '0b9c7a3e-5d1f-4c2a-9e8b-1a2b3c4d5e6f';
  /** A valid notes request with no call. */
  const NOTES = { session: SESSION, lines: [], answers: [] };

  it('accepts a version id or none as the pin of answers and notes, and nothing else', () => {
    for (const pin of [PIN, 'none']) {
      expect(
        parseAnswerRequest({ mode: 'warm', session: SESSION, instructionsVersion: pin }).ok,
      ).toBe(true);
      expect(parseNotesRequest({ ...NOTES, instructionsVersion: pin }).ok).toBe(true);
    }
    for (const pin of ['latest', '', PIN.toUpperCase(), `${PIN} `, 7]) {
      expect(
        parseAnswerRequest({ mode: 'warm', session: SESSION, instructionsVersion: pin }).ok,
      ).toBe(false);
      expect(parseNotesRequest({ ...NOTES, instructionsVersion: pin }).ok).toBe(false);
    }
  });

  it('does not take a pin on Ask AI (it always uses the version in force)', () => {
    const ask = { ...NOTES, notes: '', question: 'Who spoke?', history: [] };
    expect(parseAskRequest(ask).ok).toBe(true);
    expect(parseAskRequest({ ...ask, instructionsVersion: PIN }).ok).toBe(false);
  });
});
