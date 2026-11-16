/**
 * Tests for apps/web/src/core/admin/textDiff.ts (ADR-0083): the word diff Admin → AI settings shows
 * between an earlier version and the one in force. Joining the 'same' and 'removed' runs gives the old
 * text, 'same' and 'added' the new one; equal texts are one 'same' run; runs of one kind are merged.
 * ADR-0086: two long texts that differ throughout are compared line by line.
 * ADR-0089: diffLines() gives side-by-side rows: equal lines kept, an edited line paired with its new
 * text (with a word diff), removed and added lines on their own side, with line numbers.
 */
import { describe, expect, it } from 'vitest';
import { diffLines, diffWords, type DiffPart } from '@/core/admin/textDiff';

/**
 * The text a diff gives back for one side.
 *
 * @param parts The diff.
 * @param which 'before' (same + removed) or 'after' (same + added).
 * @returns The text.
 */
function side(parts: readonly DiffPart[], which: 'before' | 'after'): string {
  const skip = which === 'before' ? 'added' : 'removed';
  return parts
    .filter((part) => part.kind !== skip)
    .map((part) => part.text)
    .join('');
}

describe('diffWords', () => {
  it('marks a changed word in the middle of a sentence', () => {
    const parts = diffWords('Say users, never clients.', 'Say customers, never clients.');
    expect(parts).toEqual([
      { kind: 'same', text: 'Say ' },
      { kind: 'removed', text: 'users,' },
      { kind: 'added', text: 'customers,' },
      { kind: 'same', text: ' never clients.' },
    ]);
  });

  it('gives back both texts exactly, with new lines', () => {
    const before = 'Tone: warm.\nLength: short.\nUse STAR.';
    const after = 'Tone: confident and warm.\nUse STAR for behavioural questions.\nNew line.';
    const parts = diffWords(before, after);
    expect(side(parts, 'before')).toBe(before);
    expect(side(parts, 'after')).toBe(after);
  });

  it('handles equal, empty and fully different texts', () => {
    expect(diffWords('Same text.', 'Same text.')).toEqual([{ kind: 'same', text: 'Same text.' }]);
    expect(diffWords('', 'Added.')).toEqual([{ kind: 'added', text: 'Added.' }]);
    expect(diffWords('Removed.', '')).toEqual([{ kind: 'removed', text: 'Removed.' }]);
    expect(diffWords('', '')).toEqual([]);
  });

  it('stays quick on two full 4,000-character versions', () => {
    const words = Array.from({ length: 700 }, (_, index) => `word${index % 97}`);
    const before = words.join(' ').slice(0, 4_000);
    const after = words.reverse().join(' ').slice(0, 4_000);
    const started = performance.now();
    const parts = diffWords(before, after);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(side(parts, 'after')).toBe(after);
  });

  it('ADR-0086: compares two long full prompts that differ throughout line by line, still exact', () => {
    const lines = (seed: number) =>
      Array.from(
        { length: 400 },
        (_, index) => `Rule ${(index * seed) % 397}: keep answers short and true.\n`,
      ).join('');
    const before = lines(3);
    const after = lines(7);
    const started = performance.now();
    const parts = diffWords(before, after);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(side(parts, 'before')).toBe(before);
    expect(side(parts, 'after')).toBe(after);
    // Line by line: every run is made of whole lines.
    for (const part of parts) expect(part.text.endsWith('\n')).toBe(true);
  });
});

describe('diffLines (ADR-0089)', () => {
  it('keeps equal lines, pairs an edited line, and places removed and added lines', () => {
    const rows = diffLines(
      'Intro\nBe brief.\nOld rule.\nEnd',
      'Intro\nBe very brief.\nEnd\nNew rule.',
    );
    expect(rows.map((row) => row.kind)).toEqual(['same', 'changed', 'removed', 'same', 'added']);
    expect(rows[1]).toMatchObject({
      left: 'Be brief.',
      right: 'Be very brief.',
      leftNumber: 2,
      rightNumber: 2,
    });
    expect(
      rows[1]!
        .words!.filter((part) => part.kind === 'added')
        .map((part) => part.text)
        .join(''),
    ).toContain('very');
    expect(rows[2]).toMatchObject({
      left: 'Old rule.',
      right: null,
      leftNumber: 3,
      rightNumber: null,
    });
    expect(rows[4]).toMatchObject({
      left: null,
      right: 'New rule.',
      leftNumber: null,
      rightNumber: 4,
    });
  });

  it('gives only same rows for equal texts, and handles empty sides', () => {
    expect(diffLines('a\nb', 'a\nb').every((row) => row.kind === 'same')).toBe(true);
    expect(diffLines('', 'a').map((row) => row.kind)).toEqual(['added']);
    expect(diffLines('a', '').map((row) => row.kind)).toEqual(['removed']);
  });
});
