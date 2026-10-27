/**
 * Tests for apps/web/src/core/stt/hotwords.ts:
 * formatHotwords() upper-cases and cleans phrases into the model's alphabet, reads an optional
 * " :score" per line (default otherwise), skips lines with no letters or a bad score, and builds
 * the sherpa-onnx hotwords buffer ('' when the list is empty).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOTWORD_SCORE, formatHotwords } from '@/core/stt/hotwords';

describe('formatHotwords', () => {
  it('upper-cases phrases and reads per-line scores', () => {
    const result = formatHotwords('Bluefin Route :2\nNorthwind Logistics :2.5');
    expect(result.hotwords).toEqual([
      { phrase: 'BLUEFIN ROUTE', score: 2 },
      { phrase: 'NORTHWIND LOGISTICS', score: 2.5 },
    ]);
    expect(result.buffer).toBe('BLUEFIN ROUTE :2\nNORTHWIND LOGISTICS :2.5\n');
    expect(result.skippedLines).toEqual([]);
  });

  it('uses the default score and ignores empty lines', () => {
    const result = formatHotwords('\n  Kite  \n\n');
    expect(result.hotwords).toEqual([{ phrase: 'KITE', score: DEFAULT_HOTWORD_SCORE }]);
    expect(formatHotwords('Kite', 3).hotwords[0]?.score).toBe(3);
  });

  it('keeps apostrophes inside words and turns other characters into spaces', () => {
    expect(formatHotwords("O'Brien's Co-op, Ltd. 'quoted'").hotwords[0]?.phrase).toBe(
      "O'BRIEN'S CO OP LTD QUOTED",
    );
  });

  it('skips lines with no letters left or an invalid score', () => {
    const result = formatHotwords('123 :2\nAcme :abc\nAcme :0\nAcme :50\nGood :1');
    expect(result.hotwords).toEqual([{ phrase: 'GOOD', score: 1 }]);
    expect(result.skippedLines).toEqual([1, 2, 3, 4]);
  });

  it('returns an empty buffer for an empty list (hotwords off)', () => {
    expect(formatHotwords('   ')).toEqual({ hotwords: [], buffer: '', skippedLines: [] });
  });
});
