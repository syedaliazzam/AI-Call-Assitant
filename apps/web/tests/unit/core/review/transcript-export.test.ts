/**
 * Tests: apps/web/src/core/review/conversation.ts, v1.3.2 (the Otter export format). Each answer goes
 * right after the turn it answered (by its source line id, whatever the time it was asked), falls back to
 * its time when that line is missing, and chat and screenshot answers go by time with their type in the
 * label; the mm:ss clock runs from the moment the call connected. The TXT download is compared, byte for
 * byte, with a golden file: tests/fixtures/transcript/otter-export.txt. Invented data only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answerAnchor,
  answerLabel,
  callReference,
  conversationEntries,
  conversationItems,
  transcriptText,
} from '@/core/review/conversation';
import type { StoredAnswer, StoredUtterance } from '@/core/storage/types';
import { lineTurns } from '@/core/transcript/turns';

/** When the invented call connected (Unix ms). */
const T0 = Date.UTC(2026, 10, 9, 14, 0, 0);

/**
 * An invented saved line, with its id as the saver writes it (session, call, live line id).
 *
 * @param live    The live line id (u1, u2…).
 * @param speaker Who spoke.
 * @param text    The words, as the engine wrote them.
 * @param at      Seconds after the call connected.
 * @param seconds How long it lasted.
 * @returns The line.
 */
function saved(
  live: string,
  speaker: 'you' | 'them',
  text: string,
  at: number,
  seconds = 2,
): StoredUtterance {
  return {
    id: `s1:call-1:${live}`,
    sessionId: 's1',
    speaker,
    text,
    tStart: T0 + at * 1_000,
    tEnd: T0 + (at + seconds) * 1_000,
  };
}

/**
 * An invented saved answer.
 *
 * @param id     Its id.
 * @param at     Seconds after the call connected that it was asked.
 * @param fields Other fields.
 * @returns The answer.
 */
function answer(id: string, at: number, fields: Partial<StoredAnswer> = {}): StoredAnswer {
  return {
    id,
    sessionId: 's1',
    mode: 'answer',
    question: '',
    text: 'Invented answer.',
    model: 'fast',
    msFirstToken: 1,
    msTotal: 2,
    createdAt: T0 + at * 1_000,
    rating: null,
    note: '',
    callStartedAt: T0,
    ...fields,
  };
}

/** The invented call: a greeting, a question, an answer, a follow-up. */
const LINES = [
  saved('u1', 'them', 'HI SAM THANKS FOR JOINING', 3),
  saved('u2', 'you', 'thanks for having me', 7),
  saved('u3', 'them', 'SO HOW DID YOU SCALE THE ROUTING SERVICE', 12, 3),
  saved('u4', 'you', 'good question', 17),
  // Over 8 s after u4: a new turn of the same speaker.
  saved('u5', 'you', 'we moved the queue to lantern streams', 28, 4),
  saved('u6', 'them', 'WHAT DID IT COST PER MONTH', 40),
];

describe('answer placement (v1.3.2)', () => {
  const turns = lineTurns(LINES);

  it('goes after the turn holding its source line, even when asked later', () => {
    // Asked at 0:30, after "You" had started answering: still after the question's turn.
    const index = answerAnchor(answer('a', 30, { sourceLineId: 'u3' }), turns, LINES);
    expect(turns[index]!.parts.flatMap((part) => part.lineIds)).toEqual(['s1:call-1:u3']);
  });

  it('falls back to its time when the source line is missing (merged away or cleared)', () => {
    const index = answerAnchor(answer('a', 30, { sourceLineId: 'u99' }), turns, LINES);
    // The last turn that started at or before 0:30: "You" from 0:28.
    expect(turns[index]!.tStart).toBe(T0 + 28_000);
    expect(answerAnchor(answer('b', 30), turns, LINES)).toBe(index);
  });

  it('goes before every turn when it was asked before anyone spoke', () => {
    expect(answerAnchor(answer('a', 1), turns, LINES)).toBe(-1);
  });

  it('places chat and screenshot answers by time, whatever their source line', () => {
    const chat = answer('c', 30, { mode: 'chat', sourceLineId: 'u3' });
    expect(turns[answerAnchor(chat, turns, LINES)]!.tStart).toBe(T0 + 28_000);
  });

  it('takes the latest line with that live id: ids start again on every page load', () => {
    const reload = [
      ...LINES,
      { ...saved('u3', 'them', 'AND THE LATENCY', 45), id: 's1:call-2:u3' },
    ];
    const again = lineTurns(reload);
    const index = answerAnchor(answer('a', 50, { sourceLineId: 'u3' }), again, reload);
    expect(again[index]!.parts.flatMap((part) => part.lineIds)).toContain('s1:call-2:u3');
  });

  it('labels each answer with its type', () => {
    expect(answerLabel({ mode: 'answer' })).toBe('Paramount AI answered');
    expect(answerLabel({ mode: 'chat' })).toBe('Paramount AI answered (chat)');
    expect(
      answerLabel({ mode: 'screenshot', meta: { type: 'general', target: 'kite' } as never }),
    ).toBe('Paramount AI answered (screenshot, private)');
  });

  it('runs the clock from when the call connected, as an answer recorded it', () => {
    const items = conversationItems(LINES, [answer('a', 20, { sourceLineId: 'u3' })]);
    expect(callReference(items)).toBe(T0);
    const first = conversationEntries(items)[0]!;
    expect(first.kind === 'turn' && first.elapsed).toBe(3_000);
    // No answer to say when: from the first line.
    expect(callReference(conversationItems(LINES, []))).toBe(T0 + 3_000);
  });
});

describe('the TXT download (golden file)', () => {
  it('matches tests/fixtures/transcript/otter-export.txt', () => {
    const items = conversationItems(LINES, [
      answer('a1', 30, {
        sourceLineId: 'u3',
        question: 'SO HOW DID YOU SCALE THE ROUTING SERVICE',
        cleanQuestion: 'How did you scale the routing service?',
        text: 'We split routing into a queue and stateless workers.\n- Queue absorbs the peaks\n- Workers scale on queue depth\nTip: Mention the 3x traffic month.\nNote: Private: check the exact figure.',
      }),
      answer('a2', 44, {
        mode: 'chat',
        question: 'monthly cost of lantern streams',
        text: 'About 400 dollars a month at that volume.',
      }),
    ]);
    const golden = readFileSync(
      path.join(__dirname, '..', '..', '..', 'fixtures', 'transcript', 'otter-export.txt'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const out = transcriptText(
      { company: 'Lantern Freight (invented)', role: 'Platform Engineer', contactName: 'Dana' },
      items,
      ['Lantern'],
      'Sam Rivera',
    );
    expect(out).toBe(golden);
  });

  it('has the answers only when no lines were saved (Save transcript off)', () => {
    const out = transcriptText(
      { company: 'Lantern Freight (invented)', role: '', contactName: '' },
      conversationItems([], [answer('a1', 30, { question: 'How did you scale it?' })]),
    );
    expect(out).toBe(
      'Paramount AI transcript: Lantern Freight (invented)\n\nParamount AI answered  00:30\nQuestion: How did you scale it?\nAnswer: Invented answer.\n',
    );
  });
});
