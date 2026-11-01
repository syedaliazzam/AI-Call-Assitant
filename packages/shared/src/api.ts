/**
 * File: packages/shared/src/api.ts
 * Purpose: Request and response types for POST /api/answer (and later /api/notes), shared by the
 *          server route and the browser answer client so both sides agree on the wire format.
 * Used by: apps/web/src/server/validate.ts, apps/web/src/server/prompt.ts,
 *          apps/web/app/api/answer/route.ts, apps/web/src/core/answer/answerClient.ts,
 *          apps/web/src/core/answer/warm.ts
 * Depends on: nothing (types, limits and one pure helper; no Node or browser APIs)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (POST /api/answer)
 */

/**
 * What kind of answer the client is asking for.
 * - `hello`: Day 1 test reply that proves streaming and prompt caching work.
 * - `warm`: pre-warms the prompt cache for a session before the call starts (Day 3).
 * - `answer`: answers the latest question from the other side (Day 4).
 * - `chat`: answers a question the user typed (Day 4).
 * - `screenshot`: answers from a screenshot of the screen (Day 5).
 * All modes work: `hello`, `warm` (Day 3), `answer` and `chat` (Day 4), `screenshot` (Day 5).
 */
export type AnswerMode = 'hello' | 'warm' | 'answer' | 'chat' | 'screenshot';

/**
 * Which Claude model tier to use. The real model names come from server environment variables
 * (KITE_MODEL_FAST, KITE_MODEL_SMART), so the client never names a model directly.
 * - `fast`: live answers (Haiku).
 * - `smart`: slower, higher-quality output such as notes (Sonnet).
 */
export type ModelTier = 'fast' | 'smart';

/** Who said a transcript line: the microphone ("you") or the other side of the call ("them"). */
export type Speaker = 'you' | 'them';

/** How answers should look. Chosen per session in the wizard (Day 3). */
export interface AnswerStyle {
  /** Layout of the answer, for example 'headline+bullets'. */
  format: string;
  /** Rough answer length, for example 'short'. */
  length: string;
  /** Wording style, for example 'simple'. */
  tone: string;
}

/** A document the user attached to a session, already converted to plain text in the browser. */
export interface SessionDocument {
  /** Original file name, shown to Claude so it can cite the source (for example 'pricing.pdf'). */
  name: string;
  /** Extracted plain text of the document. Never logged. */
  text: string;
}

/** The session details sent with every answer request; forms the cached part of the prompt. */
export interface SessionContext {
  /** Kind of call, for example 'sales' or 'interview'. */
  type: string;
  /** Company the call is with. */
  company: string;
  /** The user's role or the purpose of the call, for example 'Account review'. */
  role: string;
  /**
   * Free-text description of the call ('' when not given). Not in the §7.2 example; added on
   * Day 3 (recorded in architecture 3.3.0).
   */
  description: string;
  /** Free-text instructions from the user for how Kite should answer. */
  instructions: string;
  /**
   * Names and terms the user typed for this session (one per entry, in the order typed). Sent so
   * Claude can recognise them when the transcript mishears them (Day 3; not in the §7.2 example,
   * recorded in architecture 3.3.0).
   */
  keyTerms: string[];
  /** How answers should look. */
  style: AnswerStyle;
  /** Attached documents (total capped at about 150k characters by the server). */
  documents: SessionDocument[];
}

/**
 * One transcript line in a request. Lines carry no ids or clock times, only what the prompt
 * shows, so the same call always gives the same bytes (prompt caching, architecture §6.3).
 */
export interface CallLine {
  /** Who said it. */
  speaker: Speaker;
  /** What was said. Never logged. */
  text: string;
  /** When the line started, in whole seconds since the call connected (shown as mm:ss). */
  at: number;
}

/** A stable transcript line in the conversation (final, about 5 s old, not an echo). */
export interface ConversationLine extends CallLine {
  /** Item kind. */
  kind: 'line';
}

/** An answer Kite gave earlier in this call, placed in the conversation at its time. */
export interface ConversationAnswer {
  /** Item kind. */
  kind: 'answer';
  /**
   * 'answer' (a question from the transcript), 'chat' (a question the user typed) or
   * 'screenshot' (answered from a screenshot, which is not sent again: Day 5).
   */
  mode: 'answer' | 'chat' | 'screenshot';
  /** The question it answered. Never logged. */
  question: string;
  /** The answer as shown (headline, then bullets). Never logged. */
  text: string;
  /** When the user asked for it, in whole seconds since the call connected. */
  at: number;
}

/** One item of the conversation timeline. */
export type ConversationItem = ConversationLine | ConversationAnswer;

/**
 * A group of conversation items, oldest first. The client never changes a chunk once it has
 * sent it, and adds at most one new chunk per request, at the end. The server writes each chunk
 * as its own prompt block with the cache breakpoint on the last one, so every request reads
 * the previous request's cache entry (Claude's cache reads land only where an earlier request
 * put a breakpoint, and look back at most 20 blocks; ADR-0025).
 */
export type ConversationChunk = ConversationItem[];

/** Rough characters per token, for size estimates (no tokenizer in the browser). */
export const CHARS_PER_TOKEN = 4;

/**
 * Most estimated tokens of conversation the prompt keeps (about 90 minutes of speech). Beyond
 * it, the server drops the oldest chunks (server/prompt.ts, capConversation()).
 */
export const CONVERSATION_CAP_TOKENS = 20_000;

/**
 * The prompt drops old chunks in steps of this many estimated tokens, so the start of the
 * conversation (and with it the cache) stays the same until the next step.
 */
export const CONVERSATION_CAP_STEP_TOKENS = 5_000;

/**
 * Most estimated tokens of conversation a request may carry (validation; twice the prompt's
 * cap). The client drops its oldest chunks to stay under it.
 */
export const MAX_CONVERSATION_TOKENS = 40_000;

/** Most conversation chunks a request may carry. */
export const MAX_CONVERSATION_CHUNKS = 300;

/** Most not-yet-stable lines a request may carry in its tail. */
export const MAX_TAIL_LINES = 100;

/** Longest transcript line or question, in characters. */
export const MAX_LINE_CHARS = 2_000;

/**
 * Longest screenshot data URL, in characters: about 1 MB of JPEG in base64 (the client keeps
 * the JPEG under 1 MB, core/screenshot/prepare.ts).
 */
export const MAX_IMAGE_CHARS = 1_400_000;

/** The question a screenshot answer uses when the user typed none. */
export const DEFAULT_SCREENSHOT_QUESTION = "What's on screen and how should I respond?";

/** Longest earlier answer in the conversation, in characters (400 tokens is about 1,600). */
export const MAX_ANSWER_CHARS = 4_000;

/**
 * Estimated token count of one conversation item (the text it adds to the prompt).
 *
 * @param item A conversation item.
 * @returns ceil(characters / CHARS_PER_TOKEN).
 * Called from: apps/web/src/server/validate.ts, apps/web/src/server/prompt.ts (capConversation),
 *              apps/web/src/core/answer/context.ts (Day 4, Stage 5)
 */
export function estimateItemTokens(item: ConversationItem): number {
  const chars = item.kind === 'line' ? item.text.length : item.question.length + item.text.length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Body of POST /api/answer.
 * `{ mode: 'hello' }` needs nothing else; `warm` needs `session` (and may carry the
 * conversation so far, for the idle re-warm); `answer` and `chat` need `session`, and `chat`
 * needs `question`. All are checked by the server's zod schema (apps/web/src/server/validate.ts).
 */
export interface AnswerRequest {
  /** What kind of answer is wanted. */
  mode: AnswerMode;
  /** Model tier; the server defaults to `fast` when omitted. */
  model?: ModelTier;
  /** Session details (modes `warm`, `answer`, `chat`, `screenshot`). */
  session?: SessionContext;
  /**
   * The call so far, as append-only chunks of stable lines and earlier answers (cached). Day 4
   * replaces the Day 1–3 `transcript` window (architecture 3.4.0).
   */
  conversation?: ConversationChunk[];
  /** Lines that may still change (newest, not yet stable), oldest first. Not cached. */
  tail?: CallLine[];
  /** The question to answer: selected from the transcript or typed by the user. */
  question?: string;
  /**
   * Mode `screenshot` only, and required there: the screenshot as a JPEG data URL
   * (`data:image/jpeg;base64,…`, at most MAX_IMAGE_CHARS). Never logged or stored.
   */
  image?: string | null;
  /**
   * The lessons the user approved for this session's type (Day 5 Stage 7): at most
   * MAX_ACTIVE_LESSONS, each at most MAX_LESSON_CHARS, oldest approval first. They go in the
   * cached rules block, so the warm-up and every answer of a call send the same list.
   * Omitted or empty: the rules block is unchanged. Never logged (only their count).
   */
  lessons?: string[];
}

/** Token counts reported by the Claude API for one reply. Names match the API's usage fields. */
export interface AnswerUsage {
  /** Input tokens that were neither written to nor read from the prompt cache. */
  input_tokens: number;
  /** Tokens Claude generated. */
  output_tokens: number;
  /** Input tokens written to the prompt cache by this request (first request with a new prefix). */
  cache_creation_input_tokens: number;
  /** Input tokens read from the prompt cache (cheaper and faster; > 0 on a repeated prefix). */
  cache_read_input_tokens: number;
}

/**
 * Server-side timings for one reply, in milliseconds. Used to see where the time to the first
 * word goes (sign-in check, reaching Claude, Claude producing text).
 */
export interface AnswerTimings {
  /** Sign-in check (session lookup in the accounts database): request start → session known. */
  auth: number;
  /** Request start → Claude's streaming response opened (HTTP response headers received). */
  toStreamOpen: number;
  /** Claude stream opened → first text delta (Claude's own time to the first token). */
  streamOpenToFirstText: number;
  /** Request start → first text delta sent. */
  toFirstText: number;
  /** Request start → reply complete. */
  total: number;
}

/**
 * Machine-readable error codes sent in an `error` event or a non-200 response.
 * - `unauthorized`: no valid sign-in session.
 * - `bad_request`: the body failed validation.
 * - `not_implemented`: the mode is not available yet (message names the day).
 * - `upstream_error`: the Claude API returned an error.
 * - `timeout`: Claude did not finish within the server time limit (60 s).
 * - `refused`: Claude declined to answer (stop reason "refusal"); nothing more will follow.
 * - `claude_unavailable`: Claude cannot answer for anyone right now (the team's usage limit is
 *   reached, or Claude is overloaded); the message is one of CLAUDE_UNAVAILABLE_MESSAGES and is
 *   shown as it is.
 * - `internal`: any other server failure.
 */
export type AnswerErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_implemented'
  | 'upstream_error'
  | 'timeout'
  | 'refused'
  | 'claude_unavailable'
  | 'internal';

/**
 * The messages sent with `claude_unavailable`, shown as they are in the live view, the compact
 * view and the notes status. Each says that the transcript is still being recorded, because
 * only Claude is down: listening, the transcript and saving keep working.
 */
export const CLAUDE_UNAVAILABLE_MESSAGES = {
  /** The team's Claude usage (spend) limit is reached, or its credit has run out. */
  usageLimit:
    "Answers are unavailable right now: the team's Claude usage limit has been reached. Your transcript is still being recorded.",
  /** Claude is overloaded (HTTP 529, or an overloaded_error in the stream). */
  overloaded:
    'Answers are unavailable right now: Claude is overloaded. Your transcript is still being recorded.',
} as const;

/**
 * One server-sent event from /api/answer. The SSE event name equals `type`; the remaining fields
 * are the JSON `data` payload.
 * - `delta`: the next piece of answer text.
 * - `done`: the reply finished; carries token usage and server timings.
 * - `error`: the reply failed; no more events follow.
 */
export type AnswerEvent =
  | {
      /** Event name. */
      type: 'delta';
      /** Next piece of answer text, to append to what was already shown. */
      text: string;
    }
  | {
      /** Event name. */
      type: 'done';
      /** Token counts for the whole reply. */
      usage: AnswerUsage;
      /** Server-side timings. */
      ms: AnswerTimings;
    }
  | {
      /** Event name. */
      type: 'error';
      /** Machine-readable reason. */
      code: AnswerErrorCode;
      /** Short human-readable explanation (never contains transcript or document text). */
      message: string;
    };
