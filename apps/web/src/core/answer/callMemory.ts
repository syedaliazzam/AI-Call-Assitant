/**
 * File: apps/web/src/core/answer/callMemory.ts
 * Purpose: The call memory on the device (ADR-0137): decides when to update the running summary of the call
 *          (after enough new words, or a few minutes with some), builds the update request from the lines said
 *          since the last update, and asks POST /api/memory for it. The live page keeps the memory for the
 *          call only (never stored) and sends it with every answer, so answers can use anything said earlier,
 *          also beyond the conversation the prompt keeps word for word.
 * Used by: src/features/live/useLiveAnswers.ts
 * Depends on: @kite/shared (CallMemoryRequest, limits), src/core/transcript/transcript.ts (Utterance)
 * Architecture: docs/decisions/ADR-0137-call-memory.md; docs/architecture/kite-architecture-v3.1.md §6.1
 *
 * memoryDue() and memoryRequest() are pure. The memory is call content: never logged.
 */
import {
  MAX_CALL_MEMORY_LINES,
  MAX_LINE_CHARS,
  type CallMemoryRequest,
  type CallMemoryResponse,
} from '@kite/shared';
import type { Utterance } from '../transcript/transcript';

/** Update after this many new final words (about two minutes of conversation). */
export const MEMORY_UPDATE_WORDS = 250;

/** Or after this long since the last update (or since the call's first words), with some new words, ms. */
export const MEMORY_STALE_MS = 4 * 60_000;

/** "Some new words" for the time rule. */
export const MEMORY_MIN_WORDS = 30;

/** Never two updates closer than this, ms. */
export const MEMORY_MIN_GAP_MS = 60_000;

/** After a failed update, wait this long before the next try, ms. */
export const MEMORY_RETRY_MS = 2 * 60_000;

/** The call memory on the device. */
export interface MemoryState {
  /** The memory so far ('' before the first update). Never logged. */
  text: string;
  /** The end (capture clock) of the newest line the memory covers, or null before the first update. */
  until: number | null;
  /** When the last update was asked for (Unix ms), or null. */
  lastAt: number | null;
  /** True while an update is in flight. */
  inFlight: boolean;
  /** When the last update failed (Unix ms), or null. */
  failedAt: number | null;
}

/**
 * An empty memory, for the start of a call.
 *
 * @returns The state.
 * Called from: useLiveAnswers.ts (each new call); tests
 */
export function emptyMemory(): MemoryState {
  return { text: '', until: null, lastAt: null, inFlight: false, failedAt: null };
}

/**
 * The number of words in a text.
 *
 * @param text The text.
 * @returns The count.
 */
function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Whether the memory should be updated now, and with which lines: the final lines (both sides) that ended
 * after the memory's last line, once there are MEMORY_UPDATE_WORDS of them, or MEMORY_MIN_WORDS after
 * MEMORY_STALE_MS; never while one is in flight, within MEMORY_MIN_GAP_MS of the last, or within
 * MEMORY_RETRY_MS of a failure. At most MAX_CALL_MEMORY_LINES (the oldest first: the next update goes on).
 *
 * @param state The memory state.
 * @param lines The visible lines (finals and grey), in order.
 * @param now   The current time (Unix ms, the lines' clock).
 * @returns The lines to add, or null when no update is due.
 * Called from: useLiveAnswers.ts (a timer during the call); tests
 */
export function memoryDue(
  state: MemoryState,
  lines: readonly Utterance[],
  now: number,
): Utterance[] | null {
  if (state.inFlight) return null;
  if (state.failedAt !== null && now - state.failedAt < MEMORY_RETRY_MS) return null;
  if (state.lastAt !== null && now - state.lastAt < MEMORY_MIN_GAP_MS) return null;
  const fresh = lines.filter(
    (line) =>
      line.final &&
      !line.gap &&
      !line.nonEnglish &&
      line.text.trim() !== '' &&
      (state.until === null || line.tEnd > state.until),
  );
  if (fresh.length === 0) return null;
  const count = fresh.reduce((total, line) => total + words(line.text), 0);
  const since = state.lastAt ?? fresh[0]!.tStart;
  const due =
    count >= MEMORY_UPDATE_WORDS || (count >= MEMORY_MIN_WORDS && now - since >= MEMORY_STALE_MS);
  return due ? fresh.slice(0, MAX_CALL_MEMORY_LINES) : null;
}

/**
 * The body of one update.
 *
 * @param session       What the call is (type, company, role).
 * @param previous      The memory so far.
 * @param lines         The lines to add (memoryDue()).
 * @param callStartedAt When the call connected (Unix ms): line times are seconds since then.
 * @returns The request body.
 * Called from: useLiveAnswers.ts; tests
 */
export function memoryRequest(
  session: CallMemoryRequest['session'],
  previous: string,
  lines: readonly Utterance[],
  callStartedAt: number,
): CallMemoryRequest {
  return {
    session: {
      type: session.type.slice(0, 40),
      company: session.company.slice(0, 200),
      role: session.role.slice(0, 200),
    },
    previous,
    lines: lines.map((line) => ({
      speaker: line.speaker,
      text: line.text.trim().slice(0, MAX_LINE_CHARS),
      at: Math.max(0, Math.floor((line.tStart - callStartedAt) / 1_000)),
    })),
  };
}

/**
 * Asks POST /api/memory for the updated memory.
 *
 * @param body      The request body (memoryRequest()).
 * @param fetchImpl fetch (tests pass a fake).
 * @returns The new memory, or null when the update failed (the caller keeps the memory it has).
 * Called from: useLiveAnswers.ts
 */
export async function requestCallMemory(
  body: CallMemoryRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl('/api/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const reply = (await response.json()) as Partial<CallMemoryResponse>;
    return typeof reply.memory === 'string' && reply.memory.trim() !== '' ? reply.memory : null;
  } catch {
    return null;
  }
}
