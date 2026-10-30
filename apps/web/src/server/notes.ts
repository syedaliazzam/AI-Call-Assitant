/**
 * File: apps/web/src/server/notes.ts
 * Purpose: Writes the notes for a finished call with the smart model (Sonnet): a short summary,
 *          the questions the other side asked (with whether a Kite answer covered them and that
 *          answer's rating), the agreed next steps, the parts too unclear to summarise, and up to
 *          3 proposed lessons from the user's ratings and notes. One structured (JSON) request.
 * Used by: app/api/notes/route.ts; scripts/verify-notes.ts, scripts/eval-notes.ts
 * Depends on: src/server/claude.ts (jsonReply, cachedBlock), src/server/prompt.ts (sessionBlock,
 *             clockTime), @kite/shared (notes types and limits)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/notes), §7.6 (learning
 *               loop); day-05-overlay-screenshots-notes.md Stage 5
 *
 * - The session block is the same text as the answers use (sessionBlock()), cached; the notes
 *   rules are a constant, cached too. (The answers' cache is not shared: it is per model.)
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
import { clockTime, sessionBlock } from './prompt';

/** Most tokens the notes may use (a long call's notes are about 1,000–1,500). */
export const NOTES_MAX_TOKENS = 4_000;

/** Time limit for the notes request, in ms (a 60-minute call takes about 20–40 s). */
export const NOTES_TIMEOUT_MS = 110_000;

/** The notes rules. A constant (cached); nothing that changes between calls. */
export const NOTES_RULES = `You are Kite. A call has just ended. Write short, faithful notes for the user, who took part in the call.

Rules:
- Use only what is in the transcript, the answers Kite gave, and the session details and documents. Never invent names, numbers, dates, commitments or next steps.
- The transcript comes from speech recognition and contains mistakes. Names and terms are often misheard; read them in the light of the session's key terms and documents.
- If a part of the call is too unclear to follow (garbled words, missing pieces, or lines that do not make sense together), do not guess what was said: add it to "unclear" with its time range (in seconds since the call started) and a short reason, and leave it out of the summary.
- summary: at most ${MAX_SUMMARY_BULLETS} short bullets about what was discussed and decided.
- questions: the questions the other person ("Them") asked, each in a few words, with when it was asked (seconds since the call started). "answered" says whether one of Kite's answers covered it: yes, partly or no. If one did, "answeredAt" is that answer's time (seconds) exactly as given in the answers list; otherwise null.
- nextSteps: only steps that were actually agreed or promised in the call, with the person who will do them if a name or role was said (otherwise an empty owner).
- lessons: at most ${MAX_PROPOSED_LESSONS} short lessons for how Kite should answer in future calls, each one sentence, based only on the user's ratings and notes on Kite's answers (a thumbs down, or a note saying what was wrong or what a better answer would be). Give the evidence: which answer (its time and question) and the rating or note. If the ratings and notes show nothing to learn, give no lessons.
- Write plainly. No preamble.`;

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
          answeredAt: { type: ['integer', 'null'] },
        },
        required: ['question', 'at', 'answered', 'answeredAt'],
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
  /** The questions, with the time of the Kite answer that covered each (or null). */
  questions: (Omit<NotesQuestion, 'rating'> & {
    /** The covering answer's time, in seconds, or null. */
    answeredAt: number | null;
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
 * Writes one answer for the prompt, with the user's rating and note.
 *
 * @param answer The answer.
 * @returns Its text block.
 * Called from: notesPrompt()
 */
function answerText(answer: NotesAnswer): string {
  const rating =
    answer.rating === 'up' ? 'thumbs up' : answer.rating === 'down' ? 'thumbs down' : 'not rated';
  return [
    `<answer at="${answer.at}" time="${clockTime(answer.at)}" asked="${answer.mode}">`,
    `Question: ${escape(answer.question)}`,
    `User's rating: ${rating}`,
    `User's note: ${answer.note.trim() ? escape(answer.note.trim()) : '(none)'}`,
    'Answer:',
    escape(answer.text),
    '</answer>',
  ].join('\n');
}

/**
 * The notes prompt: the cached rules and session block, and the call as the user turn.
 *
 * @param request A validated notes request.
 * @returns The system blocks and the user turn's text.
 * Called from: generateCallNotes(); tests
 */
export function notesPrompt(request: NotesRequest) {
  const lines = request.lines.map(
    (line) =>
      `[${clockTime(line.at)}] ${line.speaker === 'you' ? 'You' : 'Them'}: ${escape(line.text)}`,
  );
  const last = request.lines.at(-1)?.at ?? 0;
  const prompt = [
    `The call lasted about ${clockTime(last)} (times are minutes:seconds since it started; "at" values are seconds).`,
    '',
    '<transcript>',
    ...(lines.length > 0 ? lines : ['(nothing was transcribed)']),
    '</transcript>',
    '',
    '<answers>',
    ...(request.answers.length > 0 ? request.answers.map(answerText) : ['(Kite gave no answers)']),
    '</answers>',
    '',
    'Write the notes.',
  ].join('\n');
  return {
    system: [cachedBlock(NOTES_RULES), cachedBlock(sessionBlock(request.session))],
    prompt,
  };
}

/**
 * Adds each question's rating from the request (the answer at the time the model gave), and
 * keeps the counts within the limits.
 *
 * @param model    The model's notes.
 * @param answers  The request's answers.
 * @returns The notes.
 * Called from: generateCallNotes(); tests
 */
export function finishNotes(model: ModelNotes, answers: readonly NotesAnswer[]): CallNotes {
  const ratingAt = new Map(answers.map((answer) => [answer.at, answer.rating]));
  return {
    summary: model.summary.slice(0, MAX_SUMMARY_BULLETS),
    questions: model.questions.map(({ answeredAt, ...question }) => ({
      ...question,
      // Only a rating the user actually gave; an answer time the model made up gives none.
      rating: answeredAt === null ? null : (ratingAt.get(answeredAt) ?? null),
    })),
    nextSteps: model.nextSteps,
    unclear: model.unclear,
    lessons: model.lessons.slice(0, MAX_PROPOSED_LESSONS),
  };
}

/**
 * Writes the notes for a call with the smart model.
 *
 * @param request A validated notes request.
 * @param model   The smart model's name (KITE_MODEL_SMART).
 * @returns The notes and the token usage.
 * @throws Anthropic.APIError on API failures; Error('NO_JSON') when the reply has no notes.
 * Called from: POST handler in app/api/notes/route.ts; scripts/verify-notes.ts,
 *              scripts/eval-notes.ts
 */
export async function generateCallNotes(
  request: NotesRequest,
  model: string,
): Promise<{ notes: CallNotes; usage: AnswerUsage }> {
  const { system, prompt } = notesPrompt(request);
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
