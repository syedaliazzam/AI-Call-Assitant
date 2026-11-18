/**
 * File: apps/web/src/core/live/hygiene.ts
 * Purpose: Session hygiene (v1.1.0, ADR-0044): a call left running by mistake. After 10 minutes with no
 *          "Them" audio and no answers Kite asks "Still in a call?"; after 30 minutes it pauses
 *          listening, which also stops its paid warm-ups, until Resume. Pure, so a 40-minute call can
 *          be tested with a fake clock.
 * Used by: src/features/live/LivePage.tsx, src/features/live/LiveAnswers.tsx (ADR-0101: beforeVoiceQuestion()); tests
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0044
 */

/** How long without "Them" audio or answers before asking, in ms. */
export const HYGIENE_ASK_MS = 10 * 60 * 1000;

/** How long without "Them" audio or answers before pausing, in ms. */
export const HYGIENE_PAUSE_MS = 30 * 60 * 1000;

/** Where a call stands: nothing to do, asking, or paused. */
export type HygieneState = 'ok' | 'ask' | 'paused';

/**
 * Where a call stands.
 *
 * @param lastActivity The latest of: when the call connected, "Them" audio, an answer, and the user's
 *                     "yes, still in a call" (Unix ms).
 * @param now          The time now (Unix ms).
 * @returns The state.
 * Called from: LivePage.tsx; tests
 */
export function hygieneState(lastActivity: number, now: number): HygieneState {
  const quiet = now - lastActivity;
  if (quiet >= HYGIENE_PAUSE_MS) return 'paused';
  return quiet >= HYGIENE_ASK_MS ? 'ask' : 'ok';
}

/**
 * ADR-0101: what a voice question (or Voice mode turned on) does first, so it never meets a paused
 * microphone: a paused listen is resumed ('resume'), an open "Still in a call?" is answered yes ('still-here'),
 * otherwise nothing.
 *
 * @param state The hygiene state now.
 * @returns The action to take first, or null.
 * Called from: src/features/live/LiveAnswers.tsx; tests
 */
export function beforeVoiceQuestion(
  state: HygieneState | undefined,
): 'resume' | 'still-here' | null {
  if (state === 'paused') return 'resume';
  if (state === 'ask') return 'still-here';
  return null;
}
