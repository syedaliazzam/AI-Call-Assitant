/**
 * File: apps/web/src/core/storage/migrate.ts
 * Purpose: Turns values stored before parity Phase 2 into today's: session types Sales, Support
 *          and Internal become Regular, and the "friendly" tone becomes "simple". Used both when
 *          a device's database upgrades and when an older export file is imported, so the two
 *          can never disagree.
 * Used by: src/core/storage/db.ts (version 4), src/core/storage/exportData.ts
 * Depends on: src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029
 */
import type { AnswerStyle, LessonScope, SessionType } from './types';

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
