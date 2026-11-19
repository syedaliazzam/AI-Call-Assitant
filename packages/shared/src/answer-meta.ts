/**
 * File: packages/shared/src/answer-meta.ts
 * Purpose: What Kite knows about an answer besides its words: the question type, who it is for
 *          (the call, or the user privately) and where its facts come from. Claude writes them in
 *          the same request, as one hidden first line ("[[coding|call|docs]]"), and the server
 *          removes that line before the first word reaches the browser. Since v1.0.2 (ADR-0037)
 *          Claude also ends the answer with a hidden last line holding the cleaned question
 *          ("[[question|…]]"), which the server takes out of the text the same way.
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
 * - v1.1.0 (ADR-0043), what a screenshot shows: `codefix` (code with an error), `slide`, `table`
 *   (a table or chart), `document`, `webpage`, `unreadable` (nothing can be read, or nothing relevant).
 * - v1.1.0: `garbled`: the words make no sense even in context, so there is nothing to answer.
 * - v1.4 (ADR-0065): `none`: clear words that ask the user nothing (talk about the call itself, such
 *   as "can you repeat that?" or "can you hear me?", or a remark that needs no reply), so there is
 *   nothing to answer either.
 * - v1.2.0: `other`: Claude named a type Kite does not know. The prompt never offers it.
 * - ADR-0107: `task`, what a screenshot shows (not `question`, the hidden last line's tag): a question or task on the screen (a chat message that
 *   asks something, a quiz or multiple-choice question, a form question).
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
  | 'unclear'
  | 'codefix'
  | 'slide'
  | 'table'
  | 'document'
  | 'webpage'
  | 'unreadable'
  | 'task'
  | 'garbled'
  | 'none'
  | 'other';

/** The question types the answer card's menu offers, in its order. */
export const PICKABLE_ANSWER_TYPES: readonly AnswerType[] = [
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

/** Every question type an answer can carry: what Claude can name, and `other` for anything else. */
export const ANSWER_TYPES: readonly AnswerType[] = [
  ...PICKABLE_ANSWER_TYPES,
  'codefix',
  'slide',
  'table',
  'document',
  'webpage',
  'unreadable',
  'task',
  'garbled',
  'none',
  'other',
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
  codefix: 'Code fix',
  slide: 'Slide',
  table: 'Table or chart',
  document: 'Document',
  webpage: 'Web page',
  unreadable: 'Unreadable',
  task: 'Question on screen',
  garbled: 'Not understood',
  none: 'Nothing to answer',
  other: 'Other',
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

/**
 * The private words for each source (`docs` and `example` depend on the session: sourceLabel()).
 */
const SOURCE_LABELS: Readonly<Record<Exclude<AnswerSource, 'docs' | 'example'>, string>> = {
  call: 'From the call',
  general: 'General knowledge',
};

/**
 * The private source tag's words. Documents read "From your CV" in an interview, where the
 * documents are the CV, and "From your documents" otherwise, where saying CV would be wrong.
 * An example story (only with the user's "Full example story" setting) is made up, not backed by the
 * CV, so its tag says so (ADR-0084): "Example — not from your CV" (or "your documents").
 *
 * @param source      The answer's source.
 * @param sessionType The session's type ('interview', 'regular', 'mock'), when there is one.
 * @returns The tag's words.
 * Called from: the answer cards; tests
 */
export function sourceLabel(source: AnswerSource, sessionType?: string): string {
  const documents = sessionType === 'regular' || sessionType === undefined;
  if (source === 'example') {
    return documents ? 'Example — not from your documents' : 'Example — not from your CV';
  }
  if (source !== 'docs') return SOURCE_LABELS[source];
  return documents ? 'From your documents' : 'From your CV';
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

/**
 * The hidden first line, however many values it has and in whatever case: a real reply wrote
 * "[[calculation|for|kite|general]]", which the reader must not see. The first value must be
 * words, so text that only looks similar, such as the list "[[1, 2, 3]]", stays in the answer.
 */
const META_LINE = /^\s*\[\[\s*(\p{L}[\p{L}\p{N}_ -]*?)\s*((?:\|[^[\]\n]*)?)\]\]/u;

/** The source words Kite knows. */
const ANSWER_SOURCES: readonly string[] = ['docs', 'call', 'general', 'example'];

/**
 * ADR-0107: type words the model writes instead of a Kite type, mapped to the type they mean (measured in
 * screenshot replies: "code", "screen", "mcq"). Keys are lower case with spaces, hyphens and underscores
 * removed. Without this map each of them showed "Other" on the card.
 */
export const ANSWER_TYPE_ALIASES: Readonly<Record<string, AnswerType>> = {
  code: 'coding',
  codingproblem: 'coding',
  programming: 'coding',
  algorithm: 'coding',
  bug: 'codefix',
  error: 'codefix',
  debug: 'codefix',
  codeerror: 'codefix',
  mcq: 'task',
  quiz: 'task',
  multiplechoice: 'task',
  chat: 'task',
  message: 'task',
  form: 'task',
  question: 'task',
  onscreenquestion: 'task',
  chart: 'table',
  graph: 'table',
  dashboard: 'table',
  presentation: 'slide',
  doc: 'document',
  pdf: 'document',
  page: 'webpage',
  website: 'webpage',
  site: 'webpage',
  web: 'webpage',
  screen: 'webpage',
  screenshot: 'webpage',
};

/**
 * ADR-0107: a type word as Kite reads it: a known type as it is, a known near-miss as the type it means,
 * anything else as `other`.
 *
 * @param word The first value of the hidden line, cleaned up.
 * @returns The type.
 * Called from: metaFrom(); tests
 */
export function answerTypeOf(word: string): AnswerType {
  if ((ANSWER_TYPES as readonly string[]).includes(word)) return word as AnswerType;
  return ANSWER_TYPE_ALIASES[word.toLowerCase().replace(/[\s_-]+/g, '')] ?? 'other';
}

/**
 * Reads the hidden first line's values. Each unknown value falls back on its own, so one odd word
 * costs one label and not the whole answer. The answer's reader is looked for among all the values
 * after the type, and its source among those after that, so a line with an extra value still
 * marks a private answer as private.
 *
 * @param values The line's values, cleaned up, the type first.
 * @returns The meta.
 * Called from: splitMetaLine()
 */
function metaFrom(values: readonly string[]): AnswerMeta {
  const [type = '', ...rest] = values;
  const source = rest
    .slice(1)
    .filter((value) => ANSWER_SOURCES.includes(value))
    .at(-1);
  return {
    type: answerTypeOf(type),
    target: rest.includes('kite') ? 'kite' : 'call',
    source: (source as AnswerSource | undefined) ?? 'general',
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
  const values = match
    ? `${match[1]!}${match[2]!}`.split('|').map((value) => value.trim().toLowerCase())
    : [];
  // A reply that opens with the hidden question line is left to the question filter, which keeps
  // the question.
  if (match && values[0] !== 'question') {
    return {
      state: 'found',
      meta: metaFrom(values),
      rest: trimmed.slice(match[0].length).trimStart(),
    };
  }
  // Could this still become a meta line? "[", "[[", or an unfinished "[[coding|ca".
  const couldBe = trimmed.startsWith('[[') || trimmed === '[';
  return couldBe && trimmed.length < MAX_META_LINE_CHARS && !trimmed.includes('\n')
    ? { state: 'waiting' }
    : { state: 'none' };
}

/**
 * The start of the hidden LAST line (v1.0.2, ADR-0037): "[[question|<the question, cleaned>]]".
 * It comes after the answer, so the first word is never delayed by it; the card shows the raw
 * question until it arrives. Rules from before v1.0.2 (the v-previous rollback) never write it.
 */
export const QUESTION_LINE_PREFIX = '[[question|';

/** Longest hidden question line: anything longer is treated as broken and dropped, not shown. */
export const MAX_QUESTION_LINE_CHARS = 240;

/** The prefix with any white space Claude put inside it, for a complete line. */
const QUESTION_LINE_START = /^\[\[\s*question\s*\|/i;

/** What one look at text that starts with "[" finds. */
type QuestionLineCheck =
  | {
      /** Not a hidden question line: the "[" is answer text. */
      kind: 'no';
    }
  | {
      /** Could still become one: hold the text until more arrives. */
      kind: 'maybe';
    }
  | {
      /** A complete hidden line. */
      kind: 'found';
      /** The cleaned question ('' when Claude left it empty). */
      question: string;
      /** The text after the line, without the line break that ends it. */
      rest: string;
    }
  | {
      /** A hidden line that broke (a line break before "]]"): dropped, never shown. */
      kind: 'broken';
      /** The text after the line break. */
      rest: string;
    }
  | {
      /** A hidden line longer than the limit with no end yet: drop it up to its line break. */
      kind: 'overflow';
    };

/**
 * Looks at text that starts with "[" and says whether it is (or may become) the hidden question
 * line.
 *
 * @param text Text starting with "[".
 * @param ended True when no more text will come (the reply finished).
 * @returns See QuestionLineCheck.
 * Called from: createQuestionLineFilter()
 */
function checkQuestionLine(text: string, ended: boolean): QuestionLineCheck {
  const start = QUESTION_LINE_START.exec(text);
  if (!start) {
    // Too short to tell yet? Compare without white space, so "[[ quest" still counts.
    const compact = text.replace(/\s+/g, '').toLowerCase();
    const couldBe =
      !text.includes('\n') &&
      compact.length < QUESTION_LINE_PREFIX.length &&
      QUESTION_LINE_PREFIX.startsWith(compact);
    return couldBe && !ended ? { kind: 'maybe' } : { kind: 'no' };
  }
  const close = text.indexOf(']]', start[0].length);
  const lineBreak = text.indexOf('\n');
  if (close !== -1 && (lineBreak === -1 || close < lineBreak)) {
    const question = text.slice(start[0].length, close).replace(/\s+/g, ' ').trim();
    // The line's own line break goes with it.
    const rest = text.slice(close + 2).replace(/^[ \t]*\n/, '');
    return { kind: 'found', question, rest };
  }
  if (lineBreak !== -1) return { kind: 'broken', rest: text.slice(lineBreak + 1) };
  if (ended || text.length > MAX_QUESTION_LINE_CHARS) return { kind: 'overflow' };
  return { kind: 'maybe' };
}

/** What a question-line filter hands back for each piece. */
export interface QuestionLineOutput {
  /** Answer text that can be shown now ('' when everything is held or dropped). */
  text: string;
  /** The cleaned question, when its hidden line completed in this piece. */
  question?: string;
}

/** A streaming filter that takes the hidden question line out of an answer's text. */
export interface QuestionLineFilter {
  /**
   * Feeds the next piece of answer text.
   *
   * @param piece The piece.
   * @returns The text that can be shown now, and the question if its line completed.
   */
  push(piece: string): QuestionLineOutput;
  /**
   * The reply finished: releases held text that turned out to be answer text. A hidden line that
   * never closed is dropped (fail-safe: "[[" never reaches the card).
   *
   * @returns The rest of the text, and the question if its line completed only now.
   */
  end(): QuestionLineOutput;
}

/**
 * Creates the filter that removes the hidden question line from a streaming answer. Text without
 * "[" passes straight through; only from a "[" that could start the line is text held, and only
 * until it is clear (a different character, a line break, the length limit or the end). So the
 * answer is never held back, and a malformed line is dropped rather than shown.
 *
 * @returns The filter.
 * Called from: apps/web/src/server/answer-meta.ts (withAnswerMeta); scripts; tests
 */
export function createQuestionLineFilter(): QuestionLineFilter {
  let held = '';
  // Dropping the rest of an over-long hidden line, up to its line break.
  let skipping = false;

  const run = (input: string, ended: boolean): QuestionLineOutput => {
    let text = input;
    let out = '';
    let question: string | undefined;
    while (text !== '') {
      if (skipping) {
        const lineBreak = text.indexOf('\n');
        if (lineBreak === -1) return { text: out, ...(question !== undefined ? { question } : {}) };
        text = text.slice(lineBreak + 1);
        skipping = false;
        continue;
      }
      const bracket = text.indexOf('[');
      if (bracket === -1) {
        out += text;
        break;
      }
      out += text.slice(0, bracket);
      text = text.slice(bracket);
      const check = checkQuestionLine(text, ended);
      if (check.kind === 'maybe') {
        held = text;
        break;
      }
      if (check.kind === 'no') {
        out += '[';
        text = text.slice(1);
      } else if (check.kind === 'found') {
        question = check.question;
        text = check.rest;
      } else if (check.kind === 'broken') {
        text = check.rest;
      } else {
        skipping = true;
        text = '';
      }
    }
    return { text: out, ...(question !== undefined ? { question } : {}) };
  };

  return {
    push(piece) {
      const input = held + piece;
      held = '';
      return run(input, false);
    },
    end() {
      const input = held;
      held = '';
      const result = run(input, true);
      skipping = false;
      return result;
    },
  };
}
