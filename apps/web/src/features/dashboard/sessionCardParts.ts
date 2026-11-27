/**
 * File: apps/web/src/features/dashboard/sessionCardParts.ts
 * Purpose: The words and the letter tile a session card shows (spec S3), as plain functions. The tile is
 *          a letter with a colour worked out from the name: no logo service, so company names never
 *          leave this device.
 *          ADR-0129: a copy's own name is its title (sessionCardTitle), and copyName() words it.
 * Used by: src/features/dashboard/SessionCard.tsx, src/features/dashboard/Dashboard.tsx,
 *          src/features/dashboard/duplicate.ts, src/features/home/LauncherSessions.tsx
 * Depends on: src/core/session/callLength.ts, src/core/storage/types.ts,
 *             src/features/session-setup/labels.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S3)
 */
import { callLength } from '@/core/session/callLength';
import type { Session, SessionStatus } from '@/core/storage/types';
import { SESSION_TYPE_LABELS } from '@/features/session-setup/labels';

/** How many tile colours the theme has (--k-tile-0 to --k-tile-7). */
export const TILE_COLOURS = 8;

/**
 * A card's title. A regular call shows its title (the topic), and the others the company. ADR-0129: a session
 * with its own name (a copy: "Copy of Acme") shows that name.
 *
 * @param session The session.
 * @returns The title, or "<Type> call" when it has none.
 * Called from: SessionCard.tsx, home/LauncherSessions.tsx, review/SessionReview.tsx, copyName(); tests
 */
export function sessionCardTitle(
  session: Pick<Session, 'type' | 'company' | 'role' | 'name'>,
): string {
  const own = session.name?.trim();
  if (own) return own;
  const main = session.type === 'regular' ? session.role : session.company;
  return main.trim() || session.company.trim() || `${SESSION_TYPE_LABELS[session.type]} call`;
}

/**
 * ADR-0129: the name Duplicate gives a copy: "Copy of" and the title the original's card shows.
 *
 * @param session The original.
 * @returns For example "Copy of Acme" ("Copy of Pilot review" for a regular call).
 * Called from: features/dashboard/duplicate.ts; tests
 */
export function copyName(session: Pick<Session, 'type' | 'company' | 'role' | 'name'>): string {
  return `Copy of ${sessionCardTitle(session)}`;
}

/**
 * The line under a card's title.
 *
 * @param session The session.
 * @returns The company for a regular call, the role otherwise ('' when there is none, or when it would
 *          only repeat the title).
 * Called from: SessionCard.tsx; tests
 */
export function sessionCardLine(
  session: Pick<Session, 'type' | 'company' | 'role' | 'name'>,
): string {
  const line = (session.type === 'regular' ? session.company : session.role).trim();
  return line === sessionCardTitle(session) ? '' : line;
}

/**
 * The letter tile for a name: its first letter, and a colour that is always the same for that name.
 *
 * @param name The name on the card.
 * @returns The letter and the colour's number (0 to TILE_COLOURS - 1).
 * Called from: SessionCard.tsx; tests
 */
export function letterTile(name: string): { letter: string; colour: number } {
  const clean = name.trim();
  let hash = 0;
  // A small, stable string hash; it only has to spread names across a few colours.
  for (const character of clean.toLowerCase()) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003;
  }
  return { letter: (clean.charAt(0) || '?').toUpperCase(), colour: hash % TILE_COLOURS };
}

/**
 * The muted line under a card's status.
 *
 * @param session The session.
 * @param status  Its shown status.
 * @param answers How many answers it has.
 * @returns "Not started yet", "6m 53s · 12 answers", or as much of that as is known.
 * Called from: SessionCard.tsx; tests
 */
export function sessionUsageLine(
  session: Pick<Session, 'lastCallMs' | 'lastActiveAt'>,
  status: SessionStatus,
  answers: number,
): string {
  if (status === 'not-started' && session.lastActiveAt === null) return 'Not started yet';
  const parts: string[] = [];
  const length = callLength(session.lastCallMs);
  if (length) parts.push(length);
  if (answers > 0) parts.push(`${answers} ${answers === 1 ? 'answer' : 'answers'}`);
  if (parts.length > 0) return parts.join(' · ');
  return status === 'live' ? 'Call in progress' : 'No answers yet';
}
