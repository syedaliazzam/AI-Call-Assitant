/**
 * File: apps/web/src/core/documents/limits.ts
 * Purpose: Size limits for session documents: the largest file Kite will read, the most text
 *          one document may add, and the most text a session may hold in total; plus a check
 *          that says whether a new document fits and how much room is left.
 * Used by: src/core/documents/extract.ts (file size); the Create/Edit session wizard (Day 3
 *          Stage 3: room left, refusing a document that does not fit, the over-limit warning);
 *          features/library/UploadBox.tsx (the size shown); server/validate.ts uses the same
 *          session cap (Stage 5)
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (documents ≤ 500k characters
 *               per session, ADR-0067); ADR-0117 (20 MB per file, no warning under 500k);
 *               day-03-sessions.md Stage 2
 *
 * Two independent gates (ADR-0117). They measure different things and never stand in for each other:
 *   1. File size (MAX_FILE_BYTES, 20 MB), checked once when a file is read, before any text is
 *      taken out of it. It protects the user's laptop, not the model.
 *   2. Extracted text (MAX_SESSION_CHARS, 500,000 characters), checked on the text the files gave,
 *      for all of a session's documents together. It is what reaches the model.
 * So a 20 MB file whose text is under 500,000 characters passes both with no warning, and a small
 * file whose text would take the session past 500,000 is refused by the second gate.
 */

/** Largest file Kite reads, in megabytes (ADR-0117). Shown to the user by the upload box. */
export const MAX_FILE_MB = 20;

/**
 * Largest file Kite reads, in bytes (20 MB, as before ADR-0117; now named). Gate 1 only: it is checked on
 * the file before reading, and says nothing about how much text the file holds (gate 2 checks that).
 * Reading happens on the user's laptop; past this, PDF parsing gets slow and memory-heavy, and such
 * files are almost always scanned images or slide decks with little text anyway.
 */
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/**
 * Most document text one session may hold, in characters (architecture §7.2, ADR-0067). Gate 2:
 * a hard limit, not only a warning. The wizard refuses a document that would pass it
 * (fitsInSession()) and server/validate.ts rejects a request over it, so the whole document set,
 * which /api/summary reads in one request, stays inside the model's context window: the official
 * docs put 1M tokens at about 2.5M characters, so 500,000 characters is at most about 200,000
 * tokens, a fifth of the 1M-token context of claude-haiku-5-5 and claude-sonnet-5-5. Live answers
 * have a second, tighter hard limit of their own (server/budget.ts: MAX_ANSWER_INPUT_TOKENS,
 * 100,000 tokens a request). As UTF-8 it is at most about 1.5 MB, inside the 4 MB request cap.
 */
export const MAX_SESSION_CHARS = 500_000;

/**
 * Most text one document may add, in characters. 1.5.1 (ADR-0069): the whole session cap (was half),
 * so one long handbook fits; it is stored as parts of at most 250,000 characters (core/documents/parts.ts),
 * each small enough to sync as one record.
 */
export const MAX_DOCUMENT_CHARS = 500_000;

/**
 * The wizard's warning when a session's extracted document text is over MAX_SESSION_CHARS
 * (ADR-0117). It replaces ADR-0067's cost warning above 280,000 characters: live answers no longer
 * send every document in full (server/budget.ts keeps each one under 100,000 tokens), so that
 * warning's "5× more" no longer happened.
 */
export const OVER_LIMIT_WARNING = `Documents exceed the ${MAX_SESSION_CHARS.toLocaleString('en-US')}-character limit — remove some to continue`;

/**
 * Whether a session's documents hold more text than MAX_SESSION_CHARS allows. The wizard refuses
 * documents that would get here, so this is the backstop for a draft that already is (for example
 * one saved by an older version): the wizard then shows OVER_LIMIT_WARNING and will not go on.
 *
 * @param usedChars Characters of extracted text the session's documents hold, all together.
 * @returns True above MAX_SESSION_CHARS; false at or under it.
 * Called from: documentWarnings(), SessionWizard.tsx (Next and Save); tests
 */
export function overSessionLimit(usedChars: number): boolean {
  return usedChars > MAX_SESSION_CHARS;
}

/**
 * The warnings the wizard shows for a session's document size. Under the limit there is none,
 * however large the files were (file size is gate 1's business, checked when each file was read).
 *
 * @param usedChars Characters of extracted text the session's documents hold, all together.
 * @returns [OVER_LIMIT_WARNING] above MAX_SESSION_CHARS; [] at or under it.
 * Called from: DetailsStep.tsx; tests
 */
export function documentWarnings(usedChars: number): string[] {
  return overSessionLimit(usedChars) ? [OVER_LIMIT_WARNING] : [];
}

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
