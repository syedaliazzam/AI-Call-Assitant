/**
 * File: apps/web/src/core/answer/format.ts
 * Purpose: Splits an answer's text (complete or still streaming) into its parts: the answer line,
 *          the bullet points, any code blocks, an optional closing tip to say, what to say about
 *          the code, and an optional private note for the user only. Joins the speakable parts back
 *          as plain text for Copy.
 * Used by: src/features/answers/AnswerBody.tsx, src/features/live/AnswerPanel.tsx,
 *          src/features/live/LiveAnswers.tsx (the overlay), src/core/review/conversation.ts
 * Depends on: src/core/transcript/display.ts (sentenceCase, for the card's question)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 6 (headline, then
 *               bullets); day-04-answers.md Stage 6; ADR-0030 (the coding shape)
 *
 * The prompt asks for a headline first and then at most 5 bullets (server/prompt.ts), but the
 * text arrives a few words at a time, and Claude sometimes adds Markdown marks (**bold**, "- ",
 * "• ", "1. "). Those marks are removed so the panel shows clean text.
 */

import { sentenceCase, type DisplayTerm } from '../transcript/display';

/** A code block in an answer. */
export interface AnswerCode {
  /** The language it names, for example 'python' ('' when none). */
  language: string;
  /** The code, without its fences. */
  text: string;
}

/** An answer split for display. */
export interface AnswerParts {
  /** The first line, the answer to say ('' before any text has arrived). */
  headline: string;
  /** The bullet points after it, without their marks (lines that are not bullets included). */
  bullets: string[];
  /** Code blocks (the coding shape, ADR-0030), never treated as bullets. */
  code: AnswerCode[];
  /** How to say a coding answer ("Say: …", without its label), or ''. */
  say: string;
  /** The closing line to say ("Tip: …", without its label), or '' when there is none. */
  tip: string;
  /** A private note for the user, not to be said ("Note: …", without its label), or ''. */
  note: string;
}

/**
 * A "Headline:" or (v1.0.3) "Answer:" label at the start of the first line (any case, after Markdown
 * is removed): the card adds its own bold "Answer:", so one written by the model is dropped.
 */
const HEADLINE_LABEL = /^(?:headline|answer)\s*:\s*/i;

/** The label of a closing tip line. */
const TIP_LABEL = /^tip\s*:\s*/i;

/** The label of the line that says how to explain the code. */
const SAY_LABEL = /^(?:how to )?say(?: it)?\s*:\s*/i;

/** The label of a private note line. */
const NOTE_LABEL = /^(?:private\s+)?note\s*:\s*/i;

/** Bullet marks at the start of a line: "-", "*", "•", or "1." / "1)". */
const BULLET_MARK = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * A hidden line ("[[coding|call|docs]]", "[[question|…]]"). The server removes them (server/
 * answer-meta.ts); this is the second fail-safe, so one that slipped through is never shown.
 */
const HIDDEN_LINE = /^\s*\[\[/;

/**
 * A line about the other person rather than words to say ("If they want more depth, …", "You
 * could mention …"). The rules ask for depth only as the Tip (v1.0.2); a line like this that still
 * arrives is shown as the Tip, never as a bullet.
 */
const DEPTH_OFFER =
  /^(?:if (?:they|he|she|the (?:interviewer|client|customer|other person))\b[^.]*\b(?:want|wants|ask|asks|need|needs|press|presses)\b|(?:you|I) (?:could|can) (?:also )?(?:mention|add|offer)\b)/i;

/** A line that opens or closes a code block, with the language it may name. */
const CODE_FENCE = /^\s*```\s*([\w+#-]*)\s*$/;

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
 * Splits an answer into its parts. A line after the first that starts "Tip:", "Say:" or "Note:" is
 * that part; a fenced block is code (one still streaming runs to the end); every other line is a
 * bullet. While the text streams, a line becomes the tip or note as soon as its label has arrived.
 *
 * @param text The answer text so far.
 * @returns The answer line (first non-empty line), bullets, code, what to say, tip and note.
 * Called from: AnswerBody.tsx; LiveAnswers.tsx; answerText(); conversation.ts; tests
 */
export function splitAnswer(text: string): AnswerParts {
  const lines = text.split('\n');
  const bullets: string[] = [];
  const code: AnswerCode[] = [];
  let headline = '';
  let say = '';
  let tip = '';
  let note = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fence = CODE_FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]!); i += 1) body.push(lines[i]!);
      code.push({ language: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') continue;
    if (HIDDEN_LINE.test(line)) continue;
    if (headline === '' && bullets.length === 0 && code.length === 0) {
      // A model sometimes labels the first line "Headline:"; the panel shows the headline itself.
      headline = plain(line.replace(BULLET_MARK, '')).replace(HEADLINE_LABEL, '');
      continue;
    }
    const clean = plain(line.replace(BULLET_MARK, ''));
    if (!clean) continue;
    if (TIP_LABEL.test(clean)) tip = clean.replace(TIP_LABEL, '');
    else if (SAY_LABEL.test(clean)) say = clean.replace(SAY_LABEL, '');
    else if (NOTE_LABEL.test(clean)) note = clean.replace(NOTE_LABEL, '');
    // A depth offer is the Tip when there is none; a second one adds nothing to say.
    else if (DEPTH_OFFER.test(clean)) tip ||= clean;
    else bullets.push(clean);
  }
  return { headline, bullets, code, say, tip, note };
}

/**
 * The answer as plain text for the clipboard: the answer line, "- " bullets, the code, what to say
 * and the tip. The private note is left out: it is not part of what the user says.
 *
 * @param text The answer text.
 * @returns Clean text.
 * Called from: AnswerPanel.tsx and CompactView.tsx (Copy); tests
 */
export function answerText(text: string): string {
  const { headline, bullets, code, say, tip } = splitAnswer(text);
  return [
    headline,
    ...bullets.map((bullet) => `- ${bullet}`),
    ...code.map((block) => block.text),
    ...(say ? [say] : []),
    ...(tip ? [tip] : []),
  ].join('\n');
}

/**
 * The question to show on an answer card (v1.0.2, ADR-0037): Claude's cleaned question once it has
 * arrived, otherwise the raw words in sentence case (the speech model writes capitals), otherwise a
 * fallback.
 *
 * @param raw      The question as picked from the transcript or typed ('' when none).
 * @param clean    Claude's cleaned question, if it has arrived.
 * @param terms    The session's spellings to restore in the raw words (displayTerms()).
 * @param fallback What to show when there is no question at all.
 * @returns The words to show.
 * Called from: AnswerPanel.tsx, LiveAnswers.tsx (the overlay's state); tests
 */
export function cardQuestion(
  raw: string,
  clean: string | undefined,
  terms: readonly DisplayTerm[] = [],
  fallback = 'The latest from Them',
): string {
  if (clean?.trim()) return clean.trim();
  return raw.trim() ? sentenceCase(raw.trim(), terms) : fallback;
}
