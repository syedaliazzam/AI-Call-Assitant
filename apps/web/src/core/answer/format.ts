/**
 * File: apps/web/src/core/answer/format.ts
 * Purpose: Splits an answer's text (complete or still streaming) into its parts: the answer line,
 *          the bullet points, any code blocks, a coding answer's complexity, an optional closing tip to
 *          say, what to say about the code, and an optional private note for the user only. Joins the
 *          speakable parts back as plain text for Copy. ADR-0135 (was v1.1.0, ADR-0043): an answer line
 *          longer than 12 words shows its first sentence and the rest becomes the first bullet; a sentence
 *          is never split, and a line that only goes on with the sentence above is joined to it.
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
  /**
   * ADR-0133: the questions a press left for the next press ("Still open: …", without its label), or ''.
   * Not said, not copied; the next press with nothing new answers them.
   */
  stillOpen: string;
  /**
   * ADR-0133: true when the answer gives several questions one labelled line each ("Timeline: …"): the
   * answer line and the bullets then show their labels in bold (labelOf()), and no line is cut.
   */
  labelled: boolean;
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

/** ADR-0133: the label of the line naming the questions left for the next press. */
const STILL_OPEN_LABEL = /^still open\s*:\s*/i;

/**
 * ADR-0133: a short label at the start of a line ("Timeline: …", "Data hosting: …"): one to four words,
 * starting with a capital, then a colon and the rest of the line.
 */
const SHORT_LABEL = /^(\p{Lu}[\p{L}\p{N}&/'’-]*(?:\s+[\p{L}\p{N}&/'’-]+){0,3}):\s+(\S.*)$/u;

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

/**
 * ADR-0135: where an answer line may be cut: only between two whole sentences (a full stop, question or
 * exclamation mark, any closing quote or bracket, a space, then the next sentence's first letter or digit).
 * It used to cut inside a sentence, at a comma or before a joining word ("with", "so", "to"…), which turned
 * "I'll confirm the details with you before we move on." into a headline and a bullet "With you before we
 * move on." (27 Nov 2026 Mac call). A sentence is never split now.
 */
const SENTENCE_BREAK = /[.!?]["'”’)\]]*\s+(?=["'“‘(]?[\p{Lu}\d])/gu;

/**
 * Words that end in a full stop without ending a sentence ("e.g. Kafka", "Dr. Patel", "U.S. teams"):
 * a full stop right after one of these is never a sentence end (ADR-0135). Compared in lower case.
 */
const NOT_SENTENCE_END = new Set([
  'e.g',
  'i.e',
  'etc',
  'vs',
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'no',
  'approx',
  'inc',
  'ltd',
  'co',
  'u.s',
  'u.k',
  'a.m',
  'p.m',
]);

/**
 * Bullet marks at the start of a line: "-", "*", "•", an en or em dash (ADR-0135: some models list with
 * them), or "1." / "1)".
 */
const BULLET_MARK = /^\s*(?:[-*•–—]|\d+[.)])\s+/;

/**
 * ADR-0135: a line that goes on with the sentence above it: it starts with a lower-case letter (after any
 * bullet mark). Joined to the line before when that one does not end a sentence, so a sentence the model
 * (or a stream) broke over two lines is never shown as a headline and a bullet.
 */
const CONTINUES_SENTENCE = /^\p{Ll}/u;

/** ADR-0135: a line that ends a sentence or a label ("Key steps:"), so the next line is a new one. */
const ENDS_LINE = /[.!?:;]["'”’)\]]*$/;

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
 * ADR-0135: where the line's first sentence ends, when it is followed by another one: the first sentence
 * break after at least three words (fewer is not a line anyone can say on its own) that is not an
 * abbreviation's full stop.
 *
 * @param line The line.
 * @returns Where the first sentence ends and the next starts, or null when the line is one sentence.
 * Called from: splitLongLine()
 */
function firstSentenceBreak(line: string): { end: number; next: number } | null {
  for (const match of line.matchAll(SENTENCE_BREAK)) {
    const before = line.slice(0, match.index);
    if (answerLineWords(before) < 3) continue;
    // "e.g. Kafka" or "Dr. Patel": the word before the full stop is an abbreviation, not a sentence end.
    const lastWord = (before.split(/\s+/).at(-1) ?? '').toLowerCase();
    if (match[0].startsWith('.') && NOT_SENTENCE_END.has(lastWord)) continue;
    // The mark itself (and any closing quote) stays with the first sentence.
    const marks = /^[.!?]["'”’)\]]*/.exec(match[0])?.[0].length ?? 1;
    return { end: match.index + marks, next: match.index + match[0].length };
  }
  return null;
}

/**
 * Keeps the card's answer line short without ever splitting a sentence (ADR-0135; v1.1.0 item 16 cut at a
 * clause instead). An answer line over the limit that holds more than one sentence shows its first
 * sentence; the other sentences become the first bullet. A line that is one sentence stays whole however
 * long it is: half a sentence on each line reads worse than one long line, and a cut in the middle once
 * made "…confirm the details with you before we move on." read as two lines.
 *
 * @param line The answer line.
 * @returns The line to show and the rest ('' when it fits or is one sentence).
 * Called from: splitAnswer(); tests
 */
export function splitLongLine(line: string): { line: string; rest: string } {
  if (answerLineWords(line) <= MAX_ANSWER_LINE_WORDS) return { line, rest: '' };
  const cut = firstSentenceBreak(line);
  if (!cut) return { line, rest: '' };
  return { line: line.slice(0, cut.end).trim(), rest: line.slice(cut.next).trim() };
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
  let stillOpen = '';
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
    // ADR-0135: a line that only goes on with the sentence above (a lower-case start, after a line that did
    // not end a sentence) is joined to it, never shown as a bullet of its own. Code, labelled lines and a
    // finished sentence are never joined to.
    const continued = plain(line.replace(BULLET_MARK, ''));
    if (CONTINUES_SENTENCE.test(continued) && code.length === 0) {
      if (bullets.length > 0 && !ENDS_LINE.test(bullets.at(-1)!)) {
        bullets[bullets.length - 1] = `${bullets.at(-1)!} ${continued}`;
        continue;
      }
      if (bullets.length === 0 && headline !== '' && !ENDS_LINE.test(headline)) {
        headline = `${headline} ${continued}`;
        continue;
      }
    }
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
    else if (STILL_OPEN_LABEL.test(clean)) stillOpen = clean.replace(STILL_OPEN_LABEL, '');
    // A depth offer is the Tip when there is none; a second one adds nothing to say.
    else if (DEPTH_OFFER.test(clean)) tip ||= clean;
    else bullets.push(clean);
  }
  // With something after it, or as a finished one-line answer. A paragraph is complete as it stands,
  // and a line still arriving has nothing yet to sit above.
  const oneLine =
    finished && bullets.length === 0 && answerLineWords(headline) <= ONE_LINE_MAX_WORDS;
  // ADR-0133: several questions answered one labelled line each: shown as written, never cut.
  const labelled = labelOf(headline) !== null && bullets.some((bullet) => labelOf(bullet) !== null);
  if (!labelled && (bullets.length > 0 || code.length > 0 || oneLine)) {
    const { line, rest } = splitLongLine(headline);
    headline = line;
    if (rest) bullets.unshift(rest);
  }
  return { headline, bullets, keySteps, code, complexity, say, tip, note, stillOpen, labelled };
}

/**
 * ADR-0133: a line's short label and the words after it ("Timeline: we start in May." → "Timeline" and
 * "we start in May."), or null when the line has none.
 *
 * @param line A line of the answer.
 * @returns The label and the rest, or null.
 * Called from: splitAnswer(); AnswerBody.tsx (bold labels); tests
 */
export function labelOf(line: string): { label: string; text: string } | null {
  const match = SHORT_LABEL.exec(line.trim());
  return match ? { label: match[1]!, text: match[2]! } : null;
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
  return shortQuestion(end === -1 ? cased : cased.slice(0, end + 1));
}

/**
 * ADR-0133: the most words a card shows of a question it has no clean version of. A press now sends
 * everything said since the last answer (up to MAX_NEWEST_WORDS of the other side), and the 27 Nov 2026
 * card showed about 45 seconds of talk as its "Question" when the hidden question line did not arrive.
 */
export const MAX_SHOWN_QUESTION_WORDS = 20;

/**
 * ADR-0133: a raw question kept short for the card: the newest whole sentences that fit in
 * MAX_SHOWN_QUESTION_WORDS words, or, when even the newest sentence is longer, its last words after "…".
 *
 * @param text The raw words (already cut after the last question mark).
 * @returns The words to show.
 * Called from: cardQuestion()
 */
function shortQuestion(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_SHOWN_QUESTION_WORDS) return text;
  // Sentences, each with its own end mark (the last may have none).
  const sentences = text.match(/[^.?!]+[.?!]*/g)?.map((sentence) => sentence.trim()) ?? [text];
  const kept: string[] = [];
  let count = 0;
  for (const sentence of [...sentences].reverse()) {
    const length = sentence.split(/\s+/).filter(Boolean).length;
    if (count + length > MAX_SHOWN_QUESTION_WORDS) break;
    kept.unshift(sentence);
    count += length;
  }
  if (kept.length > 0) return kept.join(' ');
  return `…${words.slice(-MAX_SHOWN_QUESTION_WORDS).join(' ')}`;
}
