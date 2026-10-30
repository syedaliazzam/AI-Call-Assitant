/**
 * File: apps/web/src/core/answer/format.ts
 * Purpose: Splits an answer's text (complete or still streaming) into the headline and the
 *          bullet points the answer panel shows, and joins them back as plain text for Copy.
 * Used by: src/features/live/AnswerPanel.tsx
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 6 (headline, then
 *               bullets); day-04-answers.md Stage 6
 *
 * The prompt asks for a headline first and then at most 5 bullets (server/prompt.ts), but the
 * text arrives a few words at a time, and Claude sometimes adds Markdown marks (**bold**, "- ",
 * "• ", "1. "). Those marks are removed so the panel shows clean text.
 */

/** An answer split for display. */
export interface AnswerParts {
  /** The first line ('' before any text has arrived). */
  headline: string;
  /** The bullet points after it, without their marks (lines that are not bullets included). */
  bullets: string[];
}

/** A "Headline:" label at the start of the first line (any case, after Markdown is removed). */
const HEADLINE_LABEL = /^headline\s*:\s*/i;

/** Bullet marks at the start of a line: "-", "*", "•", or "1." / "1)". */
const BULLET_MARK = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Removes Markdown emphasis and heading marks from a line.
 *
 * @param line One line of the answer.
 * @returns The line without **, __ or leading #.
 * Called from: splitAnswer()
 */
function plain(line: string): string {
  return line
    .replace(/^\s*#+\s*/, '')
    .replace(/\*\*|__/g, '')
    .trim();
}

/**
 * Splits an answer into its headline and bullets.
 *
 * @param text The answer text so far.
 * @returns The headline (first non-empty line) and the following lines as bullets.
 * Called from: AnswerPanel.tsx; answerText(); tests
 */
export function splitAnswer(text: string): AnswerParts {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const [first = '', ...rest] = lines;
  return {
    // A model sometimes labels the first line "Headline:"; the panel shows the headline itself.
    headline: plain(first.replace(BULLET_MARK, '')).replace(HEADLINE_LABEL, ''),
    bullets: rest.map((line) => plain(line.replace(BULLET_MARK, ''))).filter(Boolean),
  };
}

/**
 * The answer as plain text for the clipboard: the headline, then "- " bullets.
 *
 * @param text The answer text.
 * @returns Clean text.
 * Called from: AnswerPanel.tsx (Copy); tests
 */
export function answerText(text: string): string {
  const { headline, bullets } = splitAnswer(text);
  return [headline, ...bullets.map((bullet) => `- ${bullet}`)].join('\n');
}
