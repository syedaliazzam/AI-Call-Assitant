/**
 * File: packages/shared/src/keyTerms.ts
 * Purpose: One rule for a session's key terms, used everywhere they are read: the setup field
 *          (chips), speech-to-text hotwords, the transcript's display spelling, the answer request
 *          and the server's validation. A pasted list may be separated by commas, semicolons or new
 *          lines; each term is trimmed, deduplicated (ignoring case), cut to MAX_KEY_TERM_CHARS and
 *          the list to MAX_KEY_TERMS. Key terms are sanitised, never a reason for an answer to fail
 *          (v1.0.1: a pasted comma list was one 200+ character term and every answer failed).
 * Used by: apps/web/src/core/answer/warm.ts, apps/web/src/core/stt/sessionHotwords.ts,
 *          apps/web/src/core/transcript/display.ts, apps/web/src/core/storage/migrate.ts,
 *          apps/web/src/features/session-setup/KeyTermsInput.tsx, apps/web/src/server/validate.ts
 * Depends on: nothing (pure helpers)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (session setup)
 */

/** Longest key term kept, in characters (a name or a product phrase, not a sentence). */
export const MAX_KEY_TERM_CHARS = 60;

/** Most key terms kept for one session (more add little to recognition and cost tokens). */
export const MAX_KEY_TERMS = 100;

/** What separates key terms in pasted or typed text. */
const SEPARATORS = /[,;\r\n]+/;

/**
 * Turns key terms, as typed or pasted (or as an old list), into the clean list Kite uses.
 *
 * @param input A text with terms separated by commas, semicolons or new lines, or a list of such
 *              texts (each item is split too).
 * @returns The terms, trimmed, each at most MAX_KEY_TERM_CHARS characters, without duplicates
 *          (the first spelling is kept), at most MAX_KEY_TERMS, in their original order.
 * Called from: warm.ts (sessionContext), sessionHotwords.ts, display.ts (displayTerms),
 *              KeyTermsInput.tsx, validate.ts (the session schema); tests
 */
export function parseKeyTerms(input: string | readonly string[]): string[] {
  const pieces = (typeof input === 'string' ? [input] : input).flatMap((text) =>
    text.split(SEPARATORS),
  );
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of pieces) {
    // Cut at the limit, then trim again so a cut never leaves a trailing space.
    const term = piece.trim().replace(/\s+/g, ' ').slice(0, MAX_KEY_TERM_CHARS).trim();
    const key = term.toLowerCase();
    if (term === '' || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === MAX_KEY_TERMS) break;
  }
  return terms;
}

/**
 * The stored form of key terms: one term per line (what a session saves).
 *
 * @param input Key terms as typed or pasted.
 * @returns The clean terms joined by new lines ('' when there are none).
 * Called from: draft.ts (draftToInput), db.ts (schema version 7), exportData.ts (import); tests
 */
export function normaliseKeyTerms(input: string): string {
  return parseKeyTerms(input).join('\n');
}
