/**
 * File: apps/web/src/core/answer/markdown.ts
 * Purpose: Splits a private answer (Ask Kite) into blocks to show: paragraphs, lists, headings and
 *          code blocks, while the text is still streaming. Kept small and with no dependency: React
 *          renders the text as text, so nothing in an answer can become HTML.
 * Used by: src/features/answers/AnswerBody.tsx
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */

/** One block of a private answer. */
export type MarkdownBlock =
  | {
      /** A paragraph. */
      kind: 'paragraph';
      /** Its text (lines joined with spaces). */
      text: string;
    }
  | {
      /** A heading. */
      kind: 'heading';
      /** Its text. */
      text: string;
    }
  | {
      /** A list. */
      kind: 'list';
      /** True for a numbered list. */
      ordered: boolean;
      /** Its items. */
      items: string[];
    }
  | {
      /** A code block. */
      kind: 'code';
      /** The language it names ('' when none). */
      language: string;
      /** The code. */
      text: string;
    };

/** A list item's mark: "-", "*", "•" or "1." / "1)". */
const LIST_ITEM = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;

/**
 * Splits text into blocks. A code block that has not closed yet runs to the end, so code appears as
 * it streams.
 *
 * @param text The answer so far.
 * @returns The blocks, in order.
 * Called from: AnswerBody.tsx; tests
 */
export function markdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  /** Ends the paragraph being collected, if any. */
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w+#-]*)\s*$/.exec(line);
    if (fence) {
      endParagraph();
      const code: string[] = [];
      for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]!); i += 1) code.push(lines[i]!);
      blocks.push({ kind: 'code', language: fence[1] ?? '', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      endParagraph();
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({ kind: 'heading', text: heading[1]!.trim() });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      endParagraph();
      const ordered = item[2] !== undefined;
      const last = blocks.at(-1);
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item[3]!.trim());
      else blocks.push({ kind: 'list', ordered, items: [item[3]!.trim()] });
      continue;
    }
    paragraph.push(line.trim());
  }
  endParagraph();
  return blocks;
}

/** One piece of a line: plain text, bold or inline code. */
export interface InlinePiece {
  /** The words. */
  text: string;
  /** How to show them. */
  style: 'plain' | 'bold' | 'code';
}

/**
 * Splits a line at **bold** and `code` marks.
 *
 * @param line The line.
 * @returns The pieces, without the marks.
 * Called from: AnswerBody.tsx; tests
 */
export function inlinePieces(line: string): InlinePiece[] {
  return line
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter((piece) => piece !== '')
    .map((piece) => {
      if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
        return { text: piece.slice(2, -2), style: 'bold' as const };
      }
      if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
        return { text: piece.slice(1, -1), style: 'code' as const };
      }
      return { text: piece, style: 'plain' as const };
    });
}
