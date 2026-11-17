/**
 * File: apps/web/src/server/gemini.ts
 * Purpose: The ONLY place Kite talks to Google's Gemini API (ADR-0099: "Gemini 3.5 Flash Lite" and "Gemini 3.6
 *          Flash" as answer models). Streams a live answer through generateContent (server-sent events) from
 *          the same prompt the Claude answers use (locked contract, global prompt, user preferences, end
 *          reminder), turned into Gemini contents, screenshots included; and warms Gemini's implicit cache.
 * Used by: app/api/answer/route.ts (through withFirstTokenFallback() in server/providerStream.ts)
 * Depends on: the server's fetch, src/server/providerStream.ts, src/server/claude.ts (ReplyResult),
 *             @anthropic-ai/sdk (prompt types only)
 * Architecture: docs/decisions/ADR-0099-gemini-and-openai-answer-models.md; architecture §6, §7.2
 *
 * Plain fetch with the shared server-sent-events reader, so Gemini needs no extra dependency. Latency
 * settings: thinkingLevel 'minimal' (the lowest Gemini 3.x takes; thinkingBudget 0 is refused by Gemini 3.5
 * Flash Lite with a 400, checked 17 Nov 2026; both models report 0 thought tokens with 'minimal'), streaming
 * on. Caching: Gemini's implicit cache, which needs nothing but the stable prefix order the prompt already has
 * (system instruction first, then the conversation as it grows); explicit cached contents are not used (see
 * the ADR). Nothing here logs prompt or answer text; errors carry an HTTP status only.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerUsage } from '@kite/shared';
import type { ReplyResult } from './claude';
import { postJson, readSseJson } from './providerStream';

/** Gemini API's base address (v1beta: the thinking settings of Gemini 3.x). */
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The thinking setting for every live answer, voice question and warm-up: the lowest Gemini 3.x accepts. */
export const GEMINI_THINKING = { thinkingLevel: 'minimal' } as const;

/** One part of a Gemini message. */
export type GeminiPart =
  | {
      /** Text. Never logged. */
      text: string;
    }
  | {
      /** An image, inline. Never logged. */
      inlineData: {
        /** For example 'image/jpeg'. */
        mimeType: string;
        /** Base64 bytes. */
        data: string;
      };
    };

/** One Gemini message. */
export interface GeminiContent {
  /** 'user', or 'model' for an earlier reply. */
  role: 'user' | 'model';
  /** Its parts. */
  parts: GeminiPart[];
}

/** Gemini's system instruction: the system blocks as one text part. */
export interface GeminiSystemInstruction {
  /** One part. */
  parts: {
    /** The system blocks' text, joined. Never logged. */
    text: string;
  }[];
}

/** A prompt in Gemini's shape. */
export interface GeminiPrompt {
  /** The system blocks as one instruction, or undefined when there are none. */
  systemInstruction: GeminiSystemInstruction | undefined;
  /** The messages. */
  contents: GeminiContent[];
}

/**
 * A message's parts in Gemini's shape. Text only: the text blocks joined by a blank line, as one part (the
 * same text, in the same order, as Claude reads, so the prefix grows the same way and caches). With an image:
 * one part per block, in the same order. Cache markers are Claude-only and dropped; any other block is skipped.
 *
 * @param content A string or Claude content blocks.
 * @returns The parts.
 * Called from: toGeminiPrompt()
 */
function partsOf(content: string | readonly Anthropic.ContentBlockParam[]): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }];
  const hasImage = content.some((block) => block.type === 'image');
  if (!hasImage) {
    const text = content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter((piece) => piece !== '')
      .join('\n\n');
    return [{ text }];
  }
  const parts: GeminiPart[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text !== '') parts.push({ text: block.text });
    if (block.type === 'image' && block.source.type === 'base64') {
      parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
    }
  }
  return parts;
}

/**
 * Turns a prompt built for Claude (server/prompt.ts buildPrompt()) into Gemini's shape: the system blocks
 * become one system instruction in the same order (the locked contract first, then the global prompt, the
 * session, the user's preferences); each message keeps its turn ('assistant' is Gemini's 'model') and its
 * blocks, the screenshot included. So Gemini gets exactly the rules Claude gets, with the end reminder.
 *
 * @param system   The system prompt (a string or text blocks).
 * @param messages The messages.
 * @returns The system instruction and contents.
 * Called from: streamGeminiReply(), warmGemini(); tests
 */
export function toGeminiPrompt(
  system: string | readonly Anthropic.TextBlockParam[],
  messages: readonly Anthropic.MessageParam[],
): GeminiPrompt {
  const systemText =
    typeof system === 'string' ? system : system.map((block) => block.text).join('\n\n');
  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents: messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: partsOf(message.content),
    })),
  };
}

/** Input for streamGeminiReply() and warmGemini(). */
export interface GeminiReplyInput {
  /** Gemini API key (server-only). */
  apiKey: string;
  /** Gemini model id, for example 'gemini-3.5-flash-lite'. */
  model: string;
  /** The system prompt, as built for Claude. */
  system: string | readonly Anthropic.TextBlockParam[];
  /** The messages, as built for Claude (a screenshot as an image block). */
  messages: readonly Anthropic.MessageParam[];
  /** Most tokens the reply may have. */
  maxTokens: number;
  /** Aborts the request. */
  signal?: AbortSignal;
  /** Called once when Gemini's response headers arrive (the "stream open" timing). */
  onStreamOpen?: () => void;
  /** fetch (tests replace it). */
  fetchImpl?: typeof fetch;
}

/** Gemini's token counts. */
interface GeminiUsage {
  /** Input tokens, cached ones included. */
  promptTokenCount?: number;
  /** Output tokens (the answer). */
  candidatesTokenCount?: number;
  /** Thinking tokens (billed as output; 0 with minimal thinking). */
  thoughtsTokenCount?: number;
  /** Input tokens read from the cache. */
  cachedContentTokenCount?: number;
}

/** The parts of a streamed response Kite reads. */
interface GeminiChunk {
  /** The candidates (one). */
  candidates?: {
    /** The new part of the reply. */
    content?: {
      /** Its parts; a part marked `thought` is thinking and never shown. */
      parts?: { text?: string; thought?: boolean }[];
    };
    /** Why the reply ended, on the last chunk. */
    finishReason?: string;
  }[];
  /** Set when the prompt itself was blocked. */
  promptFeedback?: {
    /** Why. */
    blockReason?: string;
  };
  /** Usage (the last chunk has the totals). */
  usageMetadata?: GeminiUsage;
}

/**
 * Gemini's finish reason in Claude's words, so the route treats every provider alike (a safety stop is a
 * refusal).
 *
 * @param reason Gemini's finishReason, or 'BLOCKED' for a blocked prompt.
 * @returns The matching Claude stop reason, or null.
 * Called from: streamGeminiReply(), warmGemini(); tests
 */
export function geminiStopReason(reason: string | null | undefined): Anthropic.StopReason | null {
  if (reason === 'STOP') return 'end_turn';
  if (reason === 'MAX_TOKENS') return 'max_tokens';
  if (
    reason === 'SAFETY' ||
    reason === 'RECITATION' ||
    reason === 'BLOCKLIST' ||
    reason === 'PROHIBITED_CONTENT' ||
    reason === 'SPII' ||
    reason === 'BLOCKED'
  ) {
    return 'refusal';
  }
  return null;
}

/**
 * Gemini's usage in Kite's shape: input is the uncached part (as Claude reports it), cache reads are the
 * implicitly cached tokens, output includes any thinking tokens (they are billed as output).
 *
 * @param usage Gemini's usage, if any.
 * @returns The usage.
 * Called from: streamGeminiReply(), warmGemini()
 */
function toUsage(usage: GeminiUsage | undefined): AnswerUsage {
  const cached = usage?.cachedContentTokenCount ?? 0;
  return {
    input_tokens: Math.max(0, (usage?.promptTokenCount ?? 0) - cached),
    output_tokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  };
}

/**
 * The request body both calls share.
 *
 * @param input     See GeminiReplyInput.
 * @param maxTokens Most output tokens.
 * @returns The body.
 * Called from: streamGeminiReply(), warmGemini()
 */
function requestBody(input: GeminiReplyInput, maxTokens: number): Record<string, unknown> {
  const prompt = toGeminiPrompt(input.system, input.messages);
  return {
    ...(prompt.systemInstruction ? { systemInstruction: prompt.systemInstruction } : {}),
    contents: prompt.contents,
    generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: GEMINI_THINKING },
  };
}

/**
 * Streams a Gemini reply. Yields each piece of answer text as it arrives (never a thinking part); when the
 * reply is complete, returns the token usage and the stop reason. If the caller stops reading early, the
 * request is aborted.
 *
 * @param input See GeminiReplyInput.
 * @returns An async generator of text pieces that finishes with a ReplyResult.
 * @throws ProviderError for an HTTP error, a missing body or a broken stream; the abort reason on abort.
 * Called from: app/api/answer/route.ts (through withFirstTokenFallback())
 */
export async function* streamGeminiReply(
  input: GeminiReplyInput,
): AsyncGenerator<string, ReplyResult, undefined> {
  const local = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, local.signal]) : local.signal;
  let finished = false;
  try {
    const response = await postJson({
      fetchImpl: input.fetchImpl,
      url: `${GEMINI_API_URL}/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse`,
      headers: { 'x-goog-api-key': input.apiKey },
      body: requestBody(input, input.maxTokens),
      signal,
      provider: 'gemini',
    });
    input.onStreamOpen?.();
    let usage: GeminiUsage | undefined;
    let finish: string | null = null;
    for await (const event of readSseJson(response.body, 'gemini', response.status)) {
      const chunk = event as GeminiChunk;
      usage = chunk.usageMetadata ?? usage;
      if (chunk.promptFeedback?.blockReason) finish = 'BLOCKED';
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finish = candidate.finishReason;
      for (const part of candidate?.content?.parts ?? []) {
        // Thinking stays out of the answer (none is expected with minimal thinking).
        if (part.text && !part.thought) yield part.text;
      }
    }
    finished = true;
    return { usage: toUsage(usage), stopReason: geminiStopReason(finish) };
  } finally {
    // The consumer stopped early or an error escaped: stop Gemini writing (and billing) the reply.
    if (!finished) local.abort();
  }
}

/**
 * Warms Gemini's implicit cache for a call: the same prefix the answers send, with the warm-up placeholder,
 * asking for one token. Gemini caches a repeated prefix implicitly, so the call's first answer can read it.
 *
 * @param input See GeminiReplyInput (maxTokens is ignored: one token).
 * @returns The usage (cache reads when it was already warm) and the stop reason.
 * @throws ProviderError for an HTTP error; the abort reason on abort.
 * Called from: app/api/answer/route.ts (mode 'warm')
 */
export async function warmGemini(input: GeminiReplyInput): Promise<ReplyResult> {
  const response = await postJson({
    fetchImpl: input.fetchImpl,
    url: `${GEMINI_API_URL}/${encodeURIComponent(input.model)}:generateContent`,
    headers: { 'x-goog-api-key': input.apiKey },
    body: requestBody(input, 1),
    signal: input.signal ?? new AbortController().signal,
    provider: 'gemini',
  });
  const body = (await response.json()) as GeminiChunk;
  return {
    usage: toUsage(body.usageMetadata),
    stopReason: geminiStopReason(body.candidates?.[0]?.finishReason),
  };
}
