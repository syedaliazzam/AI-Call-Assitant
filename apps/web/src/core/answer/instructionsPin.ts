/**
 * File: apps/web/src/core/answer/instructionsPin.ts
 * Purpose: Remembers, per call, which company AI instructions versions were in force when the call
 *          started (ADR-0083), so every answer, warm-up and the notes of that call send the same
 *          versions: an admin's save during the call changes nothing for it, and its prompt cache keeps
 *          working. Calls are told apart by their start time (callStartedAt, Unix ms), which every
 *          request builder already has.
 * Used by: src/features/live/LivePage.tsx (pinInstructions() at Connect), src/core/answer/context.ts
 *          and src/core/answer/warm.ts (pinFor()), src/core/notes/generate.ts (pinFor())
 * Depends on: @kite/shared (InstructionsPin, the pin pattern), the browser's fetch
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 *
 * Holds version ids only, never instructions text, and logs nothing but a status code.
 */
import { AI_INSTRUCTIONS_PIN_PATTERN, type InstructionsPin } from '@kite/shared';

/** How many calls' pins are kept (a page runs one call at a time; older ones are only for its notes). */
const MAX_PINS = 5;

/** The pins by call start (Unix ms), oldest first. */
const pins = new Map<number, InstructionsPin>();

/** The pin fetches still running, by call start, so a second call for the same pin shares the first. */
const pending = new Map<number, Promise<InstructionsPin | null>>();

/**
 * Tells whether a value is a pin the server would accept.
 *
 * @param value The parsed response body.
 * @returns True when both fields are a version id or 'none'.
 * Called from: pinInstructions()
 */
function isPin(value: unknown): value is InstructionsPin {
  if (typeof value !== 'object' || value === null) return false;
  const { live, notes } = value as Record<string, unknown>;
  return (
    typeof live === 'string' &&
    typeof notes === 'string' &&
    AI_INSTRUCTIONS_PIN_PATTERN.test(live) &&
    AI_INSTRUCTIONS_PIN_PATTERN.test(notes)
  );
}

/**
 * Fetches the versions in force and keeps them for this call. Never throws: on a failure the call
 * goes on unpinned, and each request then uses the version in force when it arrives (the behaviour
 * of a page from before ADR-0083).
 *
 * @param callStartedAt The call's start (Unix ms): the key the request builders look it up by.
 * @param fetchImpl     fetch (tests pass one).
 * @returns The pin, or null when it could not be read.
 * Called from: LivePage.tsx when a new call starts (not on a reconnect: the call keeps its pin)
 */
export function pinInstructions(
  callStartedAt: number,
  fetchImpl: typeof fetch = fetch,
): Promise<InstructionsPin | null> {
  const known = pins.get(callStartedAt);
  if (known) return Promise.resolve(known);
  const running = pending.get(callStartedAt);
  if (running) return running;
  const fetched = (async (): Promise<InstructionsPin | null> => {
    try {
      const response = await fetchImpl('/api/ai-instructions/pin', { cache: 'no-store' });
      if (!response.ok) {
        console.warn('instructions pin: failed', { status: response.status });
        return null;
      }
      const body: unknown = await response.json();
      if (!isPin(body)) return null;
      pins.set(callStartedAt, { live: body.live, notes: body.notes });
      while (pins.size > MAX_PINS) {
        const oldest = pins.keys().next().value;
        if (oldest === undefined) break;
        pins.delete(oldest);
      }
      return body;
    } catch {
      return null;
    } finally {
      pending.delete(callStartedAt);
    }
  })();
  pending.set(callStartedAt, fetched);
  return fetched;
}

/**
 * The pin of a call, when it has one.
 *
 * @param callStartedAt The call's start (Unix ms), or null/undefined outside a call.
 * @returns The pin, or undefined (the request then uses the version in force).
 * Called from: buildAnswerRequest() in context.ts, sendWarmUp() in warm.ts, generateNotes(); tests
 */
export function pinFor(callStartedAt: number | null | undefined): InstructionsPin | undefined {
  return callStartedAt === null || callStartedAt === undefined
    ? undefined
    : pins.get(callStartedAt);
}

/**
 * Forgets every pin (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function forgetInstructionPins(): void {
  pins.clear();
  pending.clear();
}
