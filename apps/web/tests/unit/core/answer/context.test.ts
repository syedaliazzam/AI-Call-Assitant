/**
 * Tests for apps/web/src/core/answer/context.ts, buildAnswerRequest(), on an invented call:
 * the request shape (mode, model tier, session details, conversation, tail, question); stable
 * lines go into one new chunk and newer lines into the tail; earlier answers are placed by
 * time and sent once; a request with nothing new adds no chunk; old chunks are never changed;
 * a line that grows after it was sent adds only its new words; chat sends the typed question;
 * the request limits (tail length, line length, conversation size); and the Stage 2
 * prefix-growth check on two consecutive requests built here and turned into prompts by the
 * real server code. All text is invented.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { MAX_CONVERSATION_TOKENS, MAX_LINE_CHARS, MAX_TAIL_LINES } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  buildAnswerRequest,
  emptyLog,
  type AnswerContextInput,
  type CallAnswer,
  type ConversationLog,
} from '@/core/answer/context';
import type { Session } from '@/core/storage/types';
import type { Utterance } from '@/core/transcript/transcript';
import { buildPrompt } from '@/server/prompt';

/** When the invented call connected (Unix ms). */
const START = 1_000_000;

/** An invented session. */
const SESSION: Session = {
  id: 's1',
  type: 'sales',
  company: 'Northwind Logistics',
  role: 'Account review',
  description: 'Renewal call',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: 'Bluefin Route',
  },
  instructions: '',
  saveTranscript: true,
  autoAnswer: false,
  createdAt: 1,
  status: 'live',
  lastActiveAt: null,
};

/**
 * An invented final line.
 *
 * @param id      Line id.
 * @param speaker Who spoke.
 * @param text    What was said.
 * @param startS  Start, seconds after START.
 * @param endS    End, seconds after START.
 * @returns The line.
 */
function line(id: string, speaker: 'you' | 'them', text: string, startS: number, endS: number) {
  const utterance: Utterance = {
    id,
    speaker,
    text,
    tStart: START + startS * 1000,
    tEnd: START + endS * 1000,
    final: true,
  };
  return utterance;
}

/**
 * Builds a request at a given time.
 *
 * @param fields Inputs to set (lines, answers, log, mode…).
 * @param nowS   Now, seconds after START.
 * @returns The built request.
 */
function build(fields: Partial<AnswerContextInput>, nowS: number) {
  return buildAnswerRequest({
    session: SESSION,
    documents: [],
    lines: [],
    answers: [],
    mode: 'answer',
    now: START + nowS * 1000,
    callStartedAt: START,
    log: emptyLog(),
    ...fields,
  });
}

/** The invented call's first lines. */
const FIRST = [
  line('u1', 'you', 'THANKS FOR JOINING TODAY', 1, 3),
  line('u2', 'them', 'WHAT DOES THE BLUFF IN ROUTE COST', 5, 8),
  line('u3', 'them', 'FOR FORTY SEATS', 10, 12),
];

describe('buildAnswerRequest', () => {
  it('puts stable lines in a new chunk, newer ones in the tail, and picks the question', () => {
    // At 14 s, u1 and u2 are 5+ s old; u3 (ended at 12 s) is not yet.
    const built = build({ lines: FIRST }, 14);
    expect(built.request).toMatchObject({
      mode: 'answer',
      model: 'fast',
      session: { company: 'Northwind Logistics', keyTerms: ['Bluefin Route'] },
      conversation: [
        [
          { kind: 'line', speaker: 'you', text: 'THANKS FOR JOINING TODAY', at: 1 },
          { kind: 'line', speaker: 'them', text: 'WHAT DOES THE BLUFF IN ROUTE COST', at: 5 },
        ],
      ],
      tail: [{ speaker: 'them', text: 'FOR FORTY SEATS', at: 10 }],
      question: 'WHAT DOES THE BLUFF IN ROUTE COST FOR FORTY SEATS',
    });
    expect(built.selected?.lineIds).toEqual(['u2', 'u3']);
  });

  it('places earlier answers by time, sends each once, and never changes old chunks', () => {
    const first = build({ lines: FIRST }, 14);
    const answer: CallAnswer = {
      id: 'a1',
      mode: 'answer',
      question: 'WHAT DOES THE BLUFF IN ROUTE COST FOR FORTY SEATS',
      text: 'Bluefin Route is 52 dollars per seat.\n- 2,080 dollars a month for 40 seats',
      askedAt: START + 13_000,
    };
    const lines = [...FIRST, line('u4', 'you', 'THAT WOULD BE TWO THOUSAND EIGHTY', 16, 18)];
    const second = build({ lines, answers: [answer], log: first.log }, 30);
    const chunks = second.request.conversation!;
    expect(chunks).toHaveLength(2);
    // The first chunk is the very same chunk, unchanged.
    expect(chunks[0]).toBe(first.request.conversation![0]);
    // New chunk in time order: u3 (10 s), the answer (13 s), u4 (16 s).
    expect(chunks[1]!.map((item) => item.at)).toEqual([10, 13, 16]);
    expect(chunks[1]![1]).toMatchObject({ kind: 'answer', mode: 'answer', at: 13 });
    // Nothing new: no new chunk, and the answer is not sent again.
    const third = build({ lines, answers: [answer], log: second.log }, 40);
    expect(third.request.conversation).toEqual(chunks);
    expect(third.log.chunks).toBe(second.log.chunks);
  });

  it('sends only the new words of a line that grew after it was sent', () => {
    const before = build({ lines: [line('u1', 'them', 'WHAT ABOUT TRAINING', 1, 2)] }, 10);
    const grown = [line('u1', 'them', 'WHAT ABOUT TRAINING FOR DISPATCHERS', 1, 4)];
    const after = build({ lines: grown, log: before.log }, 20);
    expect(after.request.conversation![1]).toEqual([
      { kind: 'line', speaker: 'them', text: 'FOR DISPATCHERS', at: 1 },
    ]);
    // A changed (not grown) line is not sent again.
    const changed = [line('u1', 'them', 'WHAT ABOUT PRICING', 1, 4)];
    const later = build({ lines: changed, log: after.log }, 30);
    expect(later.request.conversation).toHaveLength(2);
  });

  it('sends the typed question for chat, and no question when Them said nothing', () => {
    const chat = build({ mode: 'chat', typedQuestion: '  Seat price?  ' }, 5);
    expect(chat.request).toEqual({
      mode: 'chat',
      model: 'fast',
      session: expect.any(Object),
      question: 'Seat price?',
    });
    expect(chat.selected).toBeNull();
    const silent = build({ lines: [line('u1', 'you', 'HELLO CAN YOU HEAR ME', 1, 2)] }, 3);
    expect(silent.request.question).toBeUndefined();
  });

  it('keeps the tail and lines within the request limits', () => {
    const many = Array.from({ length: MAX_TAIL_LINES + 5 }, (_, i) =>
      line(`u${i}`, i % 2 ? 'you' : 'them', `LINE ${i} ${'X'.repeat(MAX_LINE_CHARS)}`, i, i),
    );
    const built = build({ lines: many }, MAX_TAIL_LINES + 5);
    expect(built.request.tail!.length).toBeLessThanOrEqual(MAX_TAIL_LINES);
    for (const item of built.request.conversation!.flat()) {
      expect(item.kind === 'line' && item.text.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    }
  });

  it('drops the oldest chunks once the conversation passes the request limit', () => {
    let log: ConversationLog = emptyLog();
    // 40 chunks of 4 full-length lines (4 × 500 = 2,000 estimated tokens each) = 80,000,
    // twice the limit.
    for (let i = 0; i < 40; i += 1) {
      const lines = [0, 1, 2, 3].map((j) =>
        line(`u${i}-${j}`, 'them', 'Y'.repeat(MAX_LINE_CHARS), i * 10 + j, i * 10 + j),
      );
      log = build({ lines, log }, i * 10 + 20).log;
    }
    const total = log.chunks.flat().reduce((sum, item) => sum + item.text.length / 4, 0);
    expect(total).toBeLessThanOrEqual(MAX_CONVERSATION_TOKENS);
    expect(log.chunks.length).toBeLessThan(40);
    // The newest chunk is always kept.
    expect(log.chunks.at(-1)![0]).toMatchObject({ at: 390 });
  });

  it('two consecutive requests pass the prefix-growth check through the real prompt', () => {
    const first = build({ lines: FIRST }, 14);
    const lines = [...FIRST, line('u4', 'you', 'LET ME CHECK THE PRICE LIST', 16, 18)];
    const answer: CallAnswer = {
      id: 'a1',
      mode: 'answer',
      question: 'Q',
      text: 'Fifty two dollars per seat.',
      askedAt: START + 13_000,
    };
    const second = build({ lines, answers: [answer], log: first.log }, 30);
    const texts = (request: typeof first.request) => {
      const prompt = buildPrompt(request);
      const content = prompt.messages[0]!.content as Anthropic.TextBlockParam[];
      return [...prompt.system, ...content];
    };
    const before = texts(first.request);
    const cachedCount = before.findLastIndex((block) => block.cache_control !== undefined) + 1;
    const cached = before.slice(0, cachedCount).map((block) => block.text);
    const after = texts(second.request).map((block) => block.text);
    expect(after.slice(0, cachedCount)).toEqual(cached);
  });
});

describe('buildAnswerRequest, screenshot (Day 5)', () => {
  it('sends the image and the typed question, without selecting one from the transcript', () => {
    const built = build(
      {
        lines: FIRST,
        mode: 'screenshot',
        image: 'data:image/jpeg;base64,/9j/',
        typedQuestion: ' Is this right? ',
      },
      14,
    );
    expect(built.request).toMatchObject({
      mode: 'screenshot',
      image: 'data:image/jpeg;base64,/9j/',
      question: 'Is this right?',
    });
    expect(built.selected).toBeNull();
    const plain = build(
      { lines: FIRST, mode: 'screenshot', image: 'data:image/jpeg;base64,/9j/' },
      14,
    );
    expect(plain.request.question).toBeUndefined();
    // No image on other modes.
    expect(build({ lines: FIRST }, 14).request).not.toHaveProperty('image');
  });
});
