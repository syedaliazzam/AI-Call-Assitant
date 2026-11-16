/**
 * File: apps/web/src/server/prompts/preferences.ts
 * Purpose: The user's AI preferences as the prompt states them (ADR-0089): the heading that says they
 *          override the admin's general rules where they differ, and what each answer format and length
 *          means. The admin's global prompt only says "follow the user's answer format, length, tone, STAR
 *          preference and coding language"; the meaning of each value lives here, next to the value, so
 *          no admin text can redefine "short" or "paragraph".
 * Used by: src/server/prompt.ts (the session block's preference lines), src/server/prompts/contract.ts
 *          (the automatic end reminder restates the format and length)
 * Depends on: @kite/shared (SessionContext)
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * Constants only, and the same session always gives the same words, so the cached session block keeps
 * its bytes for the whole call.
 */
import 'server-only';
import type { SessionContext } from '@kite/shared';

/**
 * The heading over the user's preferences in the session block. The order of the prompt is: app
 * contract, admin global prompt, these preferences, the conversation, the end reminder. This heading
 * is what makes the user's own choices win over the admin's general rules.
 */
export const PREFERENCES_HEADING =
  'User preferences (set by the user for this session). These user preferences override the general rules above where they differ; only the app contract at the top comes before them.';

/** What each answer format means (the value the user picked in the session). */
export const FORMAT_MEANINGS: Readonly<Record<string, string>> = {
  'headline+bullets':
    'a headline of one sentence of at most 12 words (usually 5 to 10) that the user can say as it is and that answers the question directly, the gist only; then 2 to 4 short bullet points with the supporting details',
  paragraph: 'one short paragraph that starts with the direct answer, with no bullets',
  bullets:
    'only short bullet points, at most 5, with no headline; the first bullet gives the direct answer',
};

/** What each answer length means: how long the whole answer takes to say. */
export const LENGTH_MEANINGS: Readonly<Record<string, string>> = {
  short: 'the whole answer, every line together, takes about 10 to 20 seconds to say',
  medium: 'the whole answer, every line together, takes about 20 to 40 seconds to say',
  detailed: 'the whole answer, every line together, takes about 40 to 60 seconds to say',
};

/** The coding language when the session names none. */
export const DEFAULT_CODING_LANGUAGE = 'Python';

/**
 * A preference value with its meaning, for example "short (the whole answer … 10 to 20 seconds …)".
 * A value with no known meaning is written as it is.
 *
 * @param value    The value the session holds.
 * @param meanings The table of meanings.
 * @returns The words for the prompt.
 * Called from: formatPreference(), lengthPreference()
 */
function withMeaning(value: string, meanings: Readonly<Record<string, string>>): string {
  const meaning = meanings[value];
  return meaning ? `${value} (${meaning})` : value;
}

/**
 * The session's answer format with its meaning.
 *
 * @param session The session.
 * @returns For example "paragraph (one short paragraph …)".
 * Called from: preferenceLines(); src/server/prompts/contract.ts (liveEndReminder)
 */
export function formatPreference(session: SessionContext): string {
  return withMeaning(session.style.format, FORMAT_MEANINGS);
}

/**
 * The session's answer length with its meaning.
 *
 * @param session The session.
 * @returns For example "short (the whole answer … 10 to 20 seconds to say)".
 * Called from: preferenceLines(); src/server/prompts/contract.ts (liveEndReminder)
 */
export function lengthPreference(session: SessionContext): string {
  return withMeaning(session.style.length, LENGTH_MEANINGS);
}
