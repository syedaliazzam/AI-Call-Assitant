/**
 * File: apps/web/src/core/storage/migrate.ts
 * Purpose: Turns values stored before parity Phase 2 into today's: session types Sales, Support
 *          and Internal become Regular, and the "friendly" tone becomes "simple". Used both when
 *          a device's database upgrades and when an older export file is imported, so the two
 *          can never disagree. v1.1.0 (ADR-0041): finds a session's separate calls in older data,
 *          which never recorded them.
 * Used by: src/core/storage/db.ts (version 4), src/core/storage/exportData.ts
 * Depends on: src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029
 */
import type { AnswerStyle, LessonScope, SessionType } from './types';

/**
 * A gap this long with nothing said and nothing asked means a new call (v1.1.0). Older data has no
 * record of its calls, so this is an estimate: longer than any pause inside a call, and shorter than
 * the time between two real calls of one session.
 */
export const CALL_GAP_MS = 30 * 60 * 1000;

/** One call found in older data. */
export interface FoundCall {
  /** When its first thing happened (Unix ms). */
  start: number;
  /** When its last thing happened (Unix ms). */
  end: number;
}

/**
 * Splits a session's activity into calls, wherever nothing happened for CALL_GAP_MS.
 *
 * @param times When things happened (Unix ms), in any order.
 * @returns The calls, oldest first ([] for no activity).
 * Called from: db.ts (version 8 upgrade); tests
 */
export function findCalls(times: readonly number[]): FoundCall[] {
  const calls: FoundCall[] = [];
  for (const time of [...times].sort((a, b) => a - b)) {
    const last = calls.at(-1);
    if (last && time - last.end < CALL_GAP_MS) last.end = time;
    else calls.push({ start: time, end: time });
  }
  return calls;
}

/**
 * The call a moment belongs to.
 *
 * @param calls The calls, oldest first (findCalls()).
 * @param time  The moment (Unix ms).
 * @returns When that call started, or the moment itself when it comes before every call.
 * Called from: db.ts (version 8 upgrade); tests
 */
export function callStartOf(calls: readonly FoundCall[], time: number): number {
  return calls.findLast((call) => call.start <= time)?.start ?? time;
}

/**
 * Today's session type for a stored value.
 *
 * @param type A stored type, old or new.
 * @returns 'interview' and 'mock' as they are; anything else (sales, support, internal) 'regular'.
 * Called from: db.ts (upgrade); exportData.ts (import)
 */
export function currentSessionType(type: string): SessionType {
  return type === 'interview' || type === 'mock' ? type : 'regular';
}

/**
 * Today's lesson scope for a stored value.
 *
 * @param scope A stored scope, old or new.
 * @returns 'all', or the session type it now means.
 * Called from: db.ts (upgrade); exportData.ts (import)
 */
export function currentLessonScope(scope: string): LessonScope {
  return scope === 'all' ? 'all' : currentSessionType(scope);
}

/**
 * Today's tone for a stored value.
 *
 * @param tone A stored tone, old or new.
 * @returns The tone; "friendly", which no longer exists, becomes "simple".
 * Called from: db.ts (upgrade); exportData.ts (import)
 */
export function currentTone(tone: string): AnswerStyle['tone'] {
  return tone === 'professional' || tone === 'technical' ? tone : 'simple';
}
