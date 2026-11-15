/**
 * Tests for apps/web/src/core/admin/textDiff.ts (ADR-0083): the word diff Admin → AI settings shows
 * between an earlier version and the one in force. Joining the 'same' and 'removed' runs gives the old
 * text, 'same' and 'added' the new one; equal texts are one 'same' run; runs of one kind are merged.
 */
import { describe, expect, it } from 'vitest';
import { diffWords, type DiffPart } from '@/core/admin/textDiff';

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
});
