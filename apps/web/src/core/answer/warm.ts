/**
 * File: apps/web/src/core/answer/warm.ts
 * Purpose: Pre-warms Claude's prompt cache for a session (architecture §6.3): turns the stored
 *          session and its documents into the request's session details and sends mode 'warm',
 *          so the first real answer of the call reads the cache instead of writing it.
 * Used by: src/features/live/LiveSession.tsx (when a live session opens),
 *          src/features/live/LivePage.tsx (again on Connect, Day 4),
 *          src/features/dev/ClaudeTest.tsx ("Warm with session")
 * Depends on: src/core/answer/answerClient.ts, src/core/storage/types.ts, @kite/shared
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (Pre-warm), §7.2;
 *               day-03-sessions.md Stage 5
 *
 * The session details built here must be the same, byte for byte, as the ones the Day 4 answers
 * send, or the answers miss the cache: both use toSessionContext().
 *
 * Logs only the session id, timings and token counts; never session or document text.
 */
import type { SessionContext } from '@kite/shared';
import type { Session, StoredDocument } from '@/core/storage/types';
import { streamAnswer, type AnswerDone } from './answerClient';

/**
 * Builds the request's session details from what is stored on this computer. Documents are
 * sorted oldest first (ties by id), so the order never depends on how they were read.
 *
 * @param session   The stored session.
 * @param documents Its documents (any order).
 * @returns The session details for /api/answer.
 * Called from: warmSession(); the live answer panel (Day 4)
 */
export function toSessionContext(
  session: Session,
  documents: readonly StoredDocument[],
): SessionContext {
  const sorted = [...documents].sort((a, b) =>
    a.addedAt !== b.addedAt ? a.addedAt - b.addedAt : a.id < b.id ? -1 : 1,
  );
  return {
    type: session.type,
    company: session.company,
    role: session.role,
    description: session.description,
    instructions: session.instructions,
    keyTerms: session.preferences.keyTerms
      .split('\n')
      .map((term) => term.trim())
      .filter((term) => term !== ''),
    // Copied field by field so the order is fixed (JSON follows insertion order).
    style: {
      format: session.preferences.style.format,
      length: session.preferences.style.length,
      tone: session.preferences.style.tone,
    },
    documents: sorted.map((document) => ({ name: document.name, text: document.text })),
  };
}

/** Options for warmSession() (tests replace the request). */
export interface WarmOptions {
  /** Sends the request. Default streamAnswer() from answerClient.ts. */
  send?: typeof streamAnswer;
}

/**
 * Warms the prompt cache for a session. Never throws and never blocks: the caller does not wait
 * for it, and a failure only means the first answer is a little slower.
 *
 * @param session   The stored session.
 * @param documents Its documents.
 * @param options   Request override (tests).
 * @returns The warm-up's usage and timings, or null when it failed.
 * Called from: LiveSession.tsx (on open); LivePage.tsx (on Connect);
 *              ClaudeTest.tsx
 */
export function warmSession(
  session: Session,
  documents: readonly StoredDocument[],
  options: WarmOptions = {},
): Promise<AnswerDone | null> {
  const send = options.send ?? streamAnswer;
  return new Promise((resolve) => {
    try {
      send(
        {
          mode: 'warm',
          model: session.preferences.model,
          session: toSessionContext(session, documents),
        },
        {
          // A warm-up produces no text.
          onDelta: () => undefined,
          onDone: (done) => {
            console.info('warm: done', {
              sessionId: session.id,
              msTotal: done.msTotal,
              cacheWrite: done.usage.cache_creation_input_tokens,
              cacheRead: done.usage.cache_read_input_tokens,
              input: done.usage.input_tokens,
            });
            resolve(done);
          },
          onError: (failure) => {
            // The code only; the message is shown nowhere and holds no content anyway.
            console.warn('warm: failed', { sessionId: session.id, code: failure.code });
            resolve(null);
          },
        },
      );
    } catch {
      resolve(null);
    }
  });
}
