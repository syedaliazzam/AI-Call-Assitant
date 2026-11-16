/**
 * File: apps/web/src/core/session/modelAccess.ts
 * Purpose: Asks the server whether the deeper model is on (GET /api/models), so the wizard can show it
 *          as unavailable. Never throws: when it cannot tell it says yes, because the server enforces
 *          the switch on every answer anyway.
 * Used by: src/features/session-setup/PreferencesStep.tsx, src/features/live/LiveAnswers.tsx (the overlay's
 *          model switch, ADR-0094)
 * Depends on: @kite/shared (response type), the browser's fetch
 * Architecture: docs/design/paramount-ai-ui-spec.md §6
 */
import type { ModelAccessResponse } from '@kite/shared';

/**
 * Whether sessions may choose the deeper model.
 *
 * @param fetchImpl fetch (tests replace it).
 * @returns True unless the server says it is off.
 * Called from: PreferencesStep.tsx; LiveAnswers.tsx (call start, and a switch to Smart; ADR-0094); tests
 */
export async function deepModelEnabled(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/models');
    if (!response.ok) return true;
    return ((await response.json()) as ModelAccessResponse).deepModel !== false;
  } catch {
    return true;
  }
}
