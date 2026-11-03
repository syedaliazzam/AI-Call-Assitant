/**
 * Tests: apps/web/src/core/review/conversation.ts and pdf.ts. Lines and answers merge in time order;
 * on screen, runs of lines between answers become bubbles (v1.0.2);
 * downloads say the same in TXT and PDF, and leave out the private note; the PDF is a well-formed
 * file (its table of offsets points at its objects) that wraps, pages and escapes correctly, and it
 * says when letters could not be drawn.
 */
import { describe, expect, it } from 'vitest';
import {
  conversationEntries,
  conversationItems,
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

describe('conversationEntries (v1.0.2 bubbles)', () => {
  it('groups each run of lines into bubbles and keeps answers in place', () => {
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
      entries.map((entry) => (entry.kind === 'group' ? entry.group.lineIds : entry.kind)),
    ).toEqual([['a', 'b'], 'answer', ['c']]);
    const first = entries[0]!;
    expect(first.kind === 'group' && first.group.finalText).toBe('What is the price');
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
    const out = transcriptText(SESSION, items);
    expect(out).toContain('Kite transcript: Lantern Freight (invented) (Data Analyst)');
    expect(out).toContain('Them: What is the price');
    expect(out).toContain('You: Let me check');
    expect(out).toContain('Kite answer (question: What is the price?)');
    expect(out).toContain('    Fifty two dollars a seat.');
    expect(out).toContain('    - Billed yearly');
    expect(out).toContain('    Offer the sheet.');
    expect(out.indexOf('Them:')).toBeLessThan(out.indexOf('Kite answer'));
    expect(out.indexOf('Kite answer')).toBeLessThan(out.indexOf('You:'));
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
      'kite-transcript-lantern-freight-invented.txt',
    );
    expect(transcriptFileName({ company: '../..' }, 'pdf')).toBe('kite-transcript.pdf');
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
    const { bytes } = writePdf('Kite transcript', lines);
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
