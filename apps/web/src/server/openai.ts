/**
 * File: apps/web/src/server/openai.ts
 * Purpose: The ONLY place Kite talks to OpenAI (ADR-0099: "GPT-5.6 Luna" and "GPT-5.6 Terra" as answer
 *          models). Streams a live answer through OpenAI's Chat Completions API from the same prompt the Claude
 *          answers use (locked contract, global prompt, user preferences, end reminder), turned into
 *          OpenAI messages, screenshots included; and warms OpenAI's prompt cache for a call.
 * Used by: app/api/answer/route.ts (through withFirstTokenFallback() in server/providerStream.ts)
 * Depends on: the server's fetch, src/server/providerStream.ts, src/server/claude.ts (ReplyResult),
 *             @anthropic-ai/sdk (prompt types only)
 * Architecture: docs/decisions/ADR-0099-gemini-and-openai-answer-models.md; architecture §6, §7.2
 *
 * Plain fetch with the shared server-sent-events reader, so OpenAI needs no extra dependency (as Groq,
 * ADR-0095). Latency settings: reasoning_effort 'none' (the lowest these models take; 'minimal' is refused
 * with a 400, checked 17 Nov 2026), streaming on, and prompt_cache_key set to the call's id so a call's
 * requests reach the same prompt cache. `store: false` keeps the requests out of OpenAI's stored
 * completions. Nothing here logs prompt or answer text; errors carry an HTTP status only.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerUsage } from '@kite/shared';
import type { ReplyResult } from './claude';
import { postJson, readSseJson, toStopReason } from './providerStream';

/** OpenAI's Chat Completions endpoint. */
export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * The reasoning setting for every live answer, voice question and warm-up: none. GPT-5.6 Luna and Terra accept
 * 'none', 'low', 'medium', 'high' and 'xhigh' (17 Nov 2026); 'none' gives the quickest first word.
 */
export const OPENAI_REASONING_EFFORT = 'none';

/** One part of an OpenAI user message. */
export type OpenAIContentPart =
  | {
      /** A text part. */
      type: 'text';
      /** Its text. Never logged. */
      text: string;
    }
  | {
      /** An image part. */
      type: 'image_url';
      /** The image, as a data URL. Never logged. */
      image_url: {
        /** `data:image/jpeg;base64,…`. */
        url: string;
      };
    };

/** One OpenAI chat message. */
export interface OpenAIMessage {
  /** Who wrote it. */
  role: 'system' | 'user' | 'assistant';
  /** Its text, or parts when it carries an image. Never logged. */
  content: string | OpenAIContentPart[];
}

/**
 * A message's content in OpenAI's shape. Text only: the text blocks joined by a blank line (the same text, in
 * the same order, as Claude reads, so the prefix grows the same way and caches). With an image: parts in the
 * same order, the image as a data URL. Cache markers are Claude-only and dropped; any other block is skipped.
 *
 * @param content A string or Claude content blocks.
 * @returns A string, or parts when there is an image.
 * Called from: toOpenAIMessages()
 */
function contentOf(
  content: string | readonly Anthropic.ContentBlockParam[],
): string | OpenAIContentPart[] {
  if (typeof content === 'string') return content;
  const hasImage = content.some((block) => block.type === 'image');
  if (!hasImage) {
    return content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter((text) => text !== '')
      .join('\n\n');
  }
  const parts: OpenAIContentPart[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text !== '') parts.push({ type: 'text', text: block.text });
    if (block.type === 'image' && block.source.type === 'base64') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
      });
    }
  }
  return parts;
}

/**
 * Turns a prompt built for Claude (server/prompt.ts buildPrompt()) into OpenAI messages: the system blocks
 * become one system message in the same order (the locked contract first, then the global prompt, the
 * session, the user's preferences); each message keeps its role and its blocks, the screenshot included. So
 * OpenAI gets exactly the rules Claude gets, including the reminder at the end of the user turn.
 *
 * @param system   The system prompt (a string or text blocks).
 * @param messages The messages.
 * @returns The messages for OpenAI.
 * Called from: streamOpenAIReply(), warmOpenAI(); tests
 */
export function toOpenAIMessages(
  system: string | readonly Anthropic.TextBlockParam[],
  messages: readonly Anthropic.MessageParam[],
): OpenAIMessage[] {
  const systemText =
    typeof system === 'string' ? system : system.map((block) => block.text).join('\n\n');
  return [
    ...(systemText ? [{ role: 'system' as const, content: systemText }] : []),
    ...messages.map((message) => ({ role: message.role, content: contentOf(message.content) })),
  ];
}

/** Input for streamOpenAIReply() and warmOpenAI(). */
export interface OpenAIReplyInput {
  /** OpenAI API key (server-only). */
  apiKey: string;
  /** OpenAI model id, for example 'gpt-5.6-luna'. */
  model: string;
  /** The system prompt, as built for Claude. */
  system: string | readonly Anthropic.TextBlockParam[];
  /** The messages, as built for Claude (a screenshot as an image block). */
  messages: readonly Anthropic.MessageParam[];
  /** Most tokens the reply may have. */
  maxTokens: number;
  /** The call's id, sent as prompt_cache_key (absent outside a call). */
  cacheKey?: string | undefined;
  /**
   * ADR-0099 measurement only: 'priority' for OpenAI's priority processing (an admin's /dev/latency run);
   * absent: OpenAI's default tier, as every call uses.
   */
  serviceTier?: 'priority' | undefined;
  /** Aborts the request. */
  signal?: AbortSignal;
  /** Called once when OpenAI's response headers arrive (the "stream open" timing). */
  onStreamOpen?: () => void;
  /** fetch (tests replace it). */
  fetchImpl?: typeof fetch;
}

/** Cached-token details in OpenAI's usage. */
interface OpenAITokenDetails {
  /** Input tokens read from the prompt cache. */
  cached_tokens?: number;
}

/** OpenAI's token counts. */
interface OpenAIUsage {
  /** Input tokens, cached ones included. */
  prompt_tokens?: number;
  /** Output tokens. */
  completion_tokens?: number;
  /** Cached input tokens. */
  prompt_tokens_details?: OpenAITokenDetails | null;
}

/** The parts of a streamed chunk Kite reads. */
interface OpenAIChunk {
  /** The chunk's choices (one). */
  choices?: {
    /** The new part of the reply. */
    delta?: {
      /** Answer text. */
      content?: string | null;
    };
    /** Why the reply ended, on its last choice chunk. */
    finish_reason?: string | null;
  }[];
  /** Usage, on the last chunk (stream_options.include_usage). */
  usage?: OpenAIUsage | null;
}

/**
 * OpenAI's usage in Kite's shape: input is the uncached part (as Claude reports it), cache reads are the
 * cached tokens; OpenAI has no separate cache writes.
 *
 * @param usage OpenAI's usage, if any.
 * @returns The usage.
 * Called from: streamOpenAIReply(), warmOpenAI()
 */
function toUsage(usage: OpenAIUsage | null | undefined): AnswerUsage {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
    output_tokens: usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  };
}

/**
 * The request body both calls share: model, messages, the reasoning setting and the cache key.
 *
 * @param input     See OpenAIReplyInput.
 * @param maxTokens Most output tokens.
 * @returns The body (without the streaming fields).
 * Called from: streamOpenAIReply(), warmOpenAI()
 */
function requestBody(input: OpenAIReplyInput, maxTokens: number): Record<string, unknown> {
  return {
    model: input.model,
    messages: toOpenAIMessages(input.system, input.messages),
    max_completion_tokens: maxTokens,
    reasoning_effort: OPENAI_REASONING_EFFORT,
    // Not kept in OpenAI's stored completions (call content stays out of the dashboard).
    store: false,
    ...(input.cacheKey ? { prompt_cache_key: input.cacheKey } : {}),
    ...(input.serviceTier ? { service_tier: input.serviceTier } : {}),
  };
}

/**
 * Streams an OpenAI reply. Yields each piece of answer text as it arrives; when the reply is complete,
 * returns the token usage and the stop reason. If the caller stops reading early, the request is aborted.
 *
 * @param input See OpenAIReplyInput.
 * @returns An async generator of text pieces that finishes with a ReplyResult.
 * @throws ProviderError for an HTTP error, a missing body or a broken stream; the abort reason on abort.
 * Called from: app/api/answer/route.ts (through withFirstTokenFallback())
 */
export async function* streamOpenAIReply(
  input: OpenAIReplyInput,
): AsyncGenerator<string, ReplyResult, undefined> {
  const local = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, local.signal]) : local.signal;
  let finished = false;
  try {
    const response = await postJson({
      fetchImpl: input.fetchImpl,
      url: OPENAI_CHAT_URL,
      headers: { authorization: `Bearer ${input.apiKey}` },
      body: {
        ...requestBody(input, input.maxTokens),
        stream: true,
        stream_options: { include_usage: true },
      },
      signal,
      provider: 'openai',
    });
    input.onStreamOpen?.();
    let usage: OpenAIUsage | null = null;
    let finish: string | null = null;
    for await (const event of readSseJson(response.body, 'openai', response.status)) {
      const chunk = event as OpenAIChunk;
      usage = chunk.usage ?? usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finish = choice.finish_reason;
      const text = choice?.delta?.content;
      if (text) yield text;
    }
    finished = true;
    return { usage: toUsage(usage), stopReason: toStopReason(finish) };
  } finally {
    // The consumer stopped early or an error escaped: stop OpenAI writing (and billing) the reply.
    if (!finished) local.abort();
  }
}

/**
 * Warms OpenAI's prompt cache for a call: the same prefix the answers send, with the warm-up placeholder,
 * asking for one token (OpenAI caches a prompt prefix of 1,024 tokens or more automatically, and the
 * prompt_cache_key sends the call's later requests to the same cache).
 *
 * @param input See OpenAIReplyInput (maxTokens is ignored: one token).
 * @returns The usage (cache reads when it was already warm) and the stop reason.
 * @throws ProviderError for an HTTP error; the abort reason on abort.
 * Called from: app/api/answer/route.ts (mode 'warm')
 */
export async function warmOpenAI(input: OpenAIReplyInput): Promise<ReplyResult> {
  const response = await postJson({
    fetchImpl: input.fetchImpl,
    url: OPENAI_CHAT_URL,
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: requestBody(input, 1),
    signal: input.signal ?? new AbortController().signal,
    provider: 'openai',
  });
  const body = (await response.json()) as {
    /** Usage. */
    usage?: OpenAIUsage;
    /** The one choice. */
    choices?: { finish_reason?: string | null }[];
  };
  return { usage: toUsage(body.usage), stopReason: toStopReason(body.choices?.[0]?.finish_reason) };
}
