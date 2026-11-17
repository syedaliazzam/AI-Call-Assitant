/**
 * File: packages/shared/src/api.ts
 * Purpose: Request and response types for POST /api/answer, /api/notes, /api/job-import and
 *          GET /api/models, shared by the
 *          server route and the browser answer client so both sides agree on the wire format.
 * Used by: apps/web/src/server/validate.ts, apps/web/src/server/prompt.ts,
 *          apps/web/app/api/answer/route.ts, apps/web/src/core/answer/answerClient.ts,
 *          apps/web/src/core/answer/warm.ts
 * Depends on: ./answer-meta.ts (types); otherwise nothing (types, limits and one pure helper; no
 *             Node or browser APIs)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (POST /api/answer)
 */
import type { AnswerMeta, AnswerTarget, AnswerType, MissingInfoMode } from './answer-meta';

/**
 * What kind of answer the client is asking for.
 * - `hello`: Day 1 test reply that proves streaming and prompt caching work.
 * - `warm`: pre-warms the prompt cache for a session before the call starts (Day 3).
 * - `answer`: answers the latest question from the other side (Day 4).
 * - `chat`: answers a question the user typed (Day 4).
 * - `screenshot`: answers from a screenshot of the screen (Day 5).
 * - `kite`: the Ask Kite page, outside any call (ADR-0030).
 * All modes work: `hello`, `warm` (Day 3), `answer` and `chat` (Day 4), `screenshot` (Day 5).
 */
export type AnswerMode = 'hello' | 'warm' | 'answer' | 'chat' | 'screenshot' | 'kite';

/**
 * Which Claude model tier to use. The real model names come from server environment variables
 * (KITE_MODEL_FAST, KITE_MODEL_SMART), so the client never names a model directly.
 * - `fast`: live answers (Haiku).
 * - `smart`: slower, higher-quality output such as notes (Sonnet).
 */
export type ModelTier = 'fast' | 'smart';

/**
 * ADR-0095: the model a session's live answers use, as the person chooses it.
 * - `fast`: "Fast (Claude Haiku)", the default.
 * - `smart`: "Smart (Claude Sonnet)".
 * - `groq`: "Fastest (Groq)": Groq's model (GROQ_MODEL on the server). Answers with an image always use
 *   Claude, and an answer Groq cannot start within 4 s is asked of Claude Haiku instead.
 * ADR-0099 adds four models from two more providers, offered only to the accounts in the rollout
 * (KITE_ANSWER_MODELS_USERS) while they are measured:
 * - `gemini-lite`: Google's Gemini 3.5 Flash Lite (KITE_MODEL_GEMINI_LITE on the server).
 * - `gpt-luna`: OpenAI's GPT-5.6 Luna (KITE_MODEL_OPENAI_FAST).
 * - `gemini-flash`: Google's Gemini 3.6 Flash (KITE_MODEL_GEMINI_FLASH).
 * - `gpt-terra`: OpenAI's GPT-5.6 Terra (KITE_MODEL_OPENAI_SMART).
 * These four answer screenshots too; an answer one of them cannot start within 4 s is asked of Claude Haiku.
 * Ask AI and the call notes keep their own Claude models (ModelTier).
 */
export type AnswerModel =
  ModelTier | 'groq' | 'gemini-lite' | 'gpt-luna' | 'gemini-flash' | 'gpt-terra';

/**
 * ADR-0095: every answer model. ADR-0099: in the order the rollout's model list shows them (the classic list
 * shows only 'fast', 'smart' and 'groq', in that order).
 */
export const ANSWER_MODELS: readonly AnswerModel[] = [
  'gemini-lite',
  'gpt-luna',
  'gemini-flash',
  'gpt-terra',
  'fast',
  'smart',
  'groq',
];

/**
 * ADR-0099: who serves an answer model. 'claude' is Anthropic (Haiku and Sonnet); the other three are the
 * third-party providers, each with its own admin switch and usage count.
 */
export type AnswerProvider = 'claude' | 'groq' | 'gemini' | 'openai';

/**
 * ADR-0099: the provider that serves a model.
 *
 * @param model The answer model.
 * @returns Its provider.
 * Called from: apps/web/app/api/answer/route.ts, apps/web/src/server/modelAccess.ts,
 *              apps/web/src/core/session/modelChoices.ts; tests
 */
export function providerOf(model: AnswerModel): AnswerProvider {
  if (model === 'groq') return 'groq';
  if (model === 'gemini-lite' || model === 'gemini-flash') return 'gemini';
  if (model === 'gpt-luna' || model === 'gpt-terra') return 'openai';
  return 'claude';
}

/**
 * ADR-0099: whether a value is a known answer model (a stored or received value may come from a newer or
 * older app).
 *
 * @param value Anything.
 * @returns True for one of ANSWER_MODELS.
 * Called from: apps/web/src/core/answer/answerClient.ts, apps/web/src/core/live/liveChannel.ts; tests
 */
export function isAnswerModel(value: unknown): value is AnswerModel {
  return typeof value === 'string' && (ANSWER_MODELS as readonly string[]).includes(value);
}

/**
 * ADR-0099: the most characters of the call id an answer request may carry (a UUID is 36). It is used only as
 * OpenAI's prompt_cache_key.
 */
export const MAX_CALL_ID_CHARS = 64;

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
  /**
   * v1.2.0: behavioural answers use Situation, Task, Action and Result bullets. Absent means off, and
   * then the prompt is exactly what it was.
   */
  star?: boolean;
}

/** Response of GET /api/models. */
export interface ModelAccessResponse {
  /** True when sessions may choose the deeper model (an admin can turn it off). */
  deepModel: boolean;
  /**
   * ADR-0095: true when sessions may choose Groq (the server has a Groq key and an admin has not turned it
   * off). Absent from an older server: treat as false.
   */
  groq?: boolean;
  /**
   * ADR-0099: true when this account is in the new-models rollout (KITE_ANSWER_MODELS_USERS): the model list
   * then shows the Gemini and GPT models too, in the rollout's order and words. Absent or false: the classic
   * list (Fast, Smart, Fastest).
   */
  moreModels?: boolean;
  /**
   * ADR-0099: true when this account may choose the Gemini models (in the rollout, the server has a Gemini
   * key, and an admin has not turned Gemini off).
   */
  gemini?: boolean;
  /** ADR-0099: the same for the OpenAI (GPT) models. */
  openai?: boolean;
}

/** What the user is told when a job link cannot be read, whatever the reason (spec §6). */
export const JOB_LINK_FAILED = 'Couldn’t read that page. Paste the description instead.';

/** A document the user attached to a session, already converted to plain text in the browser. */
export interface SessionDocument {
  /** Original file name, shown to Claude so it can cite the source (for example 'pricing.pdf'). */
  name: string;
  /** Extracted plain text of the document. Never logged. */
  text: string;
  /**
   * 'resume' for the session's CV (ADR-0067). The CV is sent first and, to the smart model, in
   * full; other documents are absent here. Never written into the prompt, so it changes no cache.
   */
  kind?: 'resume';
}

/** Most characters of document text one session may send (ADR-0067: 500k, about 200k tokens). */
export const MAX_SESSION_DOCUMENT_CHARS = 500_000;

/** Most characters of the documents summary the smart-model routes accept (ADR-0067). */
export const MAX_DOCUMENTS_SUMMARY_CHARS = 20_000;

/**
 * Batch C (P2-1): one part of a session document that matches the question, sent in the uncached tail of a
 * live answer (the documents themselves are summarised in the cached prefix).
 */
export interface DocumentChunk {
  /** The document's name. */
  name: string;
  /** The part's text. Never logged. */
  text: string;
}

/** Batch C (P2-1): most document parts sent with one question. */
export const MAX_DOCUMENT_CHUNKS = 5;

/** Batch C (P2-1): most characters in one document part. */
export const MAX_DOCUMENT_CHUNK_CHARS = 1_600;

/**
 * Batch C (P2-1): the most input tokens one live answer request may hold, whatever the documents' size. The
 * server keeps every answer under it (server/budget.ts), counting conservatively (3 characters a token).
 */
export const MAX_ANSWER_INPUT_TOKENS = 100_000;

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
  /**
   * The language to answer in, by name (for example 'Spanish'). Absent means English, so an
   * English session's prompt, and its cache entry, stay exactly as they were (parity Phase 2).
   */
  language?: string;
  /**
   * The language for code in answers (Settings → Answers). Absent means Python, so a session on
   * the default sends nothing extra and its cache entry stays the same (ADR-0030).
   */
  codingLanguage?: string;
  /**
   * What to do when the documents have no real example. Absent means 'approach' (specific methods
   * and steps, nothing invented); only 'story' is ever sent (ADR-0030).
   */
  missingInfo?: MissingInfoMode;
  /**
   * Attached documents, the CV first (total capped at MAX_SESSION_DOCUMENT_CHARS by the server).
   * For the smart-model routes (notes, Ask AI, Prepare) only the CV is sent here (ADR-0067).
   */
  documents: SessionDocument[];
  /**
   * Smart-model routes only (ADR-0067): a short summary of the session's documents other than the CV,
   * written once per session by the fast model (POST /api/summary) and kept on the device. When it
   * is present ('' = no other documents, or no summary could be written) the server writes it in
   * place of those documents. Absent: an older page, whose documents are written in full.
   */
  documentsSummary?: string;
  /**
   * ADR-0093: the other person's real name for this call (cleanPersonName(), at most 60 characters):
   * their transcript lines are labelled with it instead of "Them". Absent when no name is known (the
   * "Interviewer" fallback is display only), so such a prompt, and its cache entry, stay as they were.
   */
  themName?: string;
}

/** POST /api/summary: summarise a session's documents other than the CV (ADR-0067). */
export interface DocumentsSummaryRequest {
  /** The documents to summarise (never the CV), in the session's order. */
  documents: SessionDocument[];
}

/** The reply of POST /api/summary. */
export interface DocumentsSummaryResponse {
  /** The summary text (at most MAX_DOCUMENTS_SUMMARY_CHARS). Never logged. */
  summary: string;
  /** Token usage of the request. */
  usage: AnswerUsage;
  /** Server time for the request, in ms. */
  ms: number;
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
  /** 'kite' when this was a private answer to the user; absent for words said on the call. */
  target?: AnswerTarget;
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

/**
 * Longest earlier answer in the conversation, in characters. A coding answer or a private Ask Kite
 * answer can reach the answer limit of 1,500 tokens, about 6,000 characters.
 */
export const MAX_ANSWER_CHARS = 6_000;

/** Most turns of an Ask Kite chat sent with one request (older turns stay on the device only). */
export const MAX_KITE_HISTORY = 40;

/** Longest single turn of an Ask Kite chat, in characters. */
export const MAX_KITE_TURN_CHARS = 16_000;

/** Longest question typed on the Ask Kite page, in characters. */
export const MAX_KITE_QUESTION_CHARS = 8_000;

/** Most files or session contexts attached to one Ask Kite chat. */
export const MAX_KITE_ATTACHMENTS = 10;

/** Most screenshots pasted into one Ask Kite message. */
export const MAX_KITE_IMAGES = 3;

/** One earlier turn of an Ask Kite chat. */
export interface KiteTurn {
  /** Who wrote it. */
  role: 'you' | 'kite';
  /** What was written. Never logged. */
  text: string;
}

/**
 * The versions of Kite's answer rules (ADR-0032): 'current' is "v-current", and 'previous' is
 * "v-previous", kept word for word so an admin can roll back if the new answers do worse on real
 * calls.
 */
export const ANSWER_STYLE_VERSIONS = ['current', 'previous'] as const;

/** One version of Kite's answer rules. */
export type AnswerStyleVersion = (typeof ANSWER_STYLE_VERSIONS)[number];

/** An earlier answer in this call to a question like the current one (core/answer/similar.ts). */
export interface SimilarAnswer {
  /** The earlier question. Never logged. */
  question: string;
  /** The earlier answer. Never logged. */
  text: string;
  /** When it was asked, in whole seconds since the call connected. */
  at: number;
}

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
  /**
   * The answer model; the server defaults to `fast` when omitted. `groq` (ADR-0095) applies to `answer`
   * and `chat` only: warm-ups and screenshots go to Claude Haiku, and `kite` (Ask AI) keeps its Claude model.
   * ADR-0099: the Gemini and GPT models apply to `answer`, `chat`, `screenshot` and `warm` (which warms both
   * that model and Claude Haiku, its fallback); `kite` keeps its Claude model.
   */
  model?: AnswerModel;
  /**
   * ADR-0099: the call's record id (live page only), at most MAX_CALL_ID_CHARS of letters, digits, '-' and
   * '_'. Sent to OpenAI as prompt_cache_key, so a call's requests reach the same cache; nothing else reads it.
   */
  callId?: string;
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
  /**
   * Who the answer is for, when the user chose (the switch next to the chat box). Absent: Claude
   * decides. Goes in the uncached tail, so changing it costs no cache.
   */
  target?: AnswerTarget;
  /** The question type the user chose from the answer card's menu (a re-answer). Uncached. */
  answerType?: AnswerType;
  /** An earlier answer to a similar question, to reuse its facts and wording. Uncached. */
  similar?: SimilarAnswer;
  /**
   * Batch C (P2-1): the parts of the session's documents that match this question best (at most
   * MAX_DOCUMENT_CHUNKS). Uncached. Absent: none matched, or an older page (whose documents are in full).
   */
  documentChunks?: DocumentChunk[];
  /**
   * Which version of the answer rules to use (ADR-0032). Absent means 'current'. It decides the
   * cached rules block, so the warm-up and every answer of a call must send the same value. The
   * server honours 'previous' only for an admin.
   */
  styleVersion?: AnswerStyleVersion;
  /**
   * The live-answers company instructions version this call started with (ADR-0083): a version id,
   * or 'none' when the block was empty then. It decides the cached rules block, so the warm-up and
   * every answer of a call send the same value. Absent: the version in force now.
   */
  instructionsVersion?: string;
  /** Mode `kite` only: the language for code, when it is not Python. */
  codingLanguage?: string;
  /** Mode `kite` only: the chat so far, oldest first. */
  history?: KiteTurn[];
  /** Mode `kite` only: library items and past sessions attached to the chat. */
  attachments?: SessionDocument[];
  /** Mode `kite` only: screenshots pasted into this message, as JPEG data URLs. Never stored. */
  images?: string[];
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
 * - `daily_limit`: this user has used today's Claude requests (v1.0.2, ADR-0036); HTTP 429, with
 *   dailyLimitMessage() shown as it is. Nothing was sent to Claude.
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
  | 'daily_limit'
  | 'internal';

/**
 * The friendly message sent with `daily_limit` (ADR-0036), shown as it is wherever answers,
 * notes or Ask Kite replies appear.
 *
 * @param limit The daily limit that was reached.
 * @returns For example "You've reached today's limit of 300 answers. It resets at midnight UTC;
 *          an admin can raise it."
 * Called from: apps/web/src/server/usage.ts (limitError()); tests
 */
export function dailyLimitMessage(limit: number): string {
  return `You've reached today's limit of ${limit} answers. It resets at midnight UTC; an admin can raise it.`;
}

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
 * - `meta`: the answer's type, target and source, sent once before its first word.
 * - `delta`: the next piece of answer text.
 * - `done`: the reply finished; carries token usage and server timings.
 * - `error`: the reply failed; no more events follow.
 */
export type AnswerEvent =
  | {
      /** Event name. */
      type: 'meta';
      /** What Claude said about the answer (the hidden first line, removed from the text). */
      meta: AnswerMeta;
    }
  | {
      /** Event name. */
      type: 'delta';
      /** Next piece of answer text, to append to what was already shown. */
      text: string;
    }
  | {
      /** Event name. */
      type: 'question';
      /**
       * The question the answer is for, cleaned up by Claude (the hidden last line, removed from
       * the text; v1.0.2, ADR-0037). Arrives after the answer's words, before `done`; absent when
       * Claude did not write it (for example the v-previous rules).
       */
      question: string;
    }
  | {
      /** Event name. */
      type: 'done';
      /** Token counts for the whole reply. */
      usage: AnswerUsage;
      /** Server-side timings. */
      ms: AnswerTimings;
      /**
       * ADR-0094: the tier that really answered. It differs from the one asked for when an admin has
       * turned the deeper model off (the server then answers with the fast one). Absent from an older
       * server. ADR-0095: 'groq' when Groq answered; 'fast' when a Groq answer moved to Claude Haiku
       * (then `fallback` says so) or had an image. ADR-0099: the Gemini or GPT model when it answered;
       * 'fast' when its answer moved to Claude Haiku (then `fallback` says so).
       */
      model?: AnswerModel;
      /**
       * ADR-0095: present when Groq was asked and Claude Haiku answered instead: 'timeout' (no first token
       * within 4 s), 'error' or 'empty'. Absent otherwise. ADR-0099: the same for a Gemini or GPT model.
       */
      fallback?: 'timeout' | 'error' | 'empty';
    }
  | {
      /** Event name. */
      type: 'error';
      /** Machine-readable reason. */
      code: AnswerErrorCode;
      /** Short human-readable explanation (never contains transcript or document text). */
      message: string;
    };

/** Longest company name kept from a job page (the wizard's limit). */
export const MAX_JOB_COMPANY_CHARS = 200;

/** Longest job title kept from a job page (the wizard's limit). */
export const MAX_JOB_ROLE_CHARS = 200;

/** Longest job description kept from a job page (the wizard's limit). */
export const MAX_JOB_DESCRIPTION_CHARS = 5_000;

/** Longest address accepted by POST /api/job-import. */
export const MAX_JOB_URL_CHARS = 2_000;

/** Body of POST /api/job-import. */
export interface JobImportRequest {
  /** The address of a public job page. Never logged. */
  url: string;
}

/** What was found on a job page ('' where the page did not say). Never logged. */
export interface JobImportFields {
  /** The hiring company. */
  company: string;
  /** The job title. */
  role: string;
  /** The posting's description of the job. */
  description: string;
}

/** Response of POST /api/job-import. */
export interface JobImportResponse {
  /** What was found. */
  fields: JobImportFields;
  /** The site the page came from, after any redirects. */
  host: string;
}

/**
 * Response of POST /api/stt/token (ADR-0076): a short-lived Deepgram token for one call's two speech
 * sockets, and where and with which models to open them. The server's Deepgram key is never in it.
 */
export interface SttTokenResponse {
  /** A Deepgram token valid for `expiresIn` seconds; only needed for the WebSocket handshake. Never logged. */
  token: string;
  /** Seconds until the token expires (60). */
  expiresIn: number;
  /** The Deepgram host the sockets connect to (the one that minted the token), e.g. 'api.eu.deepgram.com'. */
  host: string;
  /** The model per channel: "them" (the other side) and "you" (the microphone). */
  models: {
    /** Model for the other side, for example 'flux-general-en'. */
    them: string;
    /** Model for the microphone, for example 'nova-3'. */
    you: string;
  };
}

/** Why POST /api/stt/token refused (ADR-0076). */
export type SttTokenErrorCode =
  'unauthorized' | 'not_enabled' | 'rate_limited' | 'not_configured' | 'upstream_error';
