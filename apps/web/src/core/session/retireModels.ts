/**
 * File: apps/web/src/core/session/retireModels.ts
 * Purpose: ADR-0101: while Groq is off for this account (the admin's switch, or no server key), no session and
 *          no default for new sessions stays set to it: each is moved to Claude Haiku ('fast'), on this device
 *          (account sync carries the change to the others). The server already answers such a session with
 *          Claude Haiku and never asks Groq; this makes the stored choice say so too.
 * Used by: src/features/dashboard/Dashboard.tsx (once when it opens)
 * Depends on: src/core/storage/sessions.ts, src/core/storage/settings.ts, ./modelAccess.ts (AnswerModelAccess)
 * Architecture: docs/decisions/ADR-0101-fast-voice-questions-for-everyone.md
 *
 * Ids and counts only; nothing is logged.
 */
import { getSessionDefaults, saveSessionDefaults } from '../storage/settings';
import { listSessions, updateSessionPreferences } from '../storage/sessions';
import type { AnswerModelAccess } from './modelAccess';

/** The storage functions used (tests replace them). */
export interface RetireDeps {
  /** Every session on this device. */
  listSessions: typeof listSessions;
  /** Changes a session's preferences. */
  updateSessionPreferences: typeof updateSessionPreferences;
  /** The defaults for new sessions. */
  getSessionDefaults: typeof getSessionDefaults;
  /** Saves the defaults for new sessions. */
  saveSessionDefaults: typeof saveSessionDefaults;
}

/** The real storage. */
const STORAGE: RetireDeps = {
  listSessions,
  updateSessionPreferences,
  getSessionDefaults,
  saveSessionDefaults,
};

/**
 * Moves every session, and the defaults, that are set to Groq to Claude Haiku, when Groq is off.
 *
 * @param access What the server said this account may use.
 * @param deps   Storage (tests pass fakes).
 * @returns How many sessions moved, and whether the defaults moved.
 * Called from: Dashboard.tsx; tests
 */
export async function moveOffGroq(
  access: Pick<AnswerModelAccess, 'groq'>,
  deps: RetireDeps = STORAGE,
): Promise<{ sessions: number; defaults: boolean }> {
  if (access.groq) return { sessions: 0, defaults: false };
  let moved = 0;
  for (const session of await deps.listSessions()) {
    if (session.preferences.model !== 'groq') continue;
    await deps.updateSessionPreferences(session.id, { model: 'fast' });
    moved += 1;
  }
  const defaults = await deps.getSessionDefaults();
  const defaultsMoved = defaults.model === 'groq';
  if (defaultsMoved) await deps.saveSessionDefaults({ ...defaults, model: 'fast' });
  return { sessions: moved, defaults: defaultsMoved };
}
