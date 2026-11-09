/**
 * File: apps/web/src/core/transcript/question.ts
 * Purpose: Picks the question an Answer should answer: the "Them" lines since the user last
 *          spoke (echoes are already left out), trimmed to the latest question-like span; if
 *          "Them" has not spoken since, the last "Them" line. Returns the text and line ids.
 * Used by: src/core/answer/context.ts, src/features/live (the answer panel shows "from N lines")
 * Depends on: src/core/transcript/transcript.ts (Utterance)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 3 (Trigger), §7.5 (question
 *               words); day-04-answers.md Stage 4
 *
 * The on-device recogniser writes no punctuation (upper-case words only), so a question is
 * recognised by its words: a question word or phrase (what, how, could you, tell me…), or a
 * line that starts with a helping verb (can, is, do…). "?" counts too, for typed or future
 * punctuated text. Claude gets the whole conversation anyway; this only says which part to
 * answer, so a near miss still gives a good answer. Transcript text is never logged.
 */
import type { Utterance } from './transcript';

/**
 * A "You" line of at most this many words ("Right.", "Mm-hm, yes.") is a backchannel: the user
 * acknowledging, not taking the turn. It does not end the other person's question.
 */
export const BACKCHANNEL_MAX_WORDS = 2;

/** At most this many words of question are returned (the newest ones). */
export const MAX_QUESTION_WORDS = 80;

/** Words that make a line a question wherever they appear. */
const QUESTION_WORDS = /\b(what|how|why|when|where|who|which|whats|hows)\b/i;

/** Phrases that make a line a question wherever they appear. */
const QUESTION_PHRASES =
  /\b(can you|could you|would you|will you|do you|does it|did you|is there|are there|tell me|walk me through|explain|any questions)\b/i;

/** Helping verbs that make a line a question when it starts with one (after a filler). */
const LEADING_VERB =
  /^(?:(?:so|and|but|okay|ok|then|also|right|well|now)\s+)*(can|could|would|will|do|does|did|is|are|was|were|should|have|has)\b/i;

/**
 * Words that may come before a question at the start of a line ("So, um, what…"): they say nothing
 * and are not part of the question.
 */
const LEAD_IN =
  /^(?:(?:so|and|but|okay|ok|alright|right|well|now|then|also|um+|uh+|er|erm|hmm|great|thanks|yeah|yes|sure|good|cool)[\s,.!]+)+/i;

/** What a question starts with at the start of a line (the same words auto-answer uses). */
const OPENS_QUESTION =
  /^(what|whats|what's|why|how|when|where|who|whom|whose|which|can|could|would|will|should|shall|do|does|did|is|are|was|were|have|has|had|may|might|tell me|walk me through|explain|describe)\b/i;

/**
 * What marks a question in the middle of a line, which the speech model joins without punctuation
 * ("THAT IS GREAT SO HOW WOULD YOU…"). Each needs more than a bare question word, so "I know what
 * you mean" stays a statement. The named group is where the question starts.
 */
const ASKS_INSIDE: readonly RegExp[] = [
  // A question word a few words before its helping verb ("WHAT PRODUCTION GRADE APPS HAVE YOU…").
  /\b(?<start>(?:what|which|how|why|where|when|who)\s+(?:[\w'’-]+\s+){0,5}?(?:can|could|would|will|do|does|did|have|has|are|were|should)\s+(?:you|we|they|i)\b)/i,
  /\b(?<start>(?:what|how|why|when|where|who|which)\s+(?:is|are|was|were|do|does|did|would|will|can|could|should|have|has|had|kind|type|sort|many|much|long|often|happens|happened)\b)/i,
  /\b(?<start>(?:what|how|who|where|when|why)(?:['’]s|s)\s)/i,
  // v1.4: "how" and a measure before its helping verb ("…FIRST HOW BIG IS THE TEAM", "HOW OFTEN DO YOU").
  /\b(?<start>how\s+(?:big|large|small|long|many|much|often|far|old|soon|fast|quickly|well|good|hard|easy|important|likely|different|confident|comfortable|familiar)\s+(?:is|are|was|were|do|does|did|will|would|can|could|should|has|have)\b)/i,
  /\b(?:so|and|but|okay|ok|now|well|then|also)[\s,]+(?:(?:um+|uh+)[\s,]+)?(?<start>(?:what|how|why|when|where|who|which)\s)/i,
  /\b(?<start>(?:can|could|would|will|do|did|have|are|were)\s+you\b|(?:is|are)\s+there\b|tell me\b|walk me through\b)/i,
];

/** A question has at least this many words ("What?" or "Sorry?" alone is not one). */
const MIN_QUESTION_WORDS = 3;

/** Where a question sits in a line. */
export interface QuestionSpan {
  /** Index of its first character. */
  start: number;
  /** Index just after its last character. */
  end: number;
}

/**
 * Finds the question in a line (v1.0.4, ADR-0040). With punctuation: the last sentence with a "?".
 * Without (the live engine writes none): from the first place a question starts, to the line's end.
 *
 * @param text A line's text.
 * @returns Where the question is, or null when the line holds none of at least three words.
 * Called from: group.ts (the "?" mark), liveQuestion.ts; tests
 */
export function questionSpan(text: string): QuestionSpan | null {
  const words = (from: number, to: number) => wordCount(text.slice(from, to));
  const mark = text.lastIndexOf('?');
  if (mark !== -1) {
    // The sentence holding it starts after the sentence end before it.
    const before = text.slice(0, mark);
    const stop = Math.max(
      before.lastIndexOf('.'),
      before.lastIndexOf('!'),
      before.lastIndexOf('?'),
    );
    const raw = stop + 1;
    const start = raw + (text.slice(raw).length - text.slice(raw).trimStart().length);
    return words(start, mark + 1) >= MIN_QUESTION_WORDS ? { start, end: mark + 1 } : null;
  }
  const lead = LEAD_IN.exec(text)?.[0].length ?? 0;
  const end = text.trimEnd().length;
  if (OPENS_QUESTION.test(text.slice(lead))) {
    return words(lead, end) >= MIN_QUESTION_WORDS ? { start: lead, end } : null;
  }
  const starts = ASKS_INSIDE.flatMap((pattern) => {
    const found = pattern.exec(text);
    return found?.groups?.start === undefined
      ? []
      : [found.index + found[0].length - found.groups.start.length];
  });
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  return words(start, end) >= MIN_QUESTION_WORDS ? { start, end } : null;
}

/** The question picked from the transcript. */
export interface SelectedQuestion {
  /** The question text: the chosen lines joined with spaces. Never logged. */
  text: string;
  /** Ids of the lines it came from, oldest first (the panel says "from N lines"). */
  lineIds: string[];
}

/**
 * Whether a line reads like a question.
 *
 * @param text A line's text.
 * @returns True for question words or phrases, a leading helping verb, or "?".
 * Called from: selectQuestion()
 */
export function isQuestionLike(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.includes('?') ||
    QUESTION_WORDS.test(trimmed) ||
    QUESTION_PHRASES.test(trimmed) ||
    LEADING_VERB.test(trimmed)
  );
}

/**
 * Counts the words of a line.
 *
 * @param text A line's text.
 * @returns Number of words.
 * Called from: selectQuestion()
 */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Picks the question to answer.
 *
 * @param lines The visible lines (Transcript.lines(): finals and partials, no echoes), in
 *              transcript order. A "Them" line still being heard is included: the question
 *              is often still grey when the user presses Answer.
 * @returns The question, or null when "Them" has said nothing yet.
 * Called from: buildAnswerRequest() in core/answer/context.ts; the live page; tests
 */
export function selectQuestion(lines: readonly Utterance[]): SelectedQuestion | null {
  const spoken = lines.filter((line) => line.text.trim() !== '');
  // The user's last real turn (a backchannel does not count).
  let lastYou = -1;
  spoken.forEach((line, index) => {
    if (line.speaker === 'you' && wordCount(line.text) > BACKCHANNEL_MAX_WORDS) lastYou = index;
  });
  let span = spoken.slice(lastYou + 1).filter((line) => line.speaker === 'them');
  if (span.length === 0) {
    // "Them" has not spoken since: answer their last line.
    const lastThem = spoken.findLast((line) => line.speaker === 'them');
    if (!lastThem) return null;
    span = [lastThem];
  }
  // The latest question-like run: from the first of the question-like lines just before the
  // last one, through the lines after it (they may finish the question: "…cost / for 40 seats").
  const last = span.findLastIndex((line) => isQuestionLike(line.text));
  let first = last;
  while (first > 0 && isQuestionLike(span[first - 1]!.text)) first -= 1;
  const chosen = last === -1 ? span : span.slice(first);
  // Keep the newest words when the run is long.
  const words = chosen
    .map((line) => line.text.trim())
    .join(' ')
    .split(/\s+/);
  return {
    text: words.slice(-MAX_QUESTION_WORDS).join(' '),
    lineIds: chosen.map((line) => line.id),
  };
}
