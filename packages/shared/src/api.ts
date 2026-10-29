/**
 * File: packages/shared/src/api.ts
 * Purpose: Request and response types for POST /api/answer (and later /api/notes), shared by the
 *          server route and the browser answer client so both sides agree on the wire format.
 * Used by: apps/web/src/server/validate.ts, apps/web/src/server/prompt.ts,
 *          apps/web/app/api/answer/route.ts, apps/web/src/core/answer/answerClient.ts,
 *          apps/web/src/core/answer/warm.ts
 * Depends on: nothing (types only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (POST /api/answer)
 */

/**
 * What kind of answer the client is asking for.
 * - `hello`: Day 1 test reply that proves streaming and prompt caching work.
 * - `warm`: pre-warms the prompt cache for a session before the call starts (Day 3).
 * - `answer`: answers the latest question from the other side (Day 4).
 * - `chat`: answers a question the user typed (Day 4).
 * - `screenshot`: answers from a screenshot of the screen (Day 5).
 * `hello` and `warm` work (Day 3); the others return "not implemented yet: Day 4/5".
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

/** One finished line of the live transcript. */
export interface TranscriptLine {
  /** Who said it. */
  speaker: Speaker;
  /** What was said. Never logged. */
  text: string;
  /** When the line ended, as a Unix timestamp in seconds. */
  t: number;
}

/**
 * Body of POST /api/answer.
 * `{ mode: 'hello' }` needs nothing else; `warm` needs `session`; the other fields are used by
 * the later modes. All are checked by the server's zod schema (apps/web/src/server/validate.ts).
 */
export interface AnswerRequest {
  /** What kind of answer is wanted. */
  mode: AnswerMode;
  /** Model tier; the server defaults to `fast` when omitted. */
  model?: ModelTier;
  /** Session details (modes `warm`, `answer`, `chat`, `screenshot`). */
  session?: SessionContext;
  /** Recent transcript window (modes `answer`, `chat`, `screenshot`). */
  transcript?: TranscriptLine[];
  /** The question to answer: selected from the transcript or typed by the user. */
  question?: string;
  /** Screenshot as a base64 data URL (mode `screenshot` only), otherwise null or omitted. */
  image?: string | null;
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
 * - `internal`: any other server failure.
 */
export type AnswerErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_implemented'
  | 'upstream_error'
  | 'timeout'
  | 'refused'
  | 'internal';

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
