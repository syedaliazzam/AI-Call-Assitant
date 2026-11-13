/**
 * File: apps/web/src/server/budget.ts
 * Purpose: Keeps every live answer request under MAX_ANSWER_INPUT_TOKENS (100k), whatever the size of the
 *          session's documents (Batch C, P2-1). Two steps:
 *          1. The session block (the cached prefix) has a fixed ceiling, SESSION_BLOCK_MAX_CHARS: documents
 *             past it are shortened, the CV last. It depends only on the session, so the warm-up and every
 *             answer of a call send the same bytes and the cache still works. A current page sends the CV
 *             and the documents summary, which are far below it; an older page that sends every document in
 *             full is where it matters.
 *          2. The whole prompt is counted conservatively (BUDGET_CHARS_PER_TOKEN characters a token, plus a
 *             screenshot's allowance). Only if it is still over the budget, the uncached and oldest parts go,
 *             in this order: the document parts, the similar earlier answer, the oldest "latest" lines, then
 *             the oldest conversation chunks. With today's other limits this second step never runs; it is
 *             the guarantee.
 * Used by: src/server/prompt.ts (buildPrompt())
 * Depends on: @kite/shared (MAX_ANSWER_INPUT_TOKENS, SessionContext, AnswerRequest)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md D3; ADR-0078
 *
 * Counts characters only; never logs text.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { MAX_ANSWER_INPUT_TOKENS, type AnswerRequest, type SessionContext } from '@kite/shared';

/**
 * Characters per token for the budget: fewer than the usual 4 for English, so dense text (code, numbers,
 * other languages) still fits under the real limit.
 */
export const BUDGET_CHARS_PER_TOKEN = 3;

/** The budget the counted prompt must fit in, tokens (5% below the limit, for the counting's error). */
export const BUDGET_TOKENS = Math.floor(MAX_ANSWER_INPUT_TOKENS * 0.95);

/**
 * The most characters the session block's text may hold (details, documents and summary): about 40k
 * tokens, leaving room for the rules, a long conversation and the question.
 */
export const SESSION_BLOCK_MAX_CHARS = 120_000;

/**
 * Tokens counted for a screenshot (the largest one Kite sends, 1,568 px on its long side, is about
 * 3,300 tokens by Anthropic's width × height / 750).
 */
export const IMAGE_TOKENS = 3_500;

/** Put at the end of a document shortened to fit. */
export const SHORTENED_NOTE = '[The rest of this document was left out to fit.]';

/**
 * Characters of a session's text other than its documents (details, key terms, instructions, summary).
 *
 * @param session The session details.
 * @returns The count.
 */
function otherSessionChars(session: SessionContext): number {
  return (
    session.type.length +
    session.company.length +
    session.role.length +
    session.description.length +
    session.instructions.length +
    session.keyTerms.reduce((total, term) => total + term.length + 2, 0) +
    (session.documentsSummary?.length ?? 0) +
    // The fixed labels and lines around them (generous).
    2_000
  );
}

/**
 * Shortens the session's documents so the session block stays under SESSION_BLOCK_MAX_CHARS. Documents
 * keep their order (the CV first) and each gets what is left; the ones at the end are shortened first.
 * Depends only on the session, so every request of a call gets the same bytes.
 *
 * @param session The session details.
 * @returns The same object when nothing needed shortening, otherwise a copy with shortened documents.
 * Called from: prompt.ts buildPrompt(); tests
 */
export function capSessionDocuments(session: SessionContext): SessionContext {
  const total = session.documents.reduce((sum, document) => sum + document.text.length, 0);
  let left = Math.max(0, SESSION_BLOCK_MAX_CHARS - otherSessionChars(session));
  if (total <= left) return session;
  const documents = session.documents.map((document) => {
    const room = Math.max(0, left - SHORTENED_NOTE.length - 2);
    if (document.text.length <= left) {
      left -= document.text.length;
      return document;
    }
    left = 0;
    return { ...document, text: `${document.text.slice(0, room)}\n${SHORTENED_NOTE}` };
  });
  return { ...session, documents };
}

/** A built prompt, as the budget counts it. */
export interface CountedPrompt {
  /** The system blocks. */
  system: readonly Anthropic.TextBlockParam[];
  /** The user turn(s). */
  messages: readonly Anthropic.MessageParam[];
}

/**
 * The prompt's input tokens, counted conservatively: every text at BUDGET_CHARS_PER_TOKEN characters a
 * token, and IMAGE_TOKENS for each image.
 *
 * @param prompt The built prompt.
 * @returns The count.
 * Called from: fitToBudget(); tests
 */
export function countPromptTokens(prompt: CountedPrompt): number {
  let chars = prompt.system.reduce((total, block) => total + block.text.length, 0);
  let images = 0;
  for (const message of prompt.messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length;
      continue;
    }
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length;
      else if (block.type === 'image') images += 1;
    }
  }
  return Math.ceil(chars / BUDGET_CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
}

/**
 * The next smaller request, or null when nothing more can go: the document parts, then the similar
 * earlier answer, then the oldest "latest" line, then the oldest conversation chunk.
 *
 * @param request The request.
 * @returns The smaller request, or null.
 */
function shrink(request: AnswerRequest): AnswerRequest | null {
  if (request.documentChunks?.length) return { ...request, documentChunks: [] };
  if (request.similar) {
    const next = { ...request };
    delete next.similar;
    return next;
  }
  if ((request.tail?.length ?? 0) > 1) return { ...request, tail: request.tail!.slice(1) };
  if ((request.conversation?.length ?? 0) > 1) {
    return { ...request, conversation: request.conversation!.slice(1) };
  }
  return null;
}

/**
 * Builds a request's prompt within the budget (step 2 above).
 *
 * @param request The request (its session already capped by capSessionDocuments()).
 * @param build   Builds a prompt from a request (prompt.ts's own builder).
 * @returns The prompt, and how many times it had to be made smaller (0 normally).
 * Called from: prompt.ts buildPrompt(); tests
 */
export function fitToBudget<P extends CountedPrompt>(
  request: AnswerRequest,
  build: (request: AnswerRequest) => P,
): { prompt: P; shrunk: number } {
  let current = request;
  let prompt = build(current);
  let shrunk = 0;
  while (countPromptTokens(prompt) > BUDGET_TOKENS) {
    const smaller = shrink(current);
    if (!smaller) break;
    current = smaller;
    prompt = build(current);
    shrunk += 1;
  }
  return { prompt, shrunk };
}
