/**
 * File: apps/web/src/core/answer/context.ts
 * Purpose: Builds an answer request from what the live page has in memory: the session and its
 *          documents, the transcript, and the answers already given in this call. Stable lines
 *          and finished answers go into the append-only conversation (one new chunk per
 *          request, never changing an old one); the lines that may still change go into the
 *          tail; the question is picked from the transcript (or typed, for chat).
 * Used by: src/features/live (Answer and Chat, and the idle re-warm's conversation)
 * Depends on: @kite/shared (request types and limits), src/core/answer/warm.ts
 *             (toSessionContext), src/core/transcript (stability.ts, question.ts, Utterance)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1, §6.3; day-04-answers.md
 *               "Prompt design" and Stage 5; ADR-0025
 *
 * Pure: the conversation sent so far (ConversationLog) goes in and the next one comes out, so
 * the caller decides when a request was really sent and keeps the log for the next one.
 *
 * Why the log remembers each line's text: the cache needs every chunk to stay byte-identical,
 * so a line is never sent twice. In the rare case a line grows after it was sent (a merge that
 * the stable-line rules could not foresee), only the added words are sent, as a continuation
 * line; any other change to a sent line is not sent at all (the original stays). Transcript,
 * question and answer text is never logged.
 */
import {
  CONVERSATION_CAP_STEP_TOKENS,
  MAX_ANSWER_CHARS,
  MAX_CONVERSATION_CHUNKS,
  MAX_CONVERSATION_TOKENS,
  MAX_LINE_CHARS,
  MAX_TAIL_LINES,
  estimateItemTokens,
  type AnswerRequest,
  type CallLine,
  type ConversationChunk,
  type ConversationItem,
} from '@kite/shared';
import type { Session, StoredDocument } from '../storage/types';
import { selectQuestion, type SelectedQuestion } from '../transcript/question';
import { splitStable } from '../transcript/stability';
import type { Utterance } from '../transcript/transcript';
import { toSessionContext } from './warm';

/** An answer given earlier in this call, as the live page keeps it in memory. */
export interface CallAnswer {
  /** The answer's id (the same id it is saved under). */
  id: string;
  /** 'answer' (question from the transcript) or 'chat' (typed question). */
  mode: 'answer' | 'chat';
  /** The question it answered. */
  question: string;
  /** The answer text as shown. */
  text: string;
  /** When the user asked for it (Unix ms). */
  askedAt: number;
}

/** The conversation sent so far in this call (start a call with emptyLog()). */
export interface ConversationLog {
  /** The chunks sent, oldest first, exactly as sent. */
  chunks: ConversationChunk[];
  /** Text sent for each transcript line id (including any continuation). */
  sentLines: ReadonlyMap<string, string>;
  /** Ids of the answers sent. */
  sentAnswers: ReadonlySet<string>;
}

/** Everything buildAnswerRequest() needs. */
export interface AnswerContextInput {
  /** The stored session. */
  session: Session;
  /** Its documents. */
  documents: readonly StoredDocument[];
  /** The visible transcript lines (Transcript.lines(): finals and partials, no echoes). */
  lines: readonly Utterance[];
  /** Answers given in this call so far that have finished (oldest first or any order). */
  answers: readonly CallAnswer[];
  /** 'answer' (the Answer key) or 'chat' (a typed question). */
  mode: 'answer' | 'chat';
  /** The typed question (mode 'chat'). */
  typedQuestion?: string;
  /** Unix ms now, on the transcript's clock. */
  now: number;
  /** When the call connected (Unix ms); times in the request are seconds since then. */
  callStartedAt: number;
  /** The conversation sent so far. */
  log: ConversationLog;
}

/** What buildAnswerRequest() returns. */
export interface BuiltAnswerRequest {
  /** The request to send. */
  request: AnswerRequest;
  /** The conversation log after this request (keep it once the request is sent). */
  log: ConversationLog;
  /** The question picked from the transcript (mode 'answer'), or null. */
  selected: SelectedQuestion | null;
}

/**
 * An empty conversation log, for the start of a call.
 *
 * @returns A log with nothing sent.
 * Called from: the live page (on Connect); tests
 */
export function emptyLog(): ConversationLog {
  return { chunks: [], sentLines: new Map(), sentAnswers: new Set() };
}

/**
 * Seconds since the call connected, as a whole number (never negative).
 *
 * @param unixMs        A time (Unix ms).
 * @param callStartedAt When the call connected (Unix ms).
 * @returns Whole seconds.
 * Called from: buildAnswerRequest()
 */
function secondsSince(unixMs: number, callStartedAt: number): number {
  return Math.max(0, Math.floor((unixMs - callStartedAt) / 1000));
}

/**
 * Drops the oldest chunks once the conversation is above a request limit
 * (MAX_CONVERSATION_TOKENS or MAX_CONVERSATION_CHUNKS), down to one CONVERSATION_CAP_STEP_TOKENS
 * step under the token limit, so it happens rarely (calls of about 3 hours) and each time
 * moves the start of the conversation only once. The server's own cap (prompt.ts) keeps far
 * less, so the dropped chunks were no longer in the prompt anyway.
 *
 * @param chunks Chunks, oldest first.
 * @returns The chunks kept (the newest is always kept).
 * Called from: buildAnswerRequest()
 */
function trimToLimits(chunks: ConversationChunk[]): ConversationChunk[] {
  const size = (chunk: ConversationChunk) =>
    chunk.reduce((total, item) => total + estimateItemTokens(item), 0);
  let total = chunks.reduce((sum, chunk) => sum + size(chunk), 0);
  if (total <= MAX_CONVERSATION_TOKENS && chunks.length <= MAX_CONVERSATION_CHUNKS) return chunks;
  const target = MAX_CONVERSATION_TOKENS - CONVERSATION_CAP_STEP_TOKENS;
  let first = 0;
  while (
    first < chunks.length - 1 &&
    (total > target || chunks.length - first > MAX_CONVERSATION_CHUNKS)
  ) {
    total -= size(chunks[first]!);
    first += 1;
  }
  return chunks.slice(first);
}

/**
 * Builds the request for an Answer or a Chat question.
 *
 * @param input See AnswerContextInput.
 * @returns The request, the log to keep once it is sent, and the selected question.
 * Called from: the live page's Answer and Chat actions; tests
 */
export function buildAnswerRequest(input: AnswerContextInput): BuiltAnswerRequest {
  const { stable, tail } = splitStable(input.lines, input.now);
  const sentLines = new Map(input.log.sentLines);
  const sentAnswers = new Set(input.log.sentAnswers);

  // New items, each with the Unix time used to order them.
  const fresh: { time: number; item: ConversationItem }[] = [];
  for (const line of stable) {
    const sent = sentLines.get(line.id);
    let text: string;
    if (sent === undefined) text = line.text.trim();
    else if (line.text.trim().length > sent.length && line.text.trim().startsWith(sent)) {
      text = line.text.trim().slice(sent.length).trim();
    } else continue;
    sentLines.set(line.id, line.text.trim());
    if (text === '') continue;
    fresh.push({
      time: line.tStart,
      item: {
        kind: 'line',
        speaker: line.speaker,
        text: text.slice(0, MAX_LINE_CHARS),
        at: secondsSince(line.tStart, input.callStartedAt),
      },
    });
  }
  for (const answer of input.answers) {
    if (sentAnswers.has(answer.id) || answer.text.trim() === '') continue;
    sentAnswers.add(answer.id);
    fresh.push({
      time: answer.askedAt,
      item: {
        kind: 'answer',
        mode: answer.mode,
        question: answer.question.trim().slice(0, MAX_LINE_CHARS),
        text: answer.text.trim().slice(0, MAX_ANSWER_CHARS),
        at: secondsSince(answer.askedAt, input.callStartedAt),
      },
    });
  }
  // Time order within the new chunk (a stable sort keeps lines before an answer at the same ms).
  fresh.sort((a, b) => a.time - b.time);
  const chunks =
    fresh.length > 0
      ? trimToLimits([...input.log.chunks, fresh.map((entry) => entry.item)])
      : input.log.chunks;

  const tailLines: CallLine[] = tail
    .filter((line) => line.text.trim() !== '')
    .slice(-MAX_TAIL_LINES)
    .map((line) => ({
      speaker: line.speaker,
      text: line.text.trim().slice(0, MAX_LINE_CHARS),
      at: secondsSince(line.tStart, input.callStartedAt),
    }));

  const selected = input.mode === 'answer' ? selectQuestion(input.lines) : null;
  const question =
    input.mode === 'chat' ? (input.typedQuestion ?? '').trim() : (selected?.text ?? '');

  const request: AnswerRequest = {
    mode: input.mode,
    model: input.session.preferences.model,
    session: toSessionContext(input.session, input.documents),
    ...(chunks.length > 0 ? { conversation: chunks } : {}),
    ...(tailLines.length > 0 ? { tail: tailLines } : {}),
    ...(question ? { question: question.slice(0, MAX_LINE_CHARS) } : {}),
  };
  return { request, log: { chunks, sentLines, sentAnswers }, selected };
}
