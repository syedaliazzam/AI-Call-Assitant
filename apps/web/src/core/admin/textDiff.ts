/**
 * File: apps/web/src/core/admin/textDiff.ts
 * Purpose: A word-by-word difference between two texts, for Admin → AI settings' version history
 *          ("view diff against the current one", ADR-0083): which words an older version has that the
 *          current one does not, and the other way round. Long full prompts (ADR-0086) that differ
 *          throughout fall back to a line-by-line difference, so the table stays small. ADR-0089: a
 *          side-by-side line diff (diffLines()) with word changes inside each changed line.
 * Used by: src/features/admin/ai-settings/SideBySideDiff.tsx
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md, ADR-0089-global-prompts-with-locked-contract.md
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
 * Splits text into lines, each keeping its line break (so joining gives the text back).
 *
 * @param text The text.
 * @returns The lines.
 * Called from: diffWords()
 */
function lineTokens(text: string): string[] {
  return text.split(/(?<=\n)/).filter((piece) => piece !== '');
}

/**
 * The most table cells the word-level comparison may use (4 bytes each: about 16 MB). Two long full
 * prompts that differ throughout (ADR-0086) would need far more; they are compared line by line.
 */
const MAX_DIFF_CELLS = 4_000_000;

/**
 * The word difference from `before` to `after`. Two long texts that differ throughout are compared
 * line by line instead (MAX_DIFF_CELLS), and as a whole when even that is too large.
 *
 * @param before The old text (for example an earlier version).
 * @param after  The new text (for example the version in force).
 * @returns The runs in reading order; joining 'same' and 'removed' gives `before`, joining 'same' and
 *          'added' gives `after`.
 * Called from: VersionHistory.tsx; tests
 */
export function diffWords(before: string, after: string): DiffPart[] {
  return (
    diffPieces(tokens(before), tokens(after)) ??
    diffPieces(lineTokens(before), lineTokens(after)) ?? [
      ...(before ? [{ kind: 'removed' as const, text: before }] : []),
      ...(after ? [{ kind: 'added' as const, text: after }] : []),
    ]
  );
}

/**
 * The difference between two lists of pieces (longest common subsequence after the common start and
 * end are set aside).
 *
 * @param a The old text's pieces.
 * @param b The new text's pieces.
 * @returns The runs, or null when the table would pass MAX_DIFF_CELLS.
 * Called from: diffWords()
 */
function diffPieces(a: readonly string[], b: readonly string[]): DiffPart[] | null {
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
  if (rows * cols > MAX_DIFF_CELLS) return null;
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

/** One row of a side-by-side diff (ADR-0089): a line of the old text, the new text, or both. */
export interface DiffRow {
  /**
   * 'same' (the line is in both), 'changed' (an old line replaced by a new one, with word changes),
   * 'removed' (only in the old text) or 'added' (only in the new text).
   */
  kind: 'same' | 'changed' | 'removed' | 'added';
  /** The old line, or null for an added line. */
  left: string | null;
  /** The new line, or null for a removed line. */
  right: string | null;
  /** For 'changed': the word diff of the two lines (removed words for the left, added for the right). */
  words?: DiffPart[];
  /** The old line's number (from 1), or null. */
  leftNumber: number | null;
  /** The new line's number (from 1), or null. */
  rightNumber: number | null;
}

/** Above this many line pairs the line diff gives up on matching and shows old then new. */
const MAX_LINE_CELLS = 2_000_000;

/**
 * A side-by-side diff of two texts, line by line: the longest run of equal lines is kept in place,
 * and each run of removed lines next to a run of added lines is paired up as changed lines (with a
 * word diff), so an edited sentence reads as one row.
 *
 * @param before The old text.
 * @param after  The new text.
 * @returns The rows, top to bottom.
 * Called from: src/features/admin/ai-settings/SideBySideDiff.tsx; tests
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before === '' ? [] : before.replace(/\r\n?/g, '\n').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n?/g, '\n').split('\n');
  const rows = a.length + 1;
  const cols = b.length + 1;
  // A plain list of edits: 's' same, 'r' removed, 'a' added.
  const edits: ('s' | 'r' | 'a')[] = [];
  if (rows * cols <= MAX_LINE_CELLS) {
    const lengths = new Uint32Array(rows * cols);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lengths[i * cols + j] =
          a[i] === b[j]
            ? lengths[(i + 1) * cols + j + 1]! + 1
            : Math.max(lengths[(i + 1) * cols + j]!, lengths[i * cols + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        edits.push('s');
        i += 1;
        j += 1;
      } else if (lengths[(i + 1) * cols + j]! >= lengths[i * cols + j + 1]!) {
        edits.push('r');
        i += 1;
      } else {
        edits.push('a');
        j += 1;
      }
    }
    while (i++ < a.length) edits.push('r');
    while (j++ < b.length) edits.push('a');
  } else {
    edits.push(...a.map(() => 'r' as const), ...b.map(() => 'a' as const));
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < edits.length) {
    if (edits[k] === 's') {
      out.push({ kind: 'same', left: a[i]!, right: b[j]!, leftNumber: i + 1, rightNumber: j + 1 });
      i += 1;
      j += 1;
      k += 1;
      continue;
    }
    // A run of removed and added lines, in any order: pair them up.
    const removed: number[] = [];
    const added: number[] = [];
    while (k < edits.length && edits[k] !== 's') {
      if (edits[k] === 'r') removed.push(i++);
      else added.push(j++);
      k += 1;
    }
    const pairs = Math.max(removed.length, added.length);
    for (let p = 0; p < pairs; p += 1) {
      const left = removed[p];
      const right = added[p];
      if (left !== undefined && right !== undefined) {
        out.push({
          kind: 'changed',
          left: a[left]!,
          right: b[right]!,
          words: diffWords(a[left]!, b[right]!),
          leftNumber: left + 1,
          rightNumber: right + 1,
        });
      } else if (left !== undefined) {
        out.push({
          kind: 'removed',
          left: a[left]!,
          right: null,
          leftNumber: left + 1,
          rightNumber: null,
        });
      } else if (right !== undefined) {
        out.push({
          kind: 'added',
          left: null,
          right: b[right]!,
          leftNumber: null,
          rightNumber: right + 1,
        });
      }
    }
  }
  return out;
}
