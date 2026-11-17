/**
 * File: apps/web/src/server/groq.ts
 * Purpose: The ONLY place Kite talks to Groq, the third answer model ("Fastest (Groq)", ADR-0095). Streams a
 *          live answer through Groq's OpenAI-compatible chat completions API, from the same prompt the
 *          Claude answers use (locked contract, global prompt, user preferences, end reminder), turned into
 *          OpenAI-style messages. withFirstTokenFallback() (when Groq fails, or sends no first token within
 *          GROQ_FIRST_TOKEN_MS, the same answer is asked of Claude Haiku) now lives in providerStream.ts
 *          (ADR-0099) and is re-exported here.
 * Used by: app/api/answer/route.ts
 * Depends on: the server's fetch, src/server/claude.ts (ReplyResult), @anthropic-ai/sdk (prompt types only),
 *             src/server/providerStream.ts (the stream reader and the fallback, shared with OpenAI and Gemini
 *             since ADR-0099)
 * Architecture: docs/decisions/ADR-0095-voice-mode-groq-and-move-keys.md; architecture §6, §7.2
 *
 * Plain fetch with a small server-sent-events reader, so Groq needs no extra dependency. Nothing here logs
 * prompt or answer text; errors carry an HTTP status only, never Groq's message or the key.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { ReplyResult } from './claude';
import {
  FIRST_TOKEN_MS,
  ProviderError,
  postJson,
  readSseJson,
  toStopReason,
  type ResponseBody,
} from './providerStream';

export { toStopReason, withFirstTokenFallback } from './providerStream';
export type { FallbackReason, FirstTokenFallbackOptions } from './providerStream';

/** Groq's OpenAI-compatible chat completions endpoint. */
export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * How long Groq has to send the first answer token before the answer is asked of Claude Haiku instead, in
 * ms (ADR-0095: the developer's 4 s).
 */
export const GROQ_FIRST_TOKEN_MS = FIRST_TOKEN_MS;

/** One OpenAI-style chat message (text only: answers with an image always go to Claude). */
export interface GroqMessage {
  /** Who wrote it. */
  role: 'system' | 'user' | 'assistant';
  /** Its text. Never logged. */
  content: string;
}

/**
 * A Groq failure, with the HTTP status when there was one. Groq's own error text is never kept: it may
 * echo the request.
 */
export class GroqError extends ProviderError {
  /**
   * @param code   A short code for logs: 'http', 'no_body', 'stream', 'empty'.
   * @param status Groq's HTTP status, when there was one.
   */
  constructor(code: string, status?: number) {
    super('groq', code, status);
    this.name = 'GroqError';
  }
}

/**
 * The text of a system prompt or message content in Claude's shape. Cache markers are Claude-only and
 * simply dropped. Image blocks never reach here (the answer route keeps image answers on Claude); any
 * other block is skipped rather than sent half-understood.
 *
 * @param content A string or Claude content blocks.
 * @returns The text, blocks joined by a blank line.
 * Called from: toGroqMessages()
 */
function textOf(content: string | readonly Anthropic.ContentBlockParam[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter((text) => text !== '')
    .join('\n\n');
}

/**
 * Turns a prompt built for Claude (server/prompt.ts buildPrompt()) into OpenAI-style messages: the system
 * blocks become one system message, in the same order (the locked contract first, then the global prompt,
 * the session, the user's preferences); each message keeps its role, its text blocks joined. So Groq gets
 * exactly the rules Claude gets, including the reminder at the end of the user turn.
 *
 * @param system   The system prompt (a string or text blocks).
 * @param messages The messages.
 * @returns The messages for Groq.
 * Called from: streamGroqReply(); tests
 */
export function toGroqMessages(
  system: string | readonly Anthropic.TextBlockParam[],
  messages: readonly Anthropic.MessageParam[],
): GroqMessage[] {
  const systemText =
    typeof system === 'string' ? system : system.map((block) => block.text).join('\n\n');
  return [
    ...(systemText ? [{ role: 'system' as const, content: systemText }] : []),
    ...messages.map((message) => ({ role: message.role, content: textOf(message.content) })),
  ];
}

/** Input for streamGroqReply(). */
export interface GroqReplyInput {
  /** Groq API key (server-only). */
  apiKey: string;
  /** Groq model id, for example 'openai/gpt-oss-120b'. */
  model: string;
  /** The system prompt, as built for Claude. */
  system: string | readonly Anthropic.TextBlockParam[];
  /** The messages, as built for Claude (text only). */
  messages: readonly Anthropic.MessageParam[];
  /** Most tokens the reply may have. */
  maxTokens: number;
  /** Aborts the request. */
  signal?: AbortSignal;
  /** Called once when Groq's response headers arrive (the "stream open" timing). */
  onStreamOpen?: () => void;
  /** fetch (tests replace it). */
  fetchImpl?: typeof fetch;
}

/** One choice in a streamed chunk. */
interface GroqChoice {
  /** The new part of the reply. */
  delta?: GroqDelta;
  /** Why the reply ended, on its last chunk. */
  finish_reason?: string | null;
}

/** The new part of a reply. */
interface GroqDelta {
  /** Answer text (never the reasoning: include_reasoning is false). */
  content?: string | null;
}

/** Groq's own extension on a chunk. */
interface GroqExtension {
  /** The usage, on the last chunk. */
  usage?: GroqUsage | null;
}

/** The parts of a streamed chat completion chunk Kite reads. */
interface GroqChunk {
  /** The chunk's choices (one). */
  choices?: GroqChoice[];
  /** Usage, on the last chunk when stream_options.include_usage is set. */
  usage?: GroqUsage | null;
  /** Groq's own extension, which also carries the usage on the last chunk. */
  x_groq?: GroqExtension | null;
}

/** Cached-token details in OpenAI's shape. */
interface GroqTokenDetails {
  /** Cached input tokens. */
  cached_tokens?: number;
}

/** Token counts in OpenAI's shape. */
interface GroqUsage {
  /** Input tokens. */
  prompt_tokens?: number;
  /** Output tokens (reasoning included). */
  completion_tokens?: number;
  /** Cached input tokens, when Groq reports them. */
  prompt_tokens_details?: GroqTokenDetails | null;
}

/**
 * Streams a Groq reply. Yields each piece of answer text as it arrives; when the reply is complete,
 * returns the token usage (cache reads from Groq's cached tokens; Groq has no cache writes) and the stop
 * reason. Reasoning is set to low and left out of the reply (gpt-oss), so the first token comes quickly
 * and no thinking text can reach the answer. If the caller stops reading early, the request is aborted.
 *
 * @param input See GroqReplyInput.
 * @returns An async generator of text pieces that finishes with a ReplyResult.
 * @throws GroqError for an HTTP error, a missing body or a broken stream; the abort reason on abort.
 * Called from: app/api/answer/route.ts (through withFirstTokenFallback())
 */
export async function* streamGroqReply(
  input: GroqReplyInput,
): AsyncGenerator<string, ReplyResult, undefined> {
  const local = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, local.signal]) : local.signal;
  let finished = false;
  try {
    let response: Response & { body: ResponseBody };
    try {
      response = await postJson({
        fetchImpl: input.fetchImpl,
        url: GROQ_CHAT_URL,
        headers: { authorization: `Bearer ${input.apiKey}` },
        body: {
          model: input.model,
          messages: toGroqMessages(input.system, input.messages),
          max_completion_tokens: input.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          // gpt-oss on Groq: 'low' keeps the time to the first word short; false keeps the reasoning out of
          // the reply (Groq's docs: reasoning_format is not supported for gpt-oss).
          reasoning_effort: 'low',
          include_reasoning: false,
        },
        signal,
        provider: 'groq',
      });
    } catch (error) {
      throw asGroqError(error);
    }
    input.onStreamOpen?.();

    let usage: GroqUsage | null = null;
    let finish: string | null = null;
    try {
      for await (const event of readSseJson(response.body, 'groq', response.status)) {
        const chunk = event as GroqChunk;
        usage = chunk.usage ?? chunk.x_groq?.usage ?? usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const text = choice?.delta?.content;
        if (text) yield text;
      }
    } catch (error) {
      throw asGroqError(error);
    }
    finished = true;
    return {
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      stopReason: toStopReason(finish),
    };
  } finally {
    // The consumer stopped early or an error escaped: stop Groq writing (and billing) the reply.
    if (!finished) local.abort();
  }
}

/**
 * Keeps a Groq failure a GroqError (the name the logs and tests know); anything else (an abort) as it is.
 *
 * @param error What was thrown.
 * @returns The error to throw.
 * Called from: streamGroqReply()
 */
function asGroqError(error: unknown): unknown {
  if (error instanceof ProviderError && !(error instanceof GroqError)) {
    return new GroqError(error.message, error.status);
  }
  return error;
}
