/**
 * Tests: apps/web/src/core/review/ask.ts. The request carries the call and its notes and stays the
 * same from question to question, so the prompt cache works; the chat is limited; failures become
 * messages, never exceptions.
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_ASK_HISTORY, MAX_ASK_NOTES_CHARS, type AskTurn, type CallNotes } from '@kite/shared';
import { askAboutCall, askRequest, notesText } from '@/core/review/ask';
import type { ReviewData } from '@/core/review/load';

/** An invented call. */
const REVIEW = {
  session: {
    id: 's',
    type: 'regular',
    company: 'Alder Foods (invented)',
    role: 'Renewal',
    description: '',
    preferences: {
      language: 'en',
      model: 'fast',
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      keyTerms: '',
    },
    instructions: '',
    saveTranscript: true,
    autoAnswer: false,
    createdAt: 1,
    status: 'ended',
    lastActiveAt: 2,
  },
  documents: [],
  lines: [
    { id: 'l', sessionId: 's', speaker: 'them', text: 'what is the price', tStart: 10, tEnd: 11 },
  ],
  answers: [],
  notes: null,
  lessonDecisions: [],
} as unknown as ReviewData;

const NOTES: CallNotes = {
  summary: ['They asked about price.'],
  questions: [{ question: 'What is the price?', at: 1, answered: 'yes' }],
  nextSteps: [{ step: 'Send the sheet', owner: 'You' }],
  unclear: [],
  lessons: [],
} as unknown as CallNotes;

/**
 * A fetch that answers with one response.
 *
 * @param status The status.
 * @param body   The JSON body.
 * @returns The fake.
 */
function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
}

describe('notesText', () => {
  it('holds the summary, questions and next steps', () => {
    const out = notesText(NOTES);
    expect(out).toContain('Summary: They asked about price.');
    expect(out).toContain('Question asked: What is the price?');
    expect(out).toContain('Next step (You): Send the sheet');
  });

  it('is empty without notes, and keeps to the limit', () => {
    expect(notesText(null)).toBe('');
    const long = { ...NOTES, summary: ['x'.repeat(MAX_ASK_NOTES_CHARS + 5)] };
    expect(notesText(long).length).toBe(MAX_ASK_NOTES_CHARS);
  });
});

describe('askRequest', () => {
  it('carries the call, the question and the chat', () => {
    const history: AskTurn[] = [{ role: 'you', text: 'hi' }];
    const request = askRequest(REVIEW, 'What did they ask?', history);
    expect(request.question).toBe('What did they ask?');
    expect(request.history).toEqual(history);
    expect(request.lines[0]?.text).toBe('what is the price');
    expect(request.session.company).toBe('Alder Foods (invented)');
  });

  it('keeps the call the same from question to question, for the cache', () => {
    const first = askRequest(REVIEW, 'one', []);
    const second = askRequest(REVIEW, 'two', [{ role: 'you', text: 'one' }]);
    expect(JSON.stringify(first.lines)).toBe(JSON.stringify(second.lines));
    expect(JSON.stringify(first.session)).toBe(JSON.stringify(second.session));
    expect(first.notes).toBe(second.notes);
  });

  it('sends only the latest turns', () => {
    const history = Array.from({ length: MAX_ASK_HISTORY + 5 }, (_, i) => ({
      role: 'you' as const,
      text: String(i),
    }));
    const request = askRequest(REVIEW, 'q', history);
    expect(request.history).toHaveLength(MAX_ASK_HISTORY);
    expect(request.history.at(-1)?.text).toBe(String(MAX_ASK_HISTORY + 4));
  });
});

describe('askAboutCall', () => {
  it('returns the reply', async () => {
    expect(
      await askAboutCall(REVIEW, 'q', [], reply(200, { text: 'They asked the price.' })),
    ).toEqual({ ok: true, text: 'They asked the price.' });
  });

  it('says when signed out', async () => {
    const outcome = await askAboutCall(REVIEW, 'q', [], reply(401, { code: 'unauthorized' }));
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining('signed out') });
  });

  it('hides other server messages behind a plain one', async () => {
    const outcome = await askAboutCall(
      REVIEW,
      'q',
      [],
      reply(502, { code: 'upstream_error', message: 'internal detail' }),
    );
    expect(JSON.stringify(outcome)).not.toContain('internal detail');
  });

  it('does not throw when offline', async () => {
    const offline = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await askAboutCall(REVIEW, 'q', [], offline)).ok).toBe(false);
  });
});
