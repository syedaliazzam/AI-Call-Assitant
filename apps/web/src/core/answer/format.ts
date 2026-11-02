/**
 * File: apps/web/src/core/answer/format.ts
 * Purpose: Splits an answer's text (complete or still streaming) into its parts: the answer
 *          line, the bullet points, an optional closing tip to say, and an optional private note
 *          for the user only. Joins the speakable parts back as plain text for Copy.
 * Used by: src/features/live/AnswerPanel.tsx, src/features/live/LiveAnswers.tsx (the overlay)
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
  /** The first line, the answer to say ('' before any text has arrived). */
  headline: string;
  /** The bullet points after it, without their marks (lines that are not bullets included). */
  bullets: string[];
  /** The closing line to say ("Tip: …", without its label), or '' when there is none. */
  tip: string;
  /** A private note for the user, not to be said ("Note: …", without its label), or ''. */
  note: string;
}

/** A "Headline:" label at the start of the first line (any case, after Markdown is removed). */
const HEADLINE_LABEL = /^headline\s*:\s*/i;

/** The label of a closing tip line. */
const TIP_LABEL = /^tip\s*:\s*/i;

/** The label of a private note line. */
const NOTE_LABEL = /^(?:private\s+)?note\s*:\s*/i;

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
 * Splits an answer into its parts. A line after the first that starts "Tip:" or "Note:" is the
 * closing tip or the private note; every other line is a bullet. While the text streams, a line
 * becomes the tip or note as soon as its label has arrived.
 *
 * @param text The answer text so far.
 * @returns The answer line (first non-empty line), bullets, tip and note.
 * Called from: AnswerPanel.tsx; LiveAnswers.tsx; answerText(); tests
 */
export function splitAnswer(text: string): AnswerParts {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const [first = '', ...rest] = lines;
  const bullets: string[] = [];
  let tip = '';
  let note = '';
  for (const line of rest) {
    const clean = plain(line.replace(BULLET_MARK, ''));
    if (!clean) continue;
    if (TIP_LABEL.test(clean)) tip = clean.replace(TIP_LABEL, '');
    else if (NOTE_LABEL.test(clean)) note = clean.replace(NOTE_LABEL, '');
    else bullets.push(clean);
  }
  return {
    // A model sometimes labels the first line "Headline:"; the panel shows the headline itself.
    headline: plain(first.replace(BULLET_MARK, '')).replace(HEADLINE_LABEL, ''),
    bullets,
    tip,
    note,
  };
}

/**
 * The answer as plain text for the clipboard: the answer line, "- " bullets and the tip. The
 * private note is left out: it is not part of what the user says.
 *
 * @param text The answer text.
 * @returns Clean text.
 * Called from: AnswerPanel.tsx (Copy); tests
 */
export function answerText(text: string): string {
  const { headline, bullets, tip } = splitAnswer(text);
  return [headline, ...bullets.map((bullet) => `- ${bullet}`), ...(tip ? [tip] : [])].join('\n');
}
