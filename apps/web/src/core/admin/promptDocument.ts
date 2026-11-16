/**
 * File: apps/web/src/core/admin/promptDocument.ts
 * Purpose: Reads a global prompt (plain text with light Markdown) as a document, for Admin → AI settings
 *          (ADR-0089): the Preview's blocks (headings, bullet lists with levels, quoted examples,
 *          paragraphs), the inline runs (bold, code, "quoted words"), each line's kind for the editor's
 *          highlighting, and the matches of a search. No React and no dependency: React renders every
 *          piece as text, so nothing in a prompt can become HTML.
 * Used by: src/features/admin/ai-settings/PromptPreview.tsx, PromptTextEditor.tsx
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 */

/** One block of the Preview. */
export type PromptBlock =
  | {
      /** A heading: a "#" line, or a short line ending in ":" ("How to answer for the call:"). */
      kind: 'heading';
      /** 1 for "#" or a colon heading, 2 for "##", 3 for "###" and deeper. */
      level: 1 | 2 | 3;
      /** Its words, without the marks or the colon. */
      text: string;
    }
  | {
      /** A run of bullet lines. */
      kind: 'list';
      /** Its items, in order. */
      items: { text: string; level: number }[];
    }
  | {
      /** Quoted examples: "> " lines, or lines indented by two spaces or more under a bullet. */
      kind: 'quote';
      /** Its lines. */
      lines: string[];
    }
  | {
      /** A paragraph (lines joined with spaces). */
      kind: 'paragraph';
      /** Its text. */
      text: string;
    };

/** A heading made with "#" marks. */
const HASH_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** A bullet: "-", "*", "•" or "1." / "1)", with its indentation. */
const BULLET = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/;

/** A quote line ("> "). */
const QUOTE = /^\s*>\s?(.*)$/;

/**
 * Whether a line is a colon heading: not a bullet, not indented, at most 90 characters, ending in ":".
 *
 * @param line The line.
 * @returns True for "How to answer for the call:" and the like.
 * Called from: promptBlocks(), lineKind()
 */
function isColonHeading(line: string): boolean {
  return (
    !/^\s/.test(line) && !BULLET.test(line) && line.trim().length <= 90 && /\S:\s*$/.test(line)
  );
}

/**
 * Splits a prompt into the Preview's blocks.
 *
 * @param text The prompt.
 * @returns The blocks, in order.
 * Called from: PromptPreview.tsx; tests
 */
export function promptBlocks(text: string): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  let paragraph: string[] = [];
  /** Ends the paragraph being collected, if any. */
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      endParagraph();
      continue;
    }
    const hash = HASH_HEADING.exec(line);
    if (hash) {
      endParagraph();
      const level = Math.min(hash[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: hash[2]! });
      continue;
    }
    if (isColonHeading(line)) {
      endParagraph();
      blocks.push({ kind: 'heading', level: 1, text: line.trim().replace(/:\s*$/, '') });
      continue;
    }
    const quote = QUOTE.exec(line);
    const bullet = BULLET.exec(line);
    const last = blocks.at(-1);
    if (quote || (!bullet && /^\s{2,}\S/.test(line) && last && last.kind !== 'paragraph')) {
      endParagraph();
      const words = quote ? quote[1]! : line.trim();
      const previous = blocks.at(-1);
      if (previous?.kind === 'quote') previous.lines.push(words);
      else blocks.push({ kind: 'quote', lines: [words] });
      continue;
    }
    if (bullet) {
      endParagraph();
      const item = { text: bullet[2]!, level: Math.floor(bullet[1]!.length / 2) };
      const previous = blocks.at(-1);
      if (previous?.kind === 'list') previous.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
      continue;
    }
    paragraph.push(line.trim());
  }
  endParagraph();
  return blocks;
}

/** One run of a line in the Preview. */
export interface InlineRun {
  /** The words, without the marks (quotes keep theirs). */
  text: string;
  /** How to show them. */
  style: 'plain' | 'bold' | 'code' | 'quoted';
}

/** Bold (**…**), code (`…`) and quoted words ("…" or “…”). */
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|"[^"\n]{1,200}"|“[^”\n]{1,200}”)/;

/**
 * Splits a line into runs: bold, code, quoted words and plain text.
 *
 * @param line The line.
 * @returns The runs, in order.
 * Called from: PromptPreview.tsx; tests
 */
export function inlineRuns(line: string): InlineRun[] {
  return line
    .split(INLINE)
    .filter((piece) => piece !== '')
    .map((piece): InlineRun => {
      if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
        return { text: piece.slice(2, -2), style: 'bold' };
      }
      if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
        return { text: piece.slice(1, -1), style: 'code' };
      }
      if (/^(?:".*"|“.*”)$/s.test(piece) && piece.length > 2)
        return { text: piece, style: 'quoted' };
      return { text: piece, style: 'plain' };
    });
}

/** How the editor colours a line. */
export type LineKind = 'heading' | 'bullet' | 'quote' | 'text' | 'blank';

/**
 * The editor's kind for one line.
 *
 * @param line The line.
 * @returns Its kind.
 * Called from: PromptTextEditor.tsx; tests
 */
export function lineKind(line: string): LineKind {
  if (line.trim() === '') return 'blank';
  if (HASH_HEADING.test(line) || isColonHeading(line)) return 'heading';
  if (QUOTE.test(line)) return 'quote';
  if (BULLET.test(line)) return 'bullet';
  if (/^\s{2,}\S/.test(line)) return 'quote';
  return 'text';
}

/**
 * The length of a bullet line's mark with its spaces ("- " is 2, "  - " is 4), or 0 for any other line.
 *
 * @param line The line.
 * @returns The length.
 * Called from: PromptTextEditor.tsx; tests
 */
export function bulletMarkLength(line: string): number {
  const match = /^(\s*(?:[-*•]|\d+[.)])\s+)/.exec(line);
  return match ? match[1]!.length : 0;
}

/**
 * Where a search finds its words (any case), as [start, end) offsets in the text, without overlaps.
 *
 * @param text  The text searched.
 * @param query The words looked for ('' finds nothing).
 * @returns The matches, in order.
 * Called from: PromptTextEditor.tsx; tests
 */
export function findMatches(text: string, query: string): [number, number][] {
  if (query === '') return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    matches.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return matches;
}
