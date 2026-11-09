/**
 * Tests: apps/web/src/core/review/conversation.ts and pdf.ts. Lines and answers merge in time order;
 * on screen, runs of lines between answers become bubbles (v1.0.2);
 * downloads say the same in TXT and PDF, and leave out the private note; the PDF is a well-formed
 * file (its table of offsets points at its objects) that wraps, pages and escapes correctly, and it
 * says when letters could not be drawn.
 */
import { describe, expect, it } from 'vitest';
import {
  callStarts,
  conversationEntries,
  conversationItems,
  orderEntries,
  transcriptFileName,
  transcriptPdf,
  transcriptText,
} from '@/core/review/conversation';
import { wrapText, writePdf } from '@/core/review/pdf';
import type { StoredAnswer, StoredUtterance } from '@/core/storage/types';

const SESSION = { company: 'Lantern Freight (invented)', role: 'Data Analyst' };

/**
 * A transcript line.
 *
 * @param id      Its id.
 * @param speaker Who spoke.
 * @param text    What was said.
 * @param tStart  When.
 * @returns The line.
 */
function line(id: string, speaker: 'you' | 'them', text: string, tStart: number): StoredUtterance {
  return { id, sessionId: 's', speaker, text, tStart, tEnd: tStart + 1 };
}

/**
 * An answer.
 *
 * @param id        Its id.
 * @param text      Its text.
 * @param createdAt When.
 * @returns The answer.
 */
function answer(id: string, text: string, createdAt: number): StoredAnswer {
  return {
    id,
    sessionId: 's',
    mode: 'answer',
    question: 'What is the price?',
    text,
    model: 'fast',
    msFirstToken: 1,
    msTotal: 2,
    createdAt,
    rating: null,
    note: '',
  };
}

/**
 * The file's bytes as a string, one character per byte.
 *
 * @param bytes The bytes.
 * @returns The string.
 */
function text(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

describe('one entry per question (v1.0.4, ADR-0040)', () => {
  it('leaves out an answer repeated for the same question, keeping the newest', () => {
    const items = conversationItems(
      [],
      [answer('a1', 'First.', 100), answer('a2', 'Second.', 200), answer('a3', 'Third.', 300)],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'answer', answer: { id: 'a3' } });
  });

  it('downloads the clean question, or the raw words cut at the question mark', () => {
    const clean = {
      ...answer('c', 'Clean answer.', 100),
      question: 'UM WHAT IS THE PRICE',
      cleanQuestion: 'What is the seat price?',
    };
    const old = {
      ...answer('o', 'Old answer.', 200),
      question: 'HOW LONG DOES IT RUN? OKAY THANKS',
    };
    const text = transcriptText(SESSION, conversationItems([], [clean, old]), []);
    expect(text).toContain('Question: What is the seat price?');
    expect(text).toContain('Question: How long does it run?');
    expect(text).not.toContain('UM WHAT');
    expect(text).not.toContain('OKAY THANKS');
  });
});

describe('conversationItems', () => {
  it('merges in time order, a line before an answer at the same moment', () => {
    const items = conversationItems(
      [line('b', 'you', 'second', 20), line('a', 'them', 'first', 10), line('c', 'them', 'q', 30)],
      [answer('x', 'reply', 30)],
    );
    expect(items.map((item) => (item.kind === 'line' ? item.line.id : item.answer.id))).toEqual([
      'a',
      'b',
      'c',
      'x',
    ]);
  });
});

describe('conversationEntries (v1.3.2 turns)', () => {
  it('merges each speaker run into turns and puts an answer after the turn before it', () => {
    const items = conversationItems(
      [
        line('a', 'them', 'WHAT IS', 1_000),
        line('b', 'them', 'THE PRICE', 3_000),
        line('c', 'them', 'FOR FORTY SEATS', 20_000),
      ],
      [answer('x', 'It is 52 dollars per seat.', 10_000)],
    );
    const entries = conversationEntries(items);
    expect(
      entries.map((entry) =>
        entry.kind === 'turn' ? entry.turn.parts.flatMap((part) => part.lineIds) : entry.kind,
      ),
    ).toEqual([['a', 'b'], 'answer', ['c']]);
    const first = entries[0]!;
    expect(first.kind === 'turn' && first.turn.finalText).toBe('What is the price');
    // Times since the call started: the first item, here.
    expect(entries.map((entry) => (entry.kind === 'call' ? null : entry.elapsed))).toEqual([
      0, 9_000, 19_000,
    ]);
  });
});

describe('transcriptText', () => {
  const items = conversationItems(
    [line('a', 'them', 'what is the price', 10), line('b', 'you', 'let me check', 20)],
    [
      answer(
        'x',
        'Fifty two dollars a seat.\n- Billed yearly\nTip: Offer the sheet.\nNote: Check with finance.',
        15,
      ),
    ],
  );

  it('has the speakers, the answer and the tip, in order', () => {
    const out = transcriptText(SESSION, items, [], 'Sam Rivera');
    expect(out).toContain('Paramount AI transcript: Lantern Freight (invented) (Data Analyst)');
    expect(out).toContain('Them  00:00\nWhat is the price');
    expect(out).toContain('Sam Rivera  00:00\nLet me check');
    expect(out).toContain('Paramount AI answered  00:00\nQuestion: What is the price?');
    expect(out).toContain('Answer: Fifty two dollars a seat.\n- Billed yearly');
    expect(out).toContain('Offer the sheet.');
    expect(out.indexOf('Them  ')).toBeLessThan(out.indexOf('Paramount AI answered'));
    expect(out.indexOf('Paramount AI answered')).toBeLessThan(out.indexOf('Sam Rivera  '));
  });

  it('says "You" when the account name is not known', () => {
    expect(transcriptText(SESSION, items)).toContain('You  00:00\nLet me check');
  });

  it('leaves out the private note', () => {
    expect(transcriptText(SESSION, items)).not.toContain('finance');
    expect(text(transcriptPdf(SESSION, items).bytes)).not.toContain('finance');
  });

  it("restores the session's own spellings", () => {
    const named = conversationItems([line('a', 'them', 'ask lantern about it', 1)], []);
    expect(transcriptText(SESSION, named, ['Lantern'])).toContain('Ask Lantern about it');
  });
});

describe('transcriptFileName', () => {
  it('makes a safe name from the company', () => {
    expect(transcriptFileName({ company: 'Lantern Freight (invented)' }, 'txt')).toBe(
      'paramount-ai-transcript-lantern-freight-invented.txt',
    );
    expect(transcriptFileName({ company: '../..' }, 'pdf')).toBe('paramount-ai-transcript.pdf');
  });
});

describe('wrapText', () => {
  it('breaks at spaces, and inside a word only when it alone is too long', () => {
    expect(wrapText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 4)).toEqual(['']);
  });
});

describe('writePdf', () => {
  it('is a well-formed file: every offset in its table points at its object', () => {
    const file = text(writePdf('Title', [{ text: 'Hello' }, { text: 'Bold', bold: true }]).bytes);
    expect(file.startsWith('%PDF-1.4')).toBe(true);
    expect(file.trimEnd().endsWith('%%EOF')).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(file)?.[1]);
    expect(file.slice(start, start + 4)).toBe('xref');
    const rows = file.slice(start).split('\n').slice(3);
    const count = Number(/xref\n0 (\d+)/.exec(file)?.[1]) - 1;
    for (let i = 0; i < count; i += 1) {
      const offset = Number(rows[i]!.slice(0, 10));
      expect(file.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    }
    // Each stream's stated length is its real length.
    for (const match of file.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
      const from = match.index + match[0].length;
      expect(file.slice(from + Number(match[1]), from + Number(match[1]) + 10)).toBe(
        '\nendstream\n'.slice(0, 10),
      );
    }
  });

  it('starts new pages when one is full', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ text: `Line ${i}` }));
    const file = text(writePdf('Long', lines).bytes);
    const count = Number(/\/Count (\d+)/.exec(file)?.[1]);
    expect(count).toBeGreaterThan(3);
    expect(file.match(/\/Type \/Page /g)).toHaveLength(count);
    expect(file).toContain('(Line 199)');
  });

  it('escapes what a PDF string needs, and keeps Western letters and typographic marks', () => {
    const { bytes, lossy } = writePdf('T', [{ text: 'a (b) c\\d café “q” – x’s' }]);
    const file = text(bytes);
    expect(file).toContain('a \\(b\\) c\\\\d caf\xe9 \x93q\x94 \x96 x\x92s');
    expect(lossy).toBe(false);
  });

  it('says when letters could not be drawn', () => {
    const { bytes, lossy } = writePdf('T', [{ text: 'hello 你好' }]);
    expect(lossy).toBe(true);
    expect(text(bytes)).toContain('hello ??');
  });
});

describe('the PDF in a real reader', () => {
  it('opens in pdf.js, with its pages and text intact', async () => {
    const pdfjs = await import('pdfjs-dist/webpack.mjs');
    const lines = Array.from({ length: 100 }, (_, i) => ({ text: `Line number ${i} (café)` }));
    const { bytes } = writePdf('Paramount AI transcript', lines);
    const task = pdfjs.getDocument({ data: bytes.slice() });
    const document = await task.promise;
    expect(document.numPages).toBeGreaterThan(1);
    const words: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) if ('str' in item) words.push(item.str);
    }
    const text = words.join(' ');
    expect(text).toContain('Line number 0 (café)');
    expect(text).toContain('Line number 99 (café)');
    await task.destroy();
    // Loading pdf.js for the first time can take several seconds on a cold run.
  }, 60_000);
});

describe('calls (v1.1.0, item 24)', () => {
  /**
   * An invented saved line.
   *
   * @param id     Its id.
   * @param tStart Start (ms).
   * @returns The line.
   */
  const savedLine = (id: string, tStart: number): StoredUtterance => ({
    id,
    sessionId: 's1',
    speaker: 'them',
    text: 'Invented words.',
    tStart,
    tEnd: tStart + 1_000,
  });

  /**
   * An invented saved answer.
   *
   * @param id             Its id.
   * @param createdAt      When it was asked (ms).
   * @param callStartedAt  When its call connected (ms).
   * @returns The answer.
   */
  const savedAnswer = (id: string, createdAt: number, callStartedAt?: number): StoredAnswer =>
    ({
      id,
      sessionId: 's1',
      mode: 'answer',
      question: `Question ${id}?`,
      text: `Answer ${id}.`,
      createdAt,
      ...(callStartedAt === undefined ? {} : { callStartedAt }),
    }) as StoredAnswer;

  const GAP = 45 * 60_000;

  it('starts a call at a long gap, or where an answer says one started', () => {
    expect(callStarts(conversationItems([savedLine('a', 0), savedLine('b', 1_000)], []))).toEqual([
      0,
    ]);
    expect(callStarts(conversationItems([savedLine('a', 0), savedLine('b', GAP)], []))).toEqual([
      0,
      GAP,
    ]);
    // Close in time, but the answer knows it was a new call.
    expect(
      callStarts(conversationItems([savedLine('a', 0)], [savedAnswer('x', 60_000, 50_000)])),
    ).toEqual([0, 60_000]);
  });

  it('puts a divider before each call only when there are several', () => {
    const one = conversationEntries(conversationItems([savedLine('a', 0)], []));
    expect(one.map((entry) => entry.kind)).toEqual(['turn']);
    const two = conversationEntries(
      conversationItems([savedLine('a', 0), savedLine('b', GAP)], []),
    );
    expect(two.map((entry) => entry.kind)).toEqual(['call', 'turn', 'call', 'turn']);
    // Each call's clock starts again.
    expect(two.flatMap((entry) => (entry.kind === 'turn' ? [entry.elapsed] : []))).toEqual([0, 0]);
  });

  /**
   * An entry's short name, for comparing orders.
   *
   * @param entry The entry.
   * @returns The turn's id, the answer's id, or "call@<time>".
   */
  const nameOf = (entry: ReturnType<typeof conversationEntries>[number]) =>
    entry.kind === 'turn'
      ? entry.turn.id
      : entry.kind === 'answer'
        ? entry.answer.id
        : `call@${entry.at}`;

  it('newest first keeps each divider above its own call, and each answer under its turn', () => {
    // Over 8 s apart: two turns of the same speaker.
    const entries = conversationEntries(
      conversationItems(
        [savedLine('a', 0), savedLine('b', 10_000), savedLine('c', GAP)],
        [savedAnswer('x', 5_000)],
      ),
    );
    expect(entries.map(nameOf)).toEqual(['call@0', 'a', 'x', 'b', `call@${GAP}`, 'c']);
    expect(orderEntries(entries, false).map(nameOf)).toEqual([
      `call@${GAP}`,
      'c',
      'call@0',
      'b',
      'a',
      'x',
    ]);
    expect(orderEntries(entries, true)).toEqual(entries);
  });

  it('newest first with one call reverses the turns, answers staying under theirs', () => {
    const entries = conversationEntries(
      conversationItems([savedLine('a', 0), savedLine('b', 10_000)], [savedAnswer('x', 5_000)]),
    );
    expect(orderEntries(entries, false).map(nameOf)).toEqual(['b', 'a', 'x']);
  });

  it('the download has a divider between calls, and the contact name on each turn', () => {
    const text = transcriptText(
      { company: 'Harbor Lane', role: '', contactName: 'Dana' },
      conversationItems([savedLine('a', 0), savedLine('b', GAP)], []),
    );
    expect(text.match(/--- Call of /g)).toHaveLength(1);
    expect(text).toContain('Dana  00:00\nInvented words.');
    expect(text).not.toContain('Them  ');
    expect(text).not.toContain('()');
  });
});
