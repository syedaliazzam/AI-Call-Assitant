/**
 * File: apps/web/src/core/session/modelAccess.ts
 * Purpose: Asks the server which answer models sessions may choose (GET /api/models), so the wizard, AI
 *          preferences and the overlay can show the others as unavailable. Never throws. When it cannot tell,
 *          it says yes to the deeper model and no to Groq (ADR-0095): the server enforces both switches on
 *          every answer anyway, and Groq needs a server key it may not have.
 * Used by: src/features/session-setup/PreferencesStep.tsx, src/features/settings/Settings.tsx,
 *          src/features/live/LiveAnswers.tsx (the overlay's model switch, ADR-0094)
 * Depends on: @kite/shared (response type), the browser's fetch
 * Architecture: docs/design/paramount-ai-ui-spec.md §6; ADR-0095
 */
import type { ModelAccessResponse } from '@kite/shared';

/** Which answer models may be chosen now. */
export interface AnswerModelAccess {
  /** True unless an admin has turned the deeper model (Smart) off. */
  smart: boolean;
  /** ADR-0095: true when the server has Groq and an admin has not turned it off. */
  groq: boolean;
}

/**
 * Which answer models sessions may choose.
 *
 * @param fetchImpl fetch (tests replace it).
 * @returns The access; { smart: true, groq: false } when the server cannot be asked.
 * Called from: PreferencesStep.tsx, Settings.tsx, LiveAnswers.tsx (call start, and a switch; ADR-0094); tests
 */
export async function answerModelAccess(
  fetchImpl: typeof fetch = fetch,
): Promise<AnswerModelAccess> {
  try {
    const response = await fetchImpl('/api/models');
    if (!response.ok) return { smart: true, groq: false };
    const body = (await response.json()) as ModelAccessResponse;
    return { smart: body.deepModel !== false, groq: body.groq === true };
  } catch {
    return { smart: true, groq: false };
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
