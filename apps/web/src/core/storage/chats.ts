/**
 * File: apps/web/src/core/storage/chats.ts
 * Purpose: The Ask Kite page's chats on this device: start, read, save and delete. A chat holds its
 *          own copy of what is attached to it, so deleting a library item or a session never
 *          changes a chat. Screenshots are not kept (ChatMessage counts them only).
 * Used by: src/features/ask-kite/AskKitePage.tsx
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 *
 * Nothing here is sent anywhere or logged: the chat's text is sent only with a message the user
 * sends, from core/askKite/chat.ts.
 */
import { getDb } from './db';
import type { StoredChat } from './types';

/**
 * Makes a new, empty chat. It is saved with its first message, so opening the page and leaving
 * again leaves nothing behind.
 *
 * @param now The time (Unix ms).
 * @returns The chat (not yet saved).
 * Called from: AskKitePage.tsx; tests
 */
export function newChat(now = Date.now()): StoredChat {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    attachments: [],
    messages: [],
  };
}

/**
 * Saves a chat, adding it or replacing it.
 *
 * @param chat The chat.
 * @returns Resolves when saved.
 * Called from: AskKitePage.tsx; tests
 */
export async function saveChat(chat: StoredChat): Promise<void> {
  await getDb().chats.put(chat);
}

/**
 * Lists the chats, latest change first.
 *
 * @returns The chats ([] when there are none).
 * Called from: AskKitePage.tsx; tests
 */
export async function listChats(): Promise<StoredChat[]> {
  return getDb().chats.orderBy('updatedAt').reverse().toArray();
}

/**
 * Deletes a chat.
 *
 * @param id The chat's id.
 * @returns Resolves when deleted.
 * Called from: AskKitePage.tsx; tests
 */
export async function deleteChat(id: string): Promise<void> {
  await getDb().chats.delete(id);
}
