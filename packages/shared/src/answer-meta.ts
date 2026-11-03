/**
 * File: packages/shared/src/answer-meta.ts
 * Purpose: What Kite knows about an answer besides its words: the question type, who it is for
 *          (the call, or the user privately) and where its facts come from. Claude writes them in
 *          the same request, as one hidden first line ("[[coding|call|docs]]"), and the server
 *          removes that line before the first word reaches the browser.
 * Used by: apps/web/src/server/answer-meta.ts, src/server/prompt.ts, src/server/validate.ts,
 *          src/core/answer, src/core/storage/types.ts, src/features (labels), scripts/eval-answers.ts
 * Depends on: nothing (types, constants and pure helpers)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */

/**
 * What kind of question an answer is for; picks the answer's shape (server/prompt.ts).
 * - `behavioural`: "tell me about a time…".
 * - `concept`: a technical concept.
 * - `coding`: write or fix code.
 * - `design`: system design.
 * - `case`: a case or an estimate.
 * - `sales`: sales or client questions.
 * - `product`: product or demo questions.
 * - `smalltalk`: small talk or wrap-up.
 * - `unclear`: not clear what was asked.
 */
export type AnswerType =
  | 'behavioural'
  | 'concept'
  | 'coding'
  | 'design'
  | 'case'
  | 'sales'
  | 'product'
  | 'smalltalk'
  | 'unclear';

/** Every question type, in the order the answer card's menu lists them. */
export const ANSWER_TYPES: readonly AnswerType[] = [
  'behavioural',
  'concept',
  'coding',
  'design',
  'case',
  'sales',
  'product',
  'smalltalk',
  'unclear',
];

/** The words on the answer card for each question type. */
export const ANSWER_TYPE_LABELS: Readonly<Record<AnswerType, string>> = {
  behavioural: 'Behavioural',
  concept: 'Technical concept',
  coding: 'Coding',
  design: 'System design',
  case: 'Case or estimate',
  sales: 'Sales or client',
  product: 'Product or demo',
  smalltalk: 'Small talk',
  unclear: 'Unclear',
};

/**
 * Who an answer is for: `call` is a first-person answer the user can say; `kite` is a direct,
 * private answer for the user to read, on any topic.
 */
export type AnswerTarget = 'call' | 'kite';

/** The switch next to the chat box: let Claude decide, or fix who the answer is for. */
export type TargetChoice = 'auto' | AnswerTarget;

/** Where an answer's facts mainly come from. Shown only to the user, never copied or exported. */
export type AnswerSource = 'docs' | 'call' | 'general' | 'example';

/** The private words for each source (`docs` depends on the session: sourceLabel()). */
const SOURCE_LABELS: Readonly<Record<Exclude<AnswerSource, 'docs'>, string>> = {
  call: 'From the call',
  general: 'General knowledge',
  example: 'Example',
};

/**
 * The private source tag's words. Documents read "From your CV" in an interview, where the
 * documents are the CV, and "From your documents" otherwise, where saying CV would be wrong.
 *
 * @param source      The answer's source.
 * @param sessionType The session's type ('interview', 'regular', 'mock'), when there is one.
 * @returns The tag's words.
 * Called from: the answer cards; tests
 */
export function sourceLabel(source: AnswerSource, sessionType?: string): string {
  if (source !== 'docs') return SOURCE_LABELS[source];
  return sessionType === 'regular' || sessionType === undefined
    ? 'From your documents'
    : 'From your CV';
}

/** What the hidden first line says. */
export interface AnswerMeta {
  /** The question type. */
  type: AnswerType;
  /** Who the answer is for. */
  target: AnswerTarget;
  /** Where its facts mainly come from. */
  source: AnswerSource;
}

/** What to do when the session's documents have no real example to answer from. */
export type MissingInfoMode = 'approach' | 'story';

/** The languages an answer's code can be written in (Settings → Answers). */
export const CODING_LANGUAGES: readonly string[] = [
  'Python',
  'JavaScript',
  'TypeScript',
  'Java',
  'C++',
  'C#',
  'Go',
  'SQL',
];

/** The default coding language: a session on it sends nothing, so its prompt stays the same. */
export const DEFAULT_CODING_LANGUAGE = 'Python';

/** Longest meta line that can still be one: Claude's reply is passed through after this. */
export const MAX_META_LINE_CHARS = 60;

/** The hidden first line, with any white space Claude put around it. */
const META_LINE = /^\s*\[\[\s*([a-z]+)\s*\|\s*([a-z]+)\s*\|\s*([a-z]+)\s*\]\]/;

/**
 * Reads the hidden first line's three values. Each unknown value falls back on its own, so one
 * odd word costs one label and not the whole answer.
 *
 * @param type   The first value.
 * @param target The second value.
 * @param source The third value.
 * @returns The meta.
 * Called from: splitMetaLine()
 */
function metaFrom(type: string, target: string, source: string): AnswerMeta {
  return {
    type: (ANSWER_TYPES as readonly string[]).includes(type) ? (type as AnswerType) : 'unclear',
    target: target === 'kite' ? 'kite' : 'call',
    source: ['docs', 'call', 'general', 'example'].includes(source)
      ? (source as AnswerSource)
      : 'general',
  };
}

/** What splitMetaLine() finds. */
export type MetaSplit =
  | {
      /** Not enough text yet to tell: keep reading. */
      state: 'waiting';
    }
  | {
      /** The text has no meta line: all of it is the answer. */
      state: 'none';
    }
  | {
      /** The meta line was found. */
      state: 'found';
      /** What it says. */
      meta: AnswerMeta;
      /** The text after it, without the white space that follows the line. */
      rest: string;
    };

/**
 * Looks for the hidden first line at the start of a reply, which may still be arriving.
 *
 * @param text The reply so far.
 * @returns See MetaSplit.
 * Called from: apps/web/src/server/answer-meta.ts; scripts/eval-answers.ts; tests
 */
export function splitMetaLine(text: string): MetaSplit {
  const trimmed = text.trimStart();
  if (trimmed === '') return { state: 'waiting' };
  const match = META_LINE.exec(trimmed);
  if (match) {
    return {
      state: 'found',
      meta: metaFrom(match[1]!, match[2]!, match[3]!),
      rest: trimmed.slice(match[0].length).trimStart(),
    };
  }
  // Could this still become a meta line? "[", "[[", or an unfinished "[[coding|ca".
  const couldBe = trimmed.startsWith('[[') || trimmed === '[';
  return couldBe && trimmed.length < MAX_META_LINE_CHARS && !trimmed.includes('\n')
    ? { state: 'waiting' }
    : { state: 'none' };
}
