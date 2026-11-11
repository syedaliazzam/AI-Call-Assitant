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

/** What a line is. v1.4: 'meta' is talk about the call itself (repeat that, can you hear me). */
export type LineKind = 'question' | 'greeting' | 'instruction' | 'meta' | 'garbled' | 'statement';

/**
 * v1.4 (ADR-0062): talk about the call itself, never a question to answer: asking to repeat, checking the
 * sound or the connection, and sharing screens. Unlike a greeting, such a phrase is the whole point of
 * the line, so it is not looked for again once removed ("Can you hear me okay? I think my connection
 * dropped" is about the call, not a question about hearing).
 * 1.5.2 (ADR-0070): asking to repeat a part ("can you repeat that last part?", "say the last bit again",
 * "go over it again", "I missed that"), which the real call of 11 Nov 2026 answered with a card twice.
 */
const META_PHRASES =
  /\b(?:(?:can|could|would) you (?:please )?(?:repeat|say) (?:that|it|this|the question|your question|the last part)(?: (?:the )?(?:last|first|second|third|final|other) (?:part|bit|point|sentence|thing|one))?(?: again| please| one more time| for me)*|(?:can|could|would) you (?:please )?(?:repeat|say) (?:the |that |your )?(?:last|first|second|third|final|other) (?:part|bit|point|sentence|thing|one)(?: again| please| one more time| for me)*|(?:can|could|would) you (?:please )?(?:go over|run through|run me through) (?:that|it|this)(?: (?:part|bit|point))? (?:again|one more time)|(?:the|that) (?:last|first|second|final) (?:part|bit) again|(?:i|we) (?:missed|lost) (?:that|it|the last part|the last bit|what you said)|say again|(?:can|could) you (?:please )?repeat|say (?:that|it) again|come again|repeat (?:that|the question)|one more time|what was (?:the|your) question|i (?:did ?n['o]?t|didn't|couldn't|could not) (?:quite )?(?:catch|get|hear) (?:that|it|the question|you|what you said|the last part)|(?:can|could|do) you (?:guys |all |both )?(?:hear|see) me(?: (?:okay|ok|alright|clearly|now|properly|well|fine))*|(?:is|are) (?:my|the) (?:audio|voice|mic|microphone|sound|video|camera|connection|internet|screen)(?: (?:okay|ok|fine|working|clear|good|visible|coming through|better|now))*|am i audible|is (?:this|that) better|you(?:'re| are) (?:breaking up|cutting out|frozen|on mute|muted|lagging)|you (?:broke|froze|cut out)(?: up)?|(?:i|we) (?:lost|can't hear|cannot hear|couldn't hear|can not hear) you|(?:my|the|your) (?:connection|internet|audio|network|video) (?:dropped|is bad|is poor|froze|cut out|went|is lagging|is slow|is unstable)|(?:can|could) you see my screen|(?:let me|i'll|i will|i'm going to) (?:share|stop sharing) my screen|stop (?:sharing|presenting)(?: (?:your|the|my) screen)?|is my screen visible|sorry,? (?:what|pardon)|pardon(?: me)?)\b/gi;

/**
 * 1.5.2 (ADR-0070): words that name nothing when they are what is left of a request to repeat ("sorry,
 * that last part again please"), so they never make it a question.
 */
const META_LEFTOVERS = new Set(
  (
    'sorry so um uh okay ok please that it this the a last part bit point one more time again for me ' +
    'first second third final other quick just quickly real really'
  ).split(' '),
);

/**
 * v1.4: a request for an answer worded as a statement ("I'd like to hear about your Kubernetes work").
 * Treated as a question.
 */
const REQUEST_PHRASES =
  /\b(?:i(?:'d| would) (?:like|love) (?:to (?:hear|know|understand|learn)|you to (?:explain|describe|tell|walk|talk|share))|i want to (?:hear|know|understand)|(?:talk|walk) (?:me|us) (?:through|about)|tell (?:me|us) (?:about|how|why|what|more)|share (?:with (?:me|us) )?(?:how|why|what|your|an example)|give (?:me|us) (?:an|a|some) (?:example|overview|summary)|describe (?:how|why|what|your|a time|the))\b/i;

/**
 * Greetings, thanks, checks that the line works, and goodbyes. Removed from a line before it is judged:
 * what is left says whether anything else was said.
 */
const GREETING_PHRASES =
  /\b(?:hi|hello|hey|good (?:morning|afternoon|evening|day)|nice to (?:meet|see) you|pleasure to meet you|thanks?(?: you)?(?: so much| very much| a lot)?(?: for (?:joining|coming|your time|having me|taking the time))?|welcome|how are you(?: doing)?(?: today)?|how(?:'s| is)(?: it going| everything| your day(?: going)?)|how (?:are|is|'s) (?:everyone|everybody|you all|you guys)(?: doing)?(?: today)?|good to (?:meet|see) you|talk (?:to you )?(?:soon|later)|bye-bye|see you (?:soon|later|next week|then)|how have you been|what(?:'s| is) up|can you (?:hear|see) me(?: okay| ok| alright| clearly| now)?|can you hear me|are you (?:there|with me)|do you hear me|bye|goodbye|see you|take care|have a (?:good|great|nice) (?:one|day|evening|weekend))\b/gi;

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
/**
 * 1.5.1 (ADR-0069): words that carry nothing when they are all that is left of a greeting: fillers,
 * agreement sounds and forms of address. A call on 11 Nov 2026 got a card for "Alright, uh How are you
 * doing?" because two of them and the "?" were left.
 */
const LEFTOVER_FILLERS = new Set([
  'uh',
  'um',
  'er',
  'erm',
  'ah',
  'oh',
  'so',
  'well',
  'okay',
  'ok',
  'alright',
  'right',
  'yeah',
  'yes',
  'hey',
  'hi',
  'hello',
  'and',
  'then',
  'now',
  'great',
  'good',
  'cool',
  'man',
  'guys',
  'everyone',
  'there',
  'sir',
  'madam',
  'buddy',
  'mate',
  'bro',
  'dude',
  'friend',
]);

/**
 * 1.5.1 (ADR-0069): what is left of a greeting once fillers, commas and the gaps of the removed phrase
 * are gone, so a lone "?", stray commas and fillers do not make the three words a question needs
 * (question.ts questionSpan counts every space-separated piece, the "?" left alone included).
 *
 * @param rest The text left once greetings and instructions are removed.
 * @returns The words that carry something, with a question mark attached to the word before it.
 */
function contentOnly(rest: string): string {
  return rest
    .replace(/[\p{L}\p{N}']+/gu, (word) => (LEFTOVER_FILLERS.has(word.toLowerCase()) ? '' : word))
    .replace(/[,;:]+/g, ' ')
    .replace(/\s+([?.!])/g, '$1')
    .trim();
}

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
  // v1.4: talk about the call is judged on what is left once it, a greeting and an instruction are
  // removed; only a real question in that rest makes it a question. The "?" of the removed phrase
  // does not count (questionSpan needs three words in the sentence holding a mark).
  if (trimmed.search(META_PHRASES) !== -1) {
    const rest = trimmed
      .replace(META_PHRASES, ' ')
      .replace(GREETING_PHRASES, ' ')
      .replace(INSTRUCTION_PHRASES, ' ');
    // 1.5.2 (ADR-0070): the "?" left behind is the removed phrase's ("Sorry, can you repeat that last
    // part?" leaves "Sorry, last part?"); question words left over make it a question, and so does a
    // repeat of something named ("could you repeat the price for forty seats?": three words that say what).
    const named = wordsOf(contentOnly(rest)).filter((word) => !META_LEFTOVERS.has(word));
    return questionSpan(contentOnly(rest.replace(/\?/g, ' '))) !== null ||
      REQUEST_PHRASES.test(rest) ||
      named.length >= 3
      ? 'question'
      : 'meta';
  }
  // A greeting or an instruction with a real question in it is the question.
  const rest = trimmed.replace(GREETING_PHRASES, ' ').replace(INSTRUCTION_PHRASES, ' ');
  const hadInstruction = trimmed.search(INSTRUCTION_PHRASES) !== -1;
  const hadGreeting = trimmed.search(GREETING_PHRASES) !== -1;
  if (hadGreeting || hadInstruction) {
    // A "?" alone says nothing: "How are you doing today?" has only its mark left, or a name with it.
    // 1.5.1 (ADR-0069): fillers and forms of address left over ("Alright, uh How are you doing?",
    // "Man, can you hear me, man?") do not make the leftover "?" a question.
    const content = wordsOf(rest).filter((word) => !LEFTOVER_FILLERS.has(word));
    if (questionSpan(contentOnly(rest)) !== null || (rest.includes('?') && content.length >= 2)) {
      return 'question';
    }
    // A few words left over ("so", "okay then", a name) do not make it anything else.
    if (wordsOf(rest).length <= 3) return hadInstruction ? 'instruction' : 'greeting';
  }
  if (trimmed.includes('?') || questionSpan(trimmed) !== null) return 'question';
  // v1.4: "I'd like to hear about your Kubernetes work" asks for an answer.
  if (REQUEST_PHRASES.test(trimmed)) return 'question';
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
  return kind === 'greeting' || kind === 'instruction' || kind === 'meta';
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
 * v1.4 (ADR-0062): talk about the call is skipped like a greeting; a remark looks back too, and is
 * answered as it is only when there is no question to go back to; another language is left out.
 *
 * @param allLines The visible lines of this call, in order.
 * @param options  Whether a lone remark may be answered (default yes).
 * @returns See PickedQuestion.
 * Called from: useLiveAnswers.ts (ask); tests
 */
export function pickQuestion(
  allLines: readonly Utterance[],
  options: PickOptions = {},
): PickedQuestion {
  // v1.4: speech in another language is never a question (it reads "[non-English speech]").
  const lines = allLines.filter((line) => !line.nonEnglish);
  const selected = selectQuestion(lines);
  if (!selected) return { kind: 'none' };
  const kind = lineKind(selected.text);
  if (kind === 'garbled') return { kind: 'garbled', selected };
  // v1.4 (ADR-0062): a remark with no question in it ("stop smirking", "that's great") looks back to
  // the last real question, like a greeting does. Only when there is none is it answered as it is,
  // because refusing a real request the rules cannot read is the worse mistake.
  if (kind === 'statement') {
    const earlier = lookBack(lines, selected, true);
    if (earlier) return earlier;
    return options.allowStatement === false
      ? { kind: 'none' }
      : { kind: 'question', selected, lookedBack: false };
  }
  if (!isSkippedLine(selected.text)) {
    // selectQuestion() keeps the lines after a question, which may finish it. A greeting or an
    // instruction among them does not: "…cost for forty seats / say yes when ready" asks about the cost.
    // Nor does noise among them.
    const chosen = selected.lineIds
      .flatMap((id) => lines.find((line) => line.id === id) ?? [])
      .filter((line) => !line.final || !looksGarbled(line.text));
    let end = chosen.length;
    while (end > 1 && isSkippedLine(chosen[end - 1]!.text)) end -= 1;
    return end === selected.lineIds.length
      ? { kind: 'question', selected, lookedBack: false }
      : { kind: 'question', selected: asQuestion(chosen.slice(0, end)), lookedBack: true };
  }
  return lookBack(lines, selected) ?? { kind: 'none' };
}

/** Options for pickQuestion(). */
export interface PickOptions {
  /**
   * v1.4: false to report 'none' instead of answering a lone remark (Answer first tries only the lines
   * not answered yet, then all of them).
   */
  allowStatement?: boolean;
}

/**
 * The last real question of the call before what was selected, with the plain words right after it
 * that finish it.
 *
 * @param lines    The visible lines of this call, in order.
 * @param selected What selectQuestion() picked (a greeting, an instruction, talk about the call or a
 *                 remark).
 * @param keepSelectedOut True (a remark) to never add the selected lines to the question found.
 * @returns The question, marked as looked back, or null when there is none.
 * Called from: pickQuestion()
 */
function lookBack(
  lines: readonly Utterance[],
  selected: SelectedQuestion,
  keepSelectedOut = false,
): Extract<PickedQuestion, { kind: 'question' }> | null {
  const spoken = lines.filter((line) => line.speaker === 'them' && line.text.trim() !== '');
  const found = spoken.findLastIndex(
    (line) => !selected.lineIds.includes(line.id) && lineKind(line.text) === 'question',
  );
  if (found === -1) return null;
  // A pause can cut a question in two ("…the plan cost / for forty seats"): the plain words right
  // after it finish it.
  const used = [spoken[found]!];
  for (const next of spoken.slice(found + 1)) {
    if (
      next.tStart - used.at(-1)!.tEnd > QUESTION_GAP_MS ||
      lineKind(next.text) !== 'statement' ||
      (keepSelectedOut && selected.lineIds.includes(next.id))
    ) {
      break;
    }
    used.push(next);
  }
  return { kind: 'question', lookedBack: true, selected: asQuestion(used) };
}
