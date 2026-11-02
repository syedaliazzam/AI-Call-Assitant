/**
 * File: apps/web/src/core/askKite/chat.ts
 * Purpose: The browser logic of the Ask Kite page, without React: builds a message's request from a
 *          stored chat (within the request limits), names a chat from its first question, and turns
 *          a past session into text to attach.
 * Used by: src/features/ask-kite/AskKitePage.tsx
 * Depends on: @kite/shared (limits and types), src/core/storage/answerPrefs.ts,
 *             src/core/review/conversation.ts, src/core/review/load.ts, src/core/review/ask.ts,
 *             src/core/transcript/display.ts
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * Chat text is the user's content: it goes only into the request, never a log.
 */
import {
  DEFAULT_CODING_LANGUAGE,
  MAX_KITE_HISTORY,
  MAX_KITE_TURN_CHARS,
  type AnswerRequest,
  type KiteTurn,
} from '@kite/shared';
import { conversationItems, transcriptText } from '../review/conversation';
import { notesText } from '../review/ask';
import type { ReviewData } from '../review/load';
import { getCodingLanguage } from '../storage/answerPrefs';
import type { ChatAttachment, ChatMessage, StoredChat } from '../storage/types';
import { displayTerms } from '../transcript/display';

/** The most text one chat can have attached, in characters (the server's limit). */
export const MAX_ATTACHED_CHARS = 150_000;

/** How long a chat's name can be, in characters. */
const MAX_TITLE_CHARS = 60;

/** Stands in for the question of a message that is only a screenshot. */
export const SCREENSHOT_ONLY = '(screenshot)';

/**
 * A chat's name, from its first question.
 *
 * @param question The first question.
 * @returns At most MAX_TITLE_CHARS characters of it, on one line.
 * Called from: AskKitePage.tsx; tests
 */
export function chatTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  if (line === '') return 'Screenshot';
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1)}…` : line;
}

/**
 * The chat so far as request turns, newest within the limit. Claude's turns must start with the
 * user's, so a cut that leaves Kite's reply first drops it too. A screenshot is sent only with its
 * own message, so later turns say that it can no longer be seen.
 *
 * @param messages The chat's messages, oldest first.
 * @returns The turns.
 * Called from: kiteRequest(); tests
 */
export function historyTurns(messages: readonly ChatMessage[]): KiteTurn[] {
  const turns = messages.slice(-MAX_KITE_HISTORY).map((message) => ({
    role: message.role,
    text: (message.images
      ? `${message.text} [screenshot sent then, no longer available]`
      : message.text
    ).slice(0, MAX_KITE_TURN_CHARS),
  }));
  return turns[0]?.role === 'kite' ? turns.slice(1) : turns;
}

/**
 * Builds the request for one message.
 *
 * @param chat     The chat, without this message.
 * @param question What the user typed ('' for a screenshot alone).
 * @param images   The pasted screenshots, as JPEG data URLs.
 * @returns The request.
 * Called from: AskKitePage.tsx; tests
 */
export function kiteRequest(
  chat: Pick<StoredChat, 'messages' | 'attachments'>,
  question: string,
  images: readonly string[],
): AnswerRequest {
  const language = getCodingLanguage();
  return {
    mode: 'kite',
    history: historyTurns(chat.messages),
    attachments: chat.attachments.map(({ name, text }) => ({ name, text })),
    ...(question.trim() ? { question: question.trim() } : {}),
    ...(images.length > 0 ? { images: [...images] } : {}),
    ...(language !== DEFAULT_CODING_LANGUAGE ? { codingLanguage: language } : {}),
  };
}

/**
 * Turns a past session into an attachment: its details, its documents, its AI notes and its
 * conversation, so a chat can pick up from that call.
 *
 * @param review The session's review data.
 * @returns The attachment's name and text.
 * Called from: AskKitePage.tsx; tests
 */
export function sessionAttachment(review: ReviewData): Pick<ChatAttachment, 'name' | 'text'> {
  const { session } = review;
  const name = `Session: ${session.company || 'no company'}${session.role ? ` (${session.role})` : ''}`;
  const notes = notesText(review.notes?.notes ?? null);
  const items = conversationItems(review.lines, review.answers);
  return {
    name,
    text: [
      `Call type: ${session.type}`,
      `Company: ${session.company}`,
      `Role or topic: ${session.role}`,
      `Description: ${session.description}`,
      ...(notes ? ['', 'AI notes:', notes] : []),
      ...review.documents.flatMap((document) => ['', `Document ${document.name}:`, document.text]),
      ...(items.length > 0
        ? ['', 'The call:', transcriptText(session, items, displayTerms(session))]
        : []),
    ].join('\n'),
  };
}
