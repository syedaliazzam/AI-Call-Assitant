/**
 * File: packages/shared/src/speakers.ts
 * Purpose: The other person's name on a call (ADR-0093): how a typed or detected name is cleaned, so the
 *          browser and the server agree on what may be shown and sent to Claude as their speaker label.
 * Used by: apps/web/src/core/transcript/theirName.ts, apps/web/src/server/validate.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.2; ADR-0093
 */

/** Longest name kept, in characters (a first and last name with room to spare). */
export const MAX_PERSON_NAME_CHARS = 60;

/** Labels that already mean a side of the call; a "name" equal to one of them is no name. */
const RESERVED_LABELS = new Set(['you', 'them', 'interviewer', 'kite', 'paramount ai']);

/**
 * Cleans a person's name for display and for the speaker label sent to Claude: keeps letters (any
 * alphabet), spaces, apostrophes, hyphens and dots; collapses spaces; cuts at MAX_PERSON_NAME_CHARS.
 * Anything that could break the prompt's labels (quotes, brackets, colons, new lines) is removed.
 *
 * @param raw The typed or detected name.
 * @returns The clean name, or '' when nothing usable is left (or it is a reserved label such as "Them").
 * Called from: apps/web/src/core/transcript/theirName.ts; apps/web/src/server/validate.ts; tests
 */
export function cleanPersonName(raw: string | null | undefined): string {
  const kept = (raw ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}' .’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PERSON_NAME_CHARS)
    .trim();
  // A name needs at least one letter; a reserved label would make two sides look the same.
  if (!/\p{L}/u.test(kept) || RESERVED_LABELS.has(kept.toLowerCase())) return '';
  return kept;
}
