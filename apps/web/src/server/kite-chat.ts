/**
 * File: apps/web/src/server/kite-chat.ts
 * Purpose: Builds the prompt for the Ask Kite page (mode 'kite'): a chat about anything, outside a
 *          call, with attached library items or past sessions and pasted screenshots. Rules and
 *          attachments are cached blocks, and the newest earlier turn carries a third breakpoint, so
 *          each message reads the cache the one before it wrote.
 * Used by: app/api/answer/route.ts; scripts/eval-answers.ts
 * Depends on: src/server/claude.ts (cachedBlock), src/server/prompts/contract.ts (the Ask AI page
 *             contract, ADR-0089), src/server/prompts/defaults.ts, src/server/prompts/preferences.ts,
 *             @kite/shared (AnswerRequest)
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * The chat and its attachments are the user's content: they go into the prompt only, never a log.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerRequest } from '@kite/shared';
import { cachedBlock } from './claude';
import type { BuiltPrompt } from './prompt';
import { ASK_CHAT_CONTRACT, withGlobalPrompt } from './prompts/contract';
import { DEFAULT_ASK_PROMPT } from './prompts/defaults';
import { DEFAULT_CODING_LANGUAGE, PREFERENCES_HEADING } from './prompts/preferences';

/** Most tokens an Ask Kite reply may use: long code and explanations fit; a runaway does not. */
export const KITE_CHAT_MAX_TOKENS = 4_000;

/**
 * Makes text safe to put inside the attachment tags, so an attachment cannot close them.
 *
 * @param text Raw text.
 * @returns The text with &, < and > written as entities.
 * Called from: attachmentsBlock()
 */
function escapeTags(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Writes the user's preferences (the coding language, under the heading that says they decide format,
 * length, tone, language and focus over the general rules, ADR-0089 and ADR-0103) and the attachments
 * as a cached block.
 *
 * @param request The request.
 * @returns The block's text.
 * Called from: buildKiteChatPrompt(); tests
 */
export function attachmentsBlock(request: AnswerRequest): string {
  const language = request.codingLanguage;
  const lines = [
    PREFERENCES_HEADING,
    `Coding language: ${language || DEFAULT_CODING_LANGUAGE}.`,
    '',
    '<attachments>',
  ];
  const attachments = request.attachments ?? [];
  if (attachments.length === 0) lines.push('(none)');
  for (const attachment of attachments) {
    lines.push(
      `<attachment name="${escapeTags(attachment.name).replaceAll('"', '&quot;')}">`,
      escapeTags(attachment.text),
      '</attachment>',
    );
  }
  lines.push('</attachments>');
  return lines.join('\n');
}

/**
 * Builds the prompt for one Ask Kite message.
 *
 * @param request      A validated request with mode 'kite'.
 * @param globalPrompt The admin's global prompt for Ask AI in force (ADR-0089), after the locked contract.
 * @returns The system blocks and the chat so far, ending with this message.
 * Called from: POST handler in app/api/answer/route.ts; scripts/eval-answers.ts; tests
 */
export function buildKiteChatPrompt(
  request: AnswerRequest,
  globalPrompt: string = DEFAULT_ASK_PROMPT,
): BuiltPrompt {
  const history = request.history ?? [];
  const messages: Anthropic.MessageParam[] = history.map((turn, index) => ({
    role: turn.role === 'you' ? 'user' : 'assistant',
    // The cache breakpoint sits on the newest earlier turn: the next message reads up to here.
    content: [
      index === history.length - 1
        ? cachedBlock(turn.text)
        : ({ type: 'text', text: turn.text } satisfies Anthropic.TextBlockParam),
    ],
  }));
  const images = (request.images ?? []).map((image): Anthropic.ImageBlockParam => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: image.slice(image.indexOf(',') + 1),
    },
  }));
  const question = request.question?.trim() || 'What is on this screenshot?';
  messages.push({ role: 'user', content: [...images, { type: 'text', text: question }] });
  return {
    system: [
      cachedBlock(withGlobalPrompt(ASK_CHAT_CONTRACT, globalPrompt)),
      cachedBlock(attachmentsBlock(request)),
    ],
    messages,
  };
}
