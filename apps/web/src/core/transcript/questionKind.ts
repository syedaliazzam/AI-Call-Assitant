/**
 * File: apps/web/src/core/transcript/questionKind.ts
 * Purpose: What kind of thing a line is (v1.1.0, ADR-0043), so Answer only answers real questions: a
 *          question; a greeting or small talk ("how are you", "can you hear me"); an instruction ("say
 *          yes when you're ready"); garbled words the speech model made from noise; or a plain statement.
 *          Rules only: no request is spent working this out, and Claude's hidden "garbled" type is the
 *          second net for what these words miss.
 * Used by: src/core/transcript/unclear.ts, group.ts, liveQuestion.ts, src/core/answer/autoAnswer.ts,
 *          src/features/live/useLiveAnswers.ts
 * Depends on: src/core/transcript/question.ts (questionSpan, selectQuestion)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 3; ADR-0043
 *
 * The worse mistake is refusing a real question, so everything leans towards "question": "tell me about
 * yourself" and "walk me through it" are questions, and a line with a greeting and a question in it is a
 * question. Transcript text is never logged.
 */
import {
  MAX_QUESTION_WORDS,
  questionSpan,
  selectQuestion,
  type SelectedQuestion,
} from './question';
import type { Utterance } from './transcript';

/** What a line is. */
export type LineKind = 'question' | 'greeting' | 'instruction' | 'garbled' | 'statement';

/**
 * Greetings, thanks, checks that the line works, and goodbyes. Removed from a line before it is judged:
 * what is left says whether anything else was said.
 */
const GREETING_PHRASES =
  /\b(?:hi|hello|hey|good (?:morning|afternoon|evening|day)|nice to (?:meet|see) you|pleasure to meet you|thanks?(?: you)?(?: so much| very much| a lot)?(?: for (?:joining|coming|your time|having me|taking the time))?|welcome|how are you(?: doing)?(?: today)?|how(?:'s| is)(?: it going| everything| your day(?: going)?)|how have you been|what(?:'s| is) up|can you (?:hear|see) me(?: okay| ok| alright| clearly| now)?|can you hear me|are you (?:there|with me)|do you hear me|bye|goodbye|see you|take care|have a (?:good|great|nice) (?:one|day|evening|weekend))\b/gi;

/** Telling the user to do something on the call, which is not a question to answer. */
const INSTRUCTION_PHRASES =
  /\b(?:say (?:yes|ok|okay|ready|something)(?: when (?:you(?:'re| are) )?ready)?|let me know when you(?:'re| are) ready|(?:just )?let me know when|tell me when you(?:'re| are) ready|are you ready(?: to (?:begin|start|get started))?|shall we (?:begin|start|get started)|(?:please )?share your screen|can you share your screen|(?:please )?(?:un)?mute|you(?:'re| are) on mute|you are muted|turn on your (?:camera|video)|give me a (?:second|sec|minute|moment)|(?:please )?hold on|one (?:second|sec|moment)|just a (?:second|sec|minute|moment)|(?:please )?wait(?: a (?:second|moment))?|go ahead|let(?:'s| us) (?:begin|start|get started|move on)|i(?:'ll| will) (?:start|begin)|is this a good time)\b/gi;

/** Words that fill out almost any English sentence. Speech has them; noise made into words does not. */
const COMMON_WORDS = new Set(
  (
    'the a an and or but so if then of to in on at for from with by about as into over after before ' +
    'i you we they he she it this that these those there here my your our their his her its ' +
    'is are was were be been being am do does did have has had will would can could should may might must ' +
    'what how why when where who which not no yes all some any more most very just also like get got go ' +
    'going make made need want know think see say said tell work use one two time way out up down'
  ).split(' '),
);

/** A word with no vowel at all, which English barely has (a speech model's noise often does). */
const NO_VOWEL = /^[bcdfghjklmnpqrstvwxz]{3,}$/i;

/**
 * A line's words, lower case and without punctuation.
 *
 * @param text The line.
 * @returns The words.
 * Called from: looksGarbled(), lineKind()
 */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/**
 * Whether a line looks like noise the speech model turned into words, rather than speech. Careful on
 * purpose: only clear cases count, because a real line marked as noise would be collapsed or held back.
 *
 * @param text The line.
 * @returns True for: one word repeated (half or more of 4+ words); 5+ words with not one common word; or
 *          5+ words where most have no vowel.
 * Called from: lineKind(), unclear.ts; tests
 */
export function looksGarbled(text: string): boolean {
  const words = wordsOf(text);
  if (words.length < 4) return false;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  if (Math.max(...counts.values()) >= Math.ceil(words.length / 2)) return true;
  if (words.length < 5) return false;
  if (!words.some((word) => COMMON_WORDS.has(word))) return true;
  return words.filter((word) => NO_VOWEL.test(word)).length > words.length / 2;
}

/**
 * What a line is.
 *
 * @param text The line.
 * @returns Its kind.
 * Called from: question.ts (pickQuestion), autoAnswer.ts; tests
 */
export function lineKind(text: string): LineKind {
  const trimmed = text.trim();
  if (looksGarbled(trimmed)) return 'garbled';
  // A greeting or an instruction with a real question in it is the question.
  const rest = trimmed.replace(GREETING_PHRASES, ' ').replace(INSTRUCTION_PHRASES, ' ');
  const hadInstruction = trimmed.search(INSTRUCTION_PHRASES) !== -1;
  const hadGreeting = trimmed.search(GREETING_PHRASES) !== -1;
  if (hadGreeting || hadInstruction) {
    // A "?" alone says nothing: "How are you doing today?" has only its mark left, or a name with it.
    if (questionSpan(rest) !== null || (rest.includes('?') && wordsOf(rest).length >= 2)) {
      return 'question';
    }
    // A few words left over ("so", "okay then", a name) do not make it anything else.
    if (wordsOf(rest).length <= 3) return hadInstruction ? 'instruction' : 'greeting';
  }
  if (trimmed.includes('?') || questionSpan(trimmed) !== null) return 'question';
  return 'statement';
}

/**
 * Whether Answer should skip a line and look further back: greetings and instructions. A plain statement
 * is not skipped ("I'd like to hear about your Kubernetes work" is a request with no question word).
 *
 * @param text The line.
 * @returns True for a greeting or an instruction.
 * Called from: pickQuestion(); tests
 */
export function isSkippedLine(text: string): boolean {
  const kind = lineKind(text);
  return kind === 'greeting' || kind === 'instruction';
}

/** The longest pause inside one question's lines when looking back, in ms (group.ts's turn gap). */
const QUESTION_GAP_MS = 4_000;

/** What Answer should do. */
export type PickedQuestion =
  | {
      /** A question to answer. */
      kind: 'question';
      /** The question and the lines it came from. */
      selected: SelectedQuestion;
      /** True when it is not the latest words: those were a greeting or an instruction. */
      lookedBack: boolean;
    }
  | {
      /** The latest words look like noise: say so, unless this is the second press. */
      kind: 'garbled';
      /** The words, to tell a second press on them from new words. Never logged. */
      selected: SelectedQuestion;
    }
  | {
      /** Only greetings and instructions so far, or nothing from the other person. */
      kind: 'none';
    };

/**
 * Lines as one question, keeping the newest words when they run long (as selectQuestion() does).
 *
 * @param lines The lines, in order.
 * @returns The question.
 * Called from: pickQuestion()
 */
function asQuestion(lines: readonly Utterance[]): SelectedQuestion {
  const words = lines
    .map((line) => line.text.trim())
    .join(' ')
    .split(/\s+/);
  return {
    text: words.slice(-MAX_QUESTION_WORDS).join(' '),
    lineIds: lines.map((line) => line.id),
  };
}

/**
 * Picks what Answer answers (v1.1.0, item 14). The latest words are used unless they are a greeting or
 * an instruction; then the last real question of this call, with any lines that finished it. Garbled
 * latest words are reported, and nothing at all to answer is reported too: neither spends a request.
 *
 * @param lines The visible lines of this call, in order.
 * @returns See PickedQuestion.
 * Called from: useLiveAnswers.ts (ask); tests
 */
export function pickQuestion(lines: readonly Utterance[]): PickedQuestion {
  const selected = selectQuestion(lines);
  if (!selected) return { kind: 'none' };
  if (lineKind(selected.text) === 'garbled') return { kind: 'garbled', selected };
  if (!isSkippedLine(selected.text)) {
    // selectQuestion() keeps the lines after a question, which may finish it. A greeting or an
    // instruction among them does not: "…cost for forty seats / say yes when ready" asks about the cost.
    const chosen = selected.lineIds.flatMap((id) => lines.find((line) => line.id === id) ?? []);
    let end = chosen.length;
    while (end > 1 && isSkippedLine(chosen[end - 1]!.text)) end -= 1;
    return end === chosen.length
      ? { kind: 'question', selected, lookedBack: false }
      : { kind: 'question', selected: asQuestion(chosen.slice(0, end)), lookedBack: true };
  }
  const spoken = lines.filter((line) => line.speaker === 'them' && line.text.trim() !== '');
  const found = spoken.findLastIndex(
    (line) => !selected.lineIds.includes(line.id) && lineKind(line.text) === 'question',
  );
  if (found === -1) return { kind: 'none' };
  // A pause can cut a question in two ("…the plan cost / for forty seats"): the plain words right
  // after it finish it.
  const used = [spoken[found]!];
  for (const next of spoken.slice(found + 1)) {
    if (next.tStart - used.at(-1)!.tEnd > QUESTION_GAP_MS || lineKind(next.text) !== 'statement') {
      break;
    }
    used.push(next);
  }
  return { kind: 'question', lookedBack: true, selected: asQuestion(used) };
}
