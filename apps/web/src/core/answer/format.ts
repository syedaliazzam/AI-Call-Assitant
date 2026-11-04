/**
 * File: apps/web/src/core/answer/format.ts
 * Purpose: Splits an answer's text (complete or still streaming) into its parts: the answer line,
 *          the bullet points, any code blocks, a coding answer's complexity, an optional closing tip to
 *          say, what to say about the code, and an optional private note for the user only. Joins the
 *          speakable parts back as plain text for Copy. v1.1.0 (ADR-0043): an answer line longer than
 *          12 words is cut at a clause, and the rest becomes the first bullet.
 * Used by: src/features/answers/AnswerBody.tsx, src/features/live/AnswerPanel.tsx,
 *          src/features/live/LiveAnswers.tsx (the overlay), src/core/review/conversation.ts
 * Depends on: src/core/transcript/display.ts (sentenceCase, chipWords: for the card's question)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 6 (headline, then
 *               bullets); day-04-answers.md Stage 6; ADR-0030 (the coding shape)
 *
 * The prompt asks for a headline first and then at most 5 bullets (server/prompt.ts), but the
 * text arrives a few words at a time, and Claude sometimes adds Markdown marks (**bold**, "- ",
 * "• ", "1. "). Those marks are removed so the panel shows clean text.
 */

import { chipWords, sentenceCase, type DisplayTerm } from '../transcript/display';

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
  /** True when the bullets are a coding answer's "Key steps:" (v1.1.0). */
  keySteps: boolean;
  /** Code blocks (the coding shape, ADR-0030), never treated as bullets. */
  code: AnswerCode[];
  /** A coding answer's "Complexity: …", without its label, or '' (v1.1.0). */
  complexity: string;
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

/** The line that opens a coding answer's steps. */
const KEY_STEPS_LABEL = /^key steps\s*:?$/i;

/** The label of a coding answer's complexity line. */
const COMPLEXITY_LABEL = /^(?:time\s+)?complexity\s*:\s*/i;

/** The longest answer line, in words, not counting a label (v1.1.0, item 16). */
export const MAX_ANSWER_LINE_WORDS = 12;

/**
 * The longest whole answer the card treats as a line that can be cut, in words. More than this with no
 * bullets is a paragraph, which is meant to read as one.
 */
const ONE_LINE_MAX_WORDS = 30;

/** Where an answer line is best cut: after these marks, or before these joining words. */
const CLAUSE_BREAK = /[,;:—–]\s+|\s+(?=(?:and|but|so|because|which|while|with|using)\s)/gi;

/** Where it can be cut when there is no clause to cut at: before a word that starts a phrase. */
const PHRASE_BREAK = /\s+(?=(?:to|for|when|after|before|that|if|then|or|by|from)\s)/gi;

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
 * The words of an answer line, not counting a label or Markdown marks.
 *
 * @param line The line.
 * @returns How many words it has.
 * Called from: splitLongLine(); scripts/lib/answer-line.ts; tests
 */
export function answerLineWords(line: string): number {
  const clean = plain(line.replace(BULLET_MARK, '')).replace(HEADLINE_LABEL, '');
  return clean.split(/\s+/).filter(Boolean).length;
}

/**
 * The last place in a line a pattern allows a cut, within the word limit.
 *
 * @param line    The line.
 * @param pattern Where it may be cut.
 * @returns Where the first part ends and the rest starts, or null.
 * Called from: splitLongLine()
 */
function lastBreak(line: string, pattern: RegExp): { end: number; next: number } | null {
  let cut: { end: number; next: number } | null = null;
  for (const match of line.matchAll(pattern)) {
    const words = answerLineWords(line.slice(0, match.index));
    if (words > MAX_ANSWER_LINE_WORDS) break;
    // Fewer than three words is not a line anyone can say on its own.
    if (words >= 3) cut = { end: match.index, next: match.index + match[0].length };
  }
  return cut;
}

/**
 * Cuts an answer line longer than the limit at its last clause break within the limit, or failing that
 * before a word that starts a phrase (v1.1.0, item 16). The prompt asks for 12 words, and the model
 * often runs over; this is what makes the card keep to it, with no extra request. A line with no such
 * break stays whole: a cut anywhere else would read worse than one long line.
 *
 * @param line The answer line.
 * @returns The line to show and the rest ('' when it fits or cannot be cut).
 * Called from: splitAnswer(); tests
 */
export function splitLongLine(line: string): { line: string; rest: string } {
  if (answerLineWords(line) <= MAX_ANSWER_LINE_WORDS) return { line, rest: '' };
  const cut = lastBreak(line, CLAUSE_BREAK) ?? lastBreak(line, PHRASE_BREAK);
  if (!cut) return { line, rest: '' };
  const head = line.slice(0, cut.end).trim();
  const tail = line.slice(cut.next).trim();
  return {
    line: /[.!?]$/.test(head) ? head : `${head}.`,
    rest: tail.charAt(0).toUpperCase() + tail.slice(1),
  };
}

/**
 * Splits an answer into its parts. A line after the first that starts "Tip:", "Say:" or "Note:" is
 * that part; a fenced block is code (one still streaming runs to the end); every other line is a
 * bullet. While the text streams, a line becomes the tip or note as soon as its label has arrived.
 *
 * @param text     The answer text so far.
 * @param finished True when no more text will come: a short one-line answer can then be cut too. While
 *                 it streams it could still become a paragraph, and would jump back.
 * @returns The answer line (first non-empty line), bullets, code, complexity, what to say, tip and
 *          note.
 * Called from: AnswerBody.tsx; LiveAnswers.tsx; answerText(); conversation.ts; tests
 */
export function splitAnswer(text: string, finished = false): AnswerParts {
  const lines = text.split('\n');
  const bullets: string[] = [];
  const code: AnswerCode[] = [];
  let keySteps = false;
  let complexity = '';
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
    if (KEY_STEPS_LABEL.test(clean)) keySteps = true;
    else if (COMPLEXITY_LABEL.test(clean)) complexity = clean.replace(COMPLEXITY_LABEL, '');
    else if (TIP_LABEL.test(clean)) tip = clean.replace(TIP_LABEL, '');
    else if (SAY_LABEL.test(clean)) say = clean.replace(SAY_LABEL, '');
    else if (NOTE_LABEL.test(clean)) note = clean.replace(NOTE_LABEL, '');
    // A depth offer is the Tip when there is none; a second one adds nothing to say.
    else if (DEPTH_OFFER.test(clean)) tip ||= clean;
    else bullets.push(clean);
  }
  // With something after it, or as a finished one-line answer. A paragraph is complete as it stands,
  // and a line still arriving has nothing yet to sit above.
  const oneLine =
    finished && bullets.length === 0 && answerLineWords(headline) <= ONE_LINE_MAX_WORDS;
  if (bullets.length > 0 || code.length > 0 || oneLine) {
    const { line, rest } = splitLongLine(headline);
    headline = line;
    if (rest) bullets.unshift(rest);
  }
  return { headline, bullets, keySteps, code, complexity, say, tip, note };
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
  const { headline, bullets, code, complexity, say, tip } = splitAnswer(text, true);
  return [
    headline,
    ...bullets.map((bullet) => `- ${bullet}`),
    ...code.map((block) => block.text),
    ...(complexity ? [`Complexity: ${complexity}`] : []),
    ...(say ? [say] : []),
    ...(tip ? [tip] : []),
  ].join('\n');
}

/**
 * The question to show on an answer card (v1.0.2, ADR-0037): Claude's cleaned question once it has
 * arrived, otherwise the raw words in sentence case (the speech model writes capitals), without
 * hesitation sounds, and cut after the last question mark (v1.0.4: an answer saved before clean
 * questions existed often has the talk that followed the question), otherwise a fallback.
 *
 * @param raw      The question as picked from the transcript or typed ('' when none).
 * @param clean    Claude's cleaned question, if it has arrived.
 * @param terms    The session's spellings to restore in the raw words (displayTerms()).
 * @param fallback What to show when there is no question at all.
 * @returns The words to show.
 * Called from: AnswerPanel.tsx, CompactView.tsx, ConversationSection.tsx, core/review/conversation.ts;
 *              tests
 */
export function cardQuestion(
  raw: string,
  clean: string | undefined,
  terms: readonly DisplayTerm[] = [],
  fallback = 'The latest from Them',
): string {
  if (clean?.trim()) return clean.trim();
  if (!raw.trim()) return fallback;
  const cased = chipWords(sentenceCase(raw.trim(), terms)).join(' ');
  const end = cased.lastIndexOf('?');
  return end === -1 ? cased : cased.slice(0, end + 1);
}
