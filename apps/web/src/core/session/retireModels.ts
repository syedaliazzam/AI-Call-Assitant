/**
 * File: apps/web/src/core/session/retireModels.ts
 * Purpose: ADR-0101: while Groq is off for this account (the admin's switch, or no server key), no session and
 *          no default for new sessions stays set to it: each is moved to Claude Haiku ('fast'), on this device
 *          (account sync carries the change to the others). The server already answers such a session with
 *          Claude Haiku and never asks Groq; this makes the stored choice say so too. ADR-0104: the same, always,
 *          for a retired model (Gemini 3.6 Flash). ADR-0121: and always for a hidden model (Groq), which no
 *          model list offers any more.
 * Used by: src/features/dashboard/Dashboard.tsx (once when it opens), src/features/live/LiveAnswers.tsx (a
 *          running call)
 * Depends on: @kite/shared (isRetiredModel), src/core/storage/sessions.ts, src/core/storage/settings.ts,
 *             ./modelAccess.ts (AnswerModelAccess)
 * Architecture: docs/decisions/ADR-0101-fast-voice-questions-for-everyone.md;
 *               docs/decisions/ADR-0104-gemini-flash-lite-stays-in-rollout.md
 *
 * Ids and counts only; nothing is logged.
 */
import { isHiddenModel, isRetiredModel, type AnswerModel } from '@kite/shared';
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
 * Whether a stored model must move to Claude Haiku: Groq while it is off (ADR-0101), a retired model
 * (ADR-0104), or (ADR-0121) a hidden model, which no list offers any more (Groq, also while its switch is
 * on), whatever the server says.
 *
 * @param model  The stored model.
 * @param access What the server said this account may use.
 * @returns True when it moves.
 * Called from: moveOffUnavailableModels(); LiveAnswers.tsx (a running call); tests
 */
export function mustMoveToHaiku(
  model: AnswerModel,
  access: Pick<AnswerModelAccess, 'groq'>,
): boolean {
  return (model === 'groq' && !access.groq) || isRetiredModel(model) || isHiddenModel(model);
}

/**
 * ADR-0121: the model a live call asks for, given the session's stored choice: Claude Haiku ('fast') for a
 * hidden model (Groq), which no list offers; the stored choice otherwise. The stored choice itself is moved by
 * mustMoveToHaiku() and moveOffUnavailableModels(); this covers the first answers before that has happened.
 *
 * @param model The stored model.
 * @returns The model to ask for.
 * Called from: LiveAnswers.tsx; tests
 */
export function offeredModel(model: AnswerModel): AnswerModel {
  return isHiddenModel(model) ? 'fast' : model;
}

/**
 * Moves every session, and the defaults, that are set to Groq while Groq is off (ADR-0101), or to a retired
 * model (ADR-0104), to Claude Haiku.
 *
 * @param access What the server said this account may use.
 * @param deps   Storage (tests pass fakes).
 * @returns How many sessions moved, and whether the defaults moved.
 * Called from: Dashboard.tsx; tests
 */
export async function moveOffUnavailableModels(
  access: Pick<AnswerModelAccess, 'groq'>,
  deps: RetireDeps = STORAGE,
): Promise<{ sessions: number; defaults: boolean }> {
  let moved = 0;
  for (const session of await deps.listSessions()) {
    if (!mustMoveToHaiku(session.preferences.model, access)) continue;
    await deps.updateSessionPreferences(session.id, { model: 'fast' });
    moved += 1;
  }
  const defaults = await deps.getSessionDefaults();
  const defaultsMoved = mustMoveToHaiku(defaults.model, access);
  if (defaultsMoved) await deps.saveSessionDefaults({ ...defaults, model: 'fast' });
  return { sessions: moved, defaults: defaultsMoved };
}
