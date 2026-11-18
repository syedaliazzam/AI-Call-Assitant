/**
 * File: apps/web/src/core/session/modelAccess.ts
 * Purpose: Asks the server which answer models sessions may choose (GET /api/models), so the wizard, AI
 *          preferences and the overlay can show the others as unavailable. Never throws. When it cannot tell,
 *          it says yes to the deeper model and no to Groq (ADR-0095) and to the Gemini and GPT models
 *          (ADR-0099): the server enforces every switch on every answer anyway, and the third-party models need
 *          a server key (and, for Gemini, the rollout; ADR-0102) this account may not have.
 * Used by: src/features/session-setup/PreferencesStep.tsx, src/features/settings/Settings.tsx,
 *          src/features/live/LiveAnswers.tsx (the overlay's model switch, ADR-0094)
 * Depends on: @kite/shared (response type), the browser's fetch
 * Architecture: docs/design/paramount-ai-ui-spec.md §6; ADR-0095; ADR-0099; ADR-0102
 */
import type { ModelAccessResponse } from '@kite/shared';

/** Which answer models may be chosen now. */
export interface AnswerModelAccess {
  /** True unless an admin has turned the deeper model (Smart) off. */
  smart: boolean;
  /** ADR-0095: true when the server has Groq and an admin has not turned it off. */
  groq: boolean;
  /** ADR-0099: true when this account is in the Gemini rollout: the lists show the Gemini rows (ADR-0102). */
  moreModels: boolean;
  /** ADR-0099: true when this account may choose the Gemini models. */
  gemini: boolean;
  /** ADR-0099: true when this account may choose the GPT models. */
  openai: boolean;
}

/** What is assumed until (or when) the server cannot say: Smart on, every third-party model off. */
export const DEFAULT_MODEL_ACCESS: AnswerModelAccess = {
  smart: true,
  groq: false,
  moreModels: false,
  gemini: false,
  openai: false,
};

/**
 * Which answer models sessions may choose.
 *
 * @param fetchImpl fetch (tests replace it).
 * @returns The access; DEFAULT_MODEL_ACCESS when the server cannot be asked.
 * Called from: PreferencesStep.tsx, Settings.tsx, LiveAnswers.tsx (call start, and a switch; ADR-0094); tests
 */
export async function answerModelAccess(
  fetchImpl: typeof fetch = fetch,
): Promise<AnswerModelAccess> {
  try {
    const response = await fetchImpl('/api/models');
    if (!response.ok) return { ...DEFAULT_MODEL_ACCESS };
    const body = (await response.json()) as ModelAccessResponse;
    return {
      smart: body.deepModel !== false,
      groq: body.groq === true,
      // ADR-0099: an older server sends none of these, and (ADR-0102) an account outside the Gemini rollout no
      // moreModels or gemini: false.
      moreModels: body.moreModels === true,
      gemini: body.gemini === true,
      openai: body.openai === true,
    };
  } catch {
    return { ...DEFAULT_MODEL_ACCESS };
  }
}

/**
 * Whether sessions may choose the deeper model.
 *
 * @param fetchImpl fetch (tests replace it).
 * @returns True unless the server says it is off.
 * Called from: tests (the screens use answerModelAccess())
 */
export async function deepModelEnabled(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return (await answerModelAccess(fetchImpl)).smart;
}
