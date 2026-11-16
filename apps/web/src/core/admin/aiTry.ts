/**
 * File: apps/web/src/core/admin/aiTry.ts
 * Purpose: Browser side of Admin → AI settings' "Try it" (ADR-0083): lists this device's sessions to
 *          pick one for context, builds that session's details and documents as the live page sends
 *          them, and posts the try to the server.
 * Used by: src/features/admin/ai-settings/TryPanel.tsx
 * Depends on: src/core/storage (sessions.ts, documents.ts), src/core/answer/warm.ts
 *             (toLiveSessionContext), @kite/shared (AiTryRequest, AiTryResponse), the browser's fetch
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 *
 * The session's text goes to the server only inside the try request (as for any answer); nothing is
 * logged here.
 */
import type { AiTryRequest, AiTryResponse, SessionContext } from '@kite/shared';
import { toLiveSessionContext } from '../answer/warm';
import { listDocuments } from '../storage/documents';
import { listSessions } from '../storage/sessions';

/** A session the admin can pick for context. */
export interface TrySessionOption {
  /** The session's id on this device. */
  id: string;
  /** What the list shows: its company and role or topic. */
  label: string;
}

/**
 * This device's sessions, newest first, for the "Session for context" list.
 *
 * @returns The options ([] when none, or when the device's storage cannot be read).
 * Called from: TryPanel.tsx
 */
export async function listTrySessions(): Promise<TrySessionOption[]> {
  try {
    const sessions = await listSessions();
    return [...sessions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((session) => ({
        id: session.id,
        label:
          [session.company, session.role].filter((part) => part.trim() !== '').join(' · ') ||
          'Untitled session',
      }));
  } catch {
    return [];
  }
}

/**
 * A session's details and documents, as a call sends them (the CV in full and the documents summary).
 *
 * @param sessionId The session's id.
 * @returns Its context, or undefined when it no longer exists.
 * Called from: runAiTry()
 */
async function sessionContext(sessionId: string): Promise<SessionContext | undefined> {
  const session = (await listSessions()).find((candidate) => candidate.id === sessionId);
  if (!session) return undefined;
  return toLiveSessionContext(session, await listDocuments(session.id));
}

/** What a try comes back with. */
export type AiTryOutcome =
  | {
      /** It worked. */
      ok: true;
      /** The reply. */
      reply: AiTryResponse;
    }
  | {
      /** It did not. */
      ok: false;
      /** A short message to show (the server's own, which never holds content). */
      message: string;
    };

/** The input of runAiTry(). */
export interface AiTryInput extends Omit<AiTryRequest, 'session'> {
  /** The picked session's id, or '' for none. */
  sessionId: string;
}

/**
 * Runs a try on the server.
 *
 * @param input     The block, draft, sample, picked session and (ADR-0086) optional full prompt.
 * @param fetchImpl fetch (tests pass one).
 * @returns The reply, or a message to show.
 * Called from: TryPanel.tsx; tests
 */
export async function runAiTry(
  input: AiTryInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AiTryOutcome> {
  try {
    const session = input.sessionId ? await sessionContext(input.sessionId) : undefined;
    const body: AiTryRequest = {
      block: input.block,
      draft: input.draft,
      sample: input.sample,
      ...(session ? { session } : {}),
      // ADR-0086: the full prompt to try (advanced mode's draft, or a custom prompt in force).
      ...(input.prompt ? { prompt: input.prompt } : {}),
    };
    const response = await fetchImpl('/api/admin/ai-instructions/try', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { message?: unknown };
      return {
        ok: false,
        message:
          typeof failure.message === 'string'
            ? failure.message
            : 'The try did not work. Try again.',
      };
    }
    return { ok: true, reply: (await response.json()) as AiTryResponse };
  } catch {
    return { ok: false, message: 'The try did not work. Check the connection and try again.' };
  }
}
