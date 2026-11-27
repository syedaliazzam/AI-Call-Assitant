/**
 * File: apps/web/src/features/dashboard/duplicate.ts
 * Purpose: ADR-0129: the one Duplicate every session menu uses (the dashboard's cards, the desktop app's "Your
 *          sessions" list, the session page): a copy of the session's setup named "Copy of <name>", made by
 *          core/storage/sessions.ts duplicateSession() and synced to the account like any new session.
 * Used by: src/features/dashboard/Dashboard.tsx, src/features/home/Launcher.tsx (through LauncherSessions),
 *          src/features/review/SessionReview.tsx
 * Depends on: src/core/storage/sessions.ts (duplicateSession), ./sessionCardParts.ts (copyName)
 * Architecture: docs/decisions/ADR-0129-duplicate-session-copies-setup.md
 */
import { duplicateSession } from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
import { copyName } from './sessionCardParts';

/**
 * Duplicates a session as "Copy of <name>".
 *
 * @param session The session to copy.
 * @returns The copy.
 * @throws Error('SESSION_NOT_FOUND') when the session no longer exists on this device.
 * Called from: Dashboard.tsx (duplicate), Launcher.tsx (duplicate), SessionReview.tsx (Duplicate); tests
 */
export function duplicateAsCopy(session: Session): Promise<Session> {
  return duplicateSession(session.id, Date.now(), { name: copyName(session) });
}
