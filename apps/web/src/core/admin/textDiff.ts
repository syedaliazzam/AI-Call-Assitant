/**
 * File: apps/web/src/core/admin/textDiff.ts
 * Purpose: A word-by-word difference between two texts, for Admin → AI settings' version history
 *          ("view diff against the current one", ADR-0083): which words an older version has that the
 *          current one does not, and the other way round.
 * Used by: src/features/admin/ai-settings/VersionHistory.tsx
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 *
 * Pure: no browser or React. A longest-common-subsequence over words and the spaces between them, after
 * the common start and end are set aside (so a small edit to a long text stays cheap).
 */

/** One run of the difference. */
export interface DiffPart {
  /** 'same' in both texts, 'removed' only in the old one, 'added' only in the new one. */
  kind: 'same' | 'removed' | 'added';
  /** The text of the run (words with their spaces). */
  text: string;
}

/**
 * Splits text into words and the white space between them (both kept, so joining gives the text back).
 *
 * @param text The text.
 * @returns The pieces.
 * Called from: diffWords()
 */
function tokens(text: string): string[] {
  return text.split(/(\s+)/).filter((piece) => piece !== '');
}

/**
 * Adds a piece to the parts, joining it to the last part when that has the same kind.
 *
 * @param parts The parts so far (changed in place).
 * @param kind  The piece's kind.
 * @param text  The piece.
 * Called from: diffWords()
 */
function push(parts: DiffPart[], kind: DiffPart['kind'], text: string): void {
  const last = parts.at(-1);
  if (last && last.kind === kind) last.text += text;
  else parts.push({ kind, text });
}

/**
 * The word difference from `before` to `after`.
 *
 * @param before The old text (for example an earlier version).
 * @param after  The new text (for example the version in force).
 * @returns The runs in reading order; joining 'same' and 'removed' gives `before`, joining 'same' and
 *          'added' gives `after`.
 * Called from: VersionHistory.tsx; tests
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  // lengths[i * cols + j]: the longest common run of midA[i..] and midB[j..].
  const lengths = new Uint32Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      lengths[i * cols + j] =
        midA[i] === midB[j]
          ? lengths[(i + 1) * cols + j + 1]! + 1
          : Math.max(lengths[(i + 1) * cols + j]!, lengths[i * cols + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  if (start > 0) push(parts, 'same', a.slice(0, start).join(''));
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      push(parts, 'same', midA[i]!);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * cols + j]! >= lengths[i * cols + j + 1]!) {
      push(parts, 'removed', midA[i]!);
      i += 1;
    } else {
      push(parts, 'added', midB[j]!);
      j += 1;
    }
  }
  while (i < midA.length) push(parts, 'removed', midA[i++]!);
  while (j < midB.length) push(parts, 'added', midB[j++]!);
  if (endA < a.length) push(parts, 'same', a.slice(endA).join(''));
  return parts;
}
