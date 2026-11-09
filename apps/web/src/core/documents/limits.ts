/**
 * File: apps/web/src/core/documents/limits.ts
 * Purpose: Size limits for session documents: the largest file Kite will read, the most text
 *          one document may add, and the most text a session may hold in total; plus a check
 *          that says whether a new document fits and how much room is left.
 * Used by: src/core/documents/extract.ts (file size); the Create/Edit session wizard (Day 3
 *          Stage 3: room left, refusing a document that does not fit); server/validate.ts uses
 *          the same session cap (Stage 5)
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (documents ≤ 500k characters
 *               per session, ADR-0067); day-03-sessions.md Stage 2
 */

/**
 * Largest file Kite reads, in bytes (20 MB). Reading happens on the user's laptop; past this,
 * PDF parsing gets slow and memory-heavy, and such files are almost always scanned images or
 * slide decks with little text anyway.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Most document text one session may hold, in characters (architecture §7.2, ADR-0067). All of it
 * is sent to the fast model in the cached session block of every live answer. The official docs put
 * 1M tokens at about 2.5M characters, so 500,000 characters is at most about 200,000 tokens: a fifth
 * of the 1M-token context of claude-haiku-5-5 and claude-sonnet-5-5, leaving room for the rules, the
 * conversation and the answer. As UTF-8 it is at most about 1.5 MB, inside the 4 MB request cap.
 */
export const MAX_SESSION_CHARS = 500_000;

/**
 * Most text one document may add, in characters. Half the session cap, so one long document cannot
 * take all of it and a second one (for example a price list) still fits.
 */
export const MAX_DOCUMENT_CHARS = 250_000;

/**
 * Above this many characters the wizard warns that the first answer may be slower: the first
 * request of a call writes the whole document block to Claude's cache, and Claude reads it all
 * before the first word (ADR-0067).
 */
export const LARGE_SESSION_CHARS = 400_000;

/** The wizard's warning above LARGE_SESSION_CHARS. */
export const LARGE_SESSION_WARNING = 'Very large documents can slow the first answer.';

/** Whether a document fits, from fitsInSession(). */
export type FitResult =
  | {
      /** True: the document fits. */
      ok: true;
    }
  | {
      /** It does not fit. */
      ok: false;
      /**
       * Why: 'document-too-long' (over MAX_DOCUMENT_CHARS on its own) or 'session-full' (it
       * would take the session over MAX_SESSION_CHARS).
       */
      reason: 'document-too-long' | 'session-full';
      /** A sentence for the user, with the numbers. */
      message: string;
    };

/**
 * How much document text a session can still take.
 *
 * @param usedChars Characters the session's documents already hold.
 * @returns Characters left (0 when the session is full or over).
 * Called from: the wizard's "room left" display (Day 3 Stage 3); fitsInSession(); tests
 */
export function roomLeft(usedChars: number): number {
  return Math.max(0, MAX_SESSION_CHARS - usedChars);
}

/**
 * Checks whether a new document fits: on its own (MAX_DOCUMENT_CHARS) and in the session
 * (MAX_SESSION_CHARS).
 *
 * @param newChars  Characters of the new document.
 * @param usedChars Characters the session's documents already hold.
 * @returns { ok: true }, or why it does not fit with a message for the user.
 * Called from: the wizard, before storing a document (Day 3 Stage 3); tests
 */
export function fitsInSession(newChars: number, usedChars: number): FitResult {
  const format = (n: number) => n.toLocaleString('en-US');
  if (newChars > MAX_DOCUMENT_CHARS) {
    return {
      ok: false,
      reason: 'document-too-long',
      message: `This document has ${format(newChars)} characters of text; one document can have at most ${format(MAX_DOCUMENT_CHARS)}. Remove pages Paramount AI does not need, then add it again.`,
    };
  }
  if (newChars > roomLeft(usedChars)) {
    return {
      ok: false,
      reason: 'session-full',
      message: `This document has ${format(newChars)} characters, but the session has room for only ${format(roomLeft(usedChars))} more (${format(MAX_SESSION_CHARS)} in total). Remove another document first.`,
    };
  }
  return { ok: true };
}
