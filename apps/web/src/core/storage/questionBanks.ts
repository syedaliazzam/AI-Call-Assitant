/**
 * File: apps/web/src/core/storage/questionBanks.ts
 * Purpose: Stores each session's question bank on this device, so it can be reviewed later without
 *          paying to write it again. One per session; writing it again replaces it.
 * Used by: src/features/prepare/QuestionBank.tsx
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029
 *
 * The questions and suggested answers are the user's content and are never logged.
 */
import { getDb } from './db';
import type { StoredQuestionBank } from './types';

/**
 * Saves a session's question bank, replacing any earlier one.
 *
 * @param bank The bank.
 * @returns Nothing.
 * Called from: QuestionBank.tsx; tests
 */
export async function saveQuestionBank(bank: StoredQuestionBank): Promise<void> {
  await getDb().questionBanks.put(bank);
}

/**
 * Reads a session's question bank.
 *
 * @param sessionId The session.
 * @returns The bank, or null when none was written.
 * Called from: QuestionBank.tsx; tests
 */
export async function getQuestionBank(sessionId: string): Promise<StoredQuestionBank | null> {
  return (await getDb().questionBanks.get(sessionId)) ?? null;
}
