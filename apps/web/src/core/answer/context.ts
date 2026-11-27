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
  MAX_CALL_MEMORY_CHARS,
  MAX_ANSWER_CHARS,
  MAX_CONVERSATION_CHUNKS,
  MAX_CONVERSATION_TOKENS,
  MAX_LINE_CHARS,
  MAX_TAIL_LINES,
  estimateItemTokens,
  type AnswerRequest,
  type AnswerTarget,
  type AnswerType,
  type CallLine,
  type ConversationChunk,
  type ConversationItem,
  type PressContext,
} from '@kite/shared';
import type { Session, StoredDocument } from '../storage/types';
import { selectQuestion, type SelectedQuestion } from '../transcript/question';
import { splitStable } from '../transcript/stability';
import type { Utterance } from '../transcript/transcript';
import { getAnswerStyleVersion } from '../storage/answerPrefs';
import { findSimilarAnswer } from './similar';
import { rankChunks, type ChunkIndex } from '../documents/chunks';
import { toLiveSessionContext } from './warm';
import { pinFor } from './instructionsPin';
import type { PressWindow } from './newestQuestion';

/** An answer given earlier in this call, as the live page keeps it in memory. */
export interface CallAnswer {
  /** The answer's id (the same id it is saved under). */
  id: string;
  /** 'answer' (question from the transcript), 'chat' (typed) or 'screenshot' (Day 5). */
  mode: 'answer' | 'chat' | 'screenshot';
  /** The question it answered. */
  question: string;
  /** The answer text as shown. */
  text: string;
  /** When the user asked for it (Unix ms). */
  askedAt: number;
  /** 'kite' when it was a private answer for the user, not words said on the call. */
  target?: AnswerTarget;
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
  /** 'answer' (the Answer key), 'chat' (a typed question) or 'screenshot' (Day 5). */
  mode: 'answer' | 'chat' | 'screenshot';
  /** The typed question (mode 'chat'; optional for 'screenshot', which has a default). */
  typedQuestion?: string;
  /** The prepared screenshot (mode 'screenshot'): a JPEG data URL. In memory only. */
  image?: string;
  /** Unix ms now, on the transcript's clock. */
  now: number;
  /** When the call connected (Unix ms); times in the request are seconds since then. */
  callStartedAt: number;
  /** The conversation sent so far. */
  log: ConversationLog;
  /**
   * The approved lessons for this session (Day 5 Stage 7, core/lessons/active.ts), loaded once
   * when the session opened; the same list as the warm-ups, so the rules block stays cached.
   */
  lessons?: readonly string[];
  /** The chat switch's choice, or absent for Auto (ADR-0030). */
  target?: AnswerTarget;
  /** The question type chosen from the answer card's menu (a re-answer, ADR-0030). */
  answerType?: AnswerType;
  /** A re-answer's question: used instead of picking one from the transcript. */
  question?: string;
  /**
   * Batch C (P2-1): the session documents' parts (core/documents/chunks.ts), ranked against the question;
   * the best ones go with it. Absent: none are sent.
   */
  chunks?: ChunkIndex;
  /**
   * ADR-0107: a screen-only screenshot (Ctrl+Shift+Enter or the Screenshot button): the request carries the
   * session and the image only, never the call (no conversation, latest lines, question, earlier answer or
   * document parts), and the conversation log is left as it was, so the next answer still sends every new
   * line. Its answer is private unless the chat switch says "For the call".
   */
  screenOnly?: boolean;
  /**
   * ADR-0133: a key press on the call: what both sides said since the last answer (newestQuestion.ts
   * pressWindow()), sent as the request's press context.
   */
  press?: PressWindow;
  /** ADR-0133: the questions an earlier card left on its "Still open:" line, answered by this press. */
  stillOpen?: string;
  /** ADR-0137: the call memory (core/answer/callMemory.ts), sent with the answer when there is one. */
  memory?: string;
}

/**
 * ADR-0133: a press window as the request carries it: whether the other side was still speaking, and any
 * questions an earlier card left open. (The words themselves are the request's question; the user's replies
 * are in the conversation.)
 *
 * @param window    The window (newestQuestion.ts pressWindow()).
 * @param stillOpen Questions an earlier card left open, if this press answers them.
 * @returns The press context.
 * Called from: buildAnswerRequest(); tests
 */
export function toPressContext(window: PressWindow, stillOpen?: string): PressContext {
  return {
    speaking: window.speaking,
    ...(stillOpen?.trim() ? { stillOpen: stillOpen.trim().slice(0, MAX_LINE_CHARS) } : {}),
  };
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
 * ADR-0107: the request for a screen-only screenshot: the session (with the user's preferences and the
 * documents, as background), the image, the model and the cache-related fields of every request, and no
 * part of the call. The log comes back unchanged: nothing of the call was sent.
 *
 * @param input The context (mode 'screenshot', screenOnly, with an image).
 * @returns The request, the unchanged log and no selected question.
 * Called from: buildAnswerRequest()
 */
function screenOnlyRequest(input: AnswerContextInput): BuiltAnswerRequest {
  const pin = pinFor(input.callStartedAt);
  const request: AnswerRequest = {
    mode: 'screenshot',
    screenOnly: true,
    model: input.session.preferences.model,
    session: toLiveSessionContext(input.session, input.documents),
    ...(input.image ? { image: input.image } : {}),
    ...(input.lessons?.length ? { lessons: [...input.lessons] } : {}),
    // Private by default (ADR-0107); "For the call" on the chat switch still makes it a call answer.
    target: input.target === 'call' ? 'call' : 'kite',
    ...(getAnswerStyleVersion() === 'previous' ? { styleVersion: 'previous' as const } : {}),
    ...(pin ? { instructionsVersion: pin.live } : {}),
  };
  return { request, log: input.log, selected: null };
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
  if (input.screenOnly && input.mode === 'screenshot' && input.image)
    return screenOnlyRequest(input);
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
        ...(answer.target === 'kite' ? { target: 'kite' as const } : {}),
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

  const selected = input.mode === 'answer' && !input.question ? selectQuestion(input.lines) : null;
  const question =
    input.question?.trim() ||
    (input.mode === 'answer' ? (selected?.text ?? '') : (input.typedQuestion ?? '').trim());
  // No model call: the words of the questions are compared here. A re-answer asks for a different
  // shape on purpose, so it does not reuse the earlier wording.
  const similar = question && !input.answerType ? findSimilarAnswer(question, input.answers) : null;
  // Batch C (P2-1): the documents' parts that match the question (or, with no question picked, what the
  // other person said last).
  const query =
    question ||
    tailLines
      .filter((line) => line.speaker === 'them')
      .map((line) => line.text)
      .join(' ');
  const documentChunks = input.chunks && query ? rankChunks(input.chunks, query) : [];

  // ADR-0083: the company instructions version this call started with (absent until it is known).
  const pin = pinFor(input.callStartedAt);
  const request: AnswerRequest = {
    mode: input.mode,
    model: input.session.preferences.model,
    session: toLiveSessionContext(input.session, input.documents),
    ...(chunks.length > 0 ? { conversation: chunks } : {}),
    ...(tailLines.length > 0 ? { tail: tailLines } : {}),
    ...(question ? { question: question.slice(0, MAX_LINE_CHARS) } : {}),
    ...(input.memory?.trim()
      ? { memory: input.memory.trim().slice(0, MAX_CALL_MEMORY_CHARS) }
      : {}),
    ...(input.mode === 'answer' && input.press
      ? { press: toPressContext(input.press, input.stillOpen) }
      : {}),
    ...(input.mode === 'screenshot' && input.image ? { image: input.image } : {}),
    ...(documentChunks.length > 0 ? { documentChunks } : {}),
    ...(input.lessons?.length ? { lessons: [...input.lessons] } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.answerType ? { answerType: input.answerType } : {}),
    // Absent on the default, so a normal request keeps its cached bytes (ADR-0032).
    ...(getAnswerStyleVersion() === 'previous' ? { styleVersion: 'previous' as const } : {}),
    ...(pin ? { instructionsVersion: pin.live } : {}),
    ...(similar
      ? {
          similar: {
            question: similar.question.trim().slice(0, MAX_LINE_CHARS),
            text: similar.text.trim().slice(0, MAX_ANSWER_CHARS),
            at: secondsSince(similar.askedAt, input.callStartedAt),
          },
        }
      : {}),
  };
  return { request, log: { chunks, sentLines, sentAnswers }, selected };
}
