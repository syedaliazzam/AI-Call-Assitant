/**
 * File: apps/web/src/server/ask.ts
 * Purpose: Ask AI: answers a question about a finished call with the smart model, from its
 *          transcript, Kite's answers, the AI notes and the session's documents. The rules, the
 *          session and the call are three cached blocks, so later questions about the same call
 *          read them from the cache.
 * Used by: app/api/ask/route.ts
 * Depends on: src/server/claude.ts (jsonReply, cachedBlock), src/server/prompt.ts (smartSessionBlock),
 *             src/server/notes.ts (callRecord), src/server/prompts/contract.ts (the review contract,
 *             ADR-0089), src/server/prompts/defaults.ts (the default Ask AI prompt), @kite/shared (types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/ask); ADR-0029
 *
 * Nothing here logs the question, the reply or the call.
 */
import 'server-only';
import type { AnswerUsage, AskRequest } from '@kite/shared';
import { cachedBlock, jsonReply } from './claude';
import { callRecord } from './notes';
import { smartSessionBlock } from './prompt';
import { ASK_REVIEW_CONTRACT, withGlobalPrompt } from './prompts/contract';
import { DEFAULT_ASK_PROMPT } from './prompts/defaults';

/** Most tokens a reply may write: replies are short by design. */
const ASK_MAX_TOKENS = 800;

/**
 * The rough cost of one request, for development logs. Sonnet 5.5's list prices per million tokens
 * when written: 2 dollars input, 10 output, cache reads 0.20, cache writes 1.25 times input.
 *
 * @param usage The request's token counts.
 * @returns Dollars.
 * Called from: app/api/ask/route.ts; tests
 */
export function estimatedCost(usage: AnswerUsage): number {
  const dollars =
    usage.input_tokens * 2 +
    usage.output_tokens * 10 +
    usage.cache_creation_input_tokens * 2.5 +
    usage.cache_read_input_tokens * 0.2;
  return dollars / 1_000_000;
}

/**
 * Answers a question about a call.
 *
 * @param request      A validated request.
 * @param model        The smart model's name.
 * @param globalPrompt The admin's global prompt for Ask AI in force (ADR-0089), after the locked contract.
 * @returns The reply and the token usage.
 * @throws What jsonReply() throws.
 * Called from: app/api/ask/route.ts; tests
 */
export async function answerAboutCall(
  request: AskRequest,
  model: string,
  globalPrompt: string = DEFAULT_ASK_PROMPT,
): Promise<{ text: string; usage: AnswerUsage }> {
  const record = [
    '<notes>',
    request.notes || '(no notes were written)',
    '</notes>',
    '',
    ...callRecord(request),
  ].join('\n');
  const earlier = request.history.map(
    (turn) => `${turn.role === 'you' ? 'User' : 'Kite'}: ${turn.text}`,
  );
  const { value, usage } = await jsonReply({
    model,
    tier: 'smart',
    system: [
      cachedBlock(withGlobalPrompt(ASK_REVIEW_CONTRACT, globalPrompt)),
      cachedBlock(smartSessionBlock(request.session)),
      cachedBlock(record),
    ],
    prompt: [
      ...(earlier.length > 0 ? ['Earlier in this chat:', ...earlier, ''] : []),
      `The user asks: ${request.question}`,
    ].join('\n'),
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
    maxTokens: ASK_MAX_TOKENS,
  });
  return { text: (value as { answer: string }).answer.trim(), usage };
}
