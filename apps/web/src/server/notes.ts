/**
 * File: apps/web/src/server/notes.ts
 * Purpose: Writes the notes for a finished call with the smart model (Sonnet): a short summary,
 *          the questions the other side asked (with whether a Kite answer covered them and that
 *          answer's rating), the agreed next steps, the parts too unclear to summarise, and up to
 *          3 proposed lessons from the user's ratings and notes. One structured (JSON) request.
 * Used by: app/api/notes/route.ts; scripts/verify-notes.ts, scripts/eval-notes.ts
 * Depends on: src/server/claude.ts (jsonReply, cachedBlock), src/server/prompt.ts (smartSessionBlock,
 *             clockTime), src/server/prompts/contract.ts (the notes contract, ADR-0089),
 *             src/server/prompts/defaults.ts (the default notes prompt), @kite/shared (notes types and limits)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/notes), §7.6 (learning
 *               loop); day-05-overlay-screenshots-notes.md Stage 5
 *
 * - The first cached block is the locked notes contract (the fields the app reads), then the admin's
 *   global prompt for notes (ADR-0089). The session block is the smart-model session block
 *   (smartSessionBlock(): the user's preferences, the CV in full and a summary of the other documents,
 *   ADR-0067), cached too. (The answers' cache is not shared: it is per model.)
 * - Ratings in the notes come from the request (the user's own ratings), never from the model.
 * - A part of the call too unclear to follow is listed as unclear instead of guessed.
 * - Proposed lessons are suggestions: nothing is learned until the user approves one (Stage 7).
 * Notes, transcript and session text is never logged.
 */
import 'server-only';
import {
  MAX_PROPOSED_LESSONS,
  MAX_SUMMARY_BULLETS,
  type CallNotes,
  type NotesAnswer,
  type NotesRequest,
  type NotesQuestion,
  type AnswerUsage,
} from '@kite/shared';
import { cachedBlock, jsonReply } from './claude';
import { clockTime, smartSessionBlock } from './prompt';
import { NOTES_CONTRACT, NOTES_END_REMINDER, withGlobalPrompt } from './prompts/contract';
import { DEFAULT_NOTES_PROMPT } from './prompts/defaults';

/** Most tokens the notes may use (a long call's notes are about 1,000–1,500). */
export const NOTES_MAX_TOKENS = 4_000;

/** Time limit for the notes request, in ms (a 60-minute call takes about 20–40 s). */
export const NOTES_TIMEOUT_MS = 110_000;

/** The structured-output schema of the notes (the model's part; ratings are added after). */
export const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          at: { type: 'integer' },
          answered: { type: 'string', enum: ['yes', 'partly', 'no'] },
          answerId: { type: ['string', 'null'] },
        },
        required: ['question', 'at', 'answered', 'answerId'],
        additionalProperties: false,
      },
    },
    nextSteps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { step: { type: 'string' }, owner: { type: 'string' } },
        required: ['step', 'owner'],
        additionalProperties: false,
      },
    },
    unclear: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'integer' },
          to: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['from', 'to', 'reason'],
        additionalProperties: false,
      },
    },
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, evidence: { type: 'string' } },
        required: ['text', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'questions', 'nextSteps', 'unclear', 'lessons'],
  additionalProperties: false,
};

/** The model's notes, before ratings are added (NOTES_SCHEMA). */
interface ModelNotes extends Omit<CallNotes, 'questions'> {
  /** The questions, with the id of the Kite answer given for each (or null). */
  questions: (Omit<NotesQuestion, 'rating'> & {
    /** The Kite answer's id from the prompt ("A1", "A2", … by position), or null. */
    answerId: string | null;
  })[];
}

/**
 * Makes text safe inside the prompt's tags (a line cannot close a tag).
 *
 * @param text Raw text.
 * @returns The text with &, < and > as entities.
 * Called from: notesPrompt()
 */
function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * An answer's id in the notes prompt: "A" and its position in the request, from 1. The notes
 * link questions to answers by this id (Day 6 Stage 4b), never by time.
 *
 * @param index The answer's position in the request, from 0.
 * @returns The id, for example "A1".
 * Called from: answerText(), finishNotes()
 */
export function answerId(index: number): string {
  return `A${index + 1}`;
}

/**
 * Writes one answer for the prompt, with its id, the user's rating and note.
 *
 * @param answer The answer.
 * @param index  Its position in the request, from 0 (gives its id).
 * @returns Its text block.
 * Called from: notesPrompt()
 */
function answerText(answer: NotesAnswer, index: number): string {
  const rating =
    answer.rating === 'up' ? 'thumbs up' : answer.rating === 'down' ? 'thumbs down' : 'not rated';
  return [
    `<answer id="${answerId(index)}" at="${answer.at}" time="${clockTime(answer.at)}" asked="${answer.mode}">`,
    `Question: ${escape(answer.question)}`,
    `User's rating: ${rating}`,
    `User's note: ${answer.note.trim() ? escape(answer.note.trim()) : '(none)'}`,
    'Answer:',
    escape(answer.text),
    '</answer>',
  ].join('\n');
}

/**
 * A call's record as prompt lines: its transcript and Kite's answers.
 *
 * @param request The call.
 * @returns The lines.
 * Called from: notesPrompt(); server/ask.ts
 */
export function callRecord(request: Pick<NotesRequest, 'lines' | 'answers'>): string[] {
  const lines = request.lines.map(
    (line) =>
      `[${clockTime(line.at)}] ${line.speaker === 'you' ? 'You' : 'Them'}: ${escape(line.text)}`,
  );
  return [
    '<transcript>',
    ...(lines.length > 0 ? lines : ['(nothing was transcribed)']),
    '</transcript>',
    '',
    '<answers>',
    ...(request.answers.length > 0
      ? request.answers.map((answer, index) => answerText(answer, index))
      : ['(Kite gave no answers)']),
    '</answers>',
  ];
}

/**
 * The notes prompt: the cached contract with the global prompt, the session block, and the call as the
 * user turn, ending with the contract's reminder.
 *
 * @param request      A validated notes request.
 * @param globalPrompt The admin's global prompt for notes (ADR-0089; the call's pinned version, or the one
 *                     in force), after the locked contract. '' sends the contract alone.
 * @returns The system blocks and the user turn's text.
 * Called from: generateCallNotes(); tests
 */
export function notesPrompt(request: NotesRequest, globalPrompt: string = DEFAULT_NOTES_PROMPT) {
  const last = request.lines.at(-1)?.at ?? 0;
  const prompt = [
    `The call lasted about ${clockTime(last)} (times are minutes:seconds since it started; "at" values are seconds).`,
    '',
    ...callRecord(request),
    '',
    NOTES_END_REMINDER,
  ].join('\n');
  return {
    system: [
      cachedBlock(withGlobalPrompt(NOTES_CONTRACT, globalPrompt)),
      cachedBlock(smartSessionBlock(request.session)),
    ],
    prompt,
  };
}

/**
 * Adds each question's rating from the request, and keeps the counts within the limits.
 * A rating is attached only when the question names a real Kite answer by its id, and each
 * answer rates at most one question (the first that names it). A question with no such answer
 * is "not answered" with no rating: the user may have answered it themselves (Day 6 Stage 4b;
 * before, a time-based link copied one answer's rating onto several questions).
 *
 * @param model    The model's notes.
 * @param answers  The request's answers.
 * @returns The notes.
 * Called from: generateCallNotes(); tests
 */
export function finishNotes(model: ModelNotes, answers: readonly NotesAnswer[]): CallNotes {
  const byId = new Map(answers.map((answer, index) => [answerId(index), answer]));
  const used = new Set<string>();
  return {
    summary: model.summary.slice(0, MAX_SUMMARY_BULLETS),
    questions: model.questions.map(({ answerId: id, ...question }) => {
      // Only a real, not yet used answer id links a question to a Kite answer; an id the model
      // made up, or one already used for another question, links nothing.
      const answer = id !== null && !used.has(id) ? byId.get(id) : undefined;
      if (!answer || id === null) return { ...question, answered: 'no' as const, rating: null };
      used.add(id);
      return {
        ...question,
        answered: question.answered === 'no' ? 'partly' : question.answered,
        rating: answer.rating,
      };
    }),
    nextSteps: model.nextSteps,
    unclear: model.unclear,
    lessons: model.lessons.slice(0, MAX_PROPOSED_LESSONS),
  };
}

/**
 * Writes the notes for a call with the smart model.
 *
 * @param request      A validated notes request.
 * @param model        The smart model's name (KITE_MODEL_SMART).
 * @param globalPrompt The admin's global prompt for notes (ADR-0089).
 * @returns The notes and the token usage.
 * @throws Anthropic.APIError on API failures; Error('NO_JSON') when the reply has no notes.
 * Called from: POST handler in app/api/notes/route.ts; scripts/verify-notes.ts,
 *              scripts/eval-notes.ts
 */
export async function generateCallNotes(
  request: NotesRequest,
  model: string,
  globalPrompt: string = DEFAULT_NOTES_PROMPT,
): Promise<{ notes: CallNotes; usage: AnswerUsage }> {
  const { system, prompt } = notesPrompt(request, globalPrompt);
  const { value, usage } = await jsonReply({
    model,
    tier: 'smart',
    system,
    prompt,
    schema: NOTES_SCHEMA,
    maxTokens: NOTES_MAX_TOKENS,
    timeoutMs: NOTES_TIMEOUT_MS,
  });
  return { notes: finishNotes(value as ModelNotes, request.answers), usage };
}
