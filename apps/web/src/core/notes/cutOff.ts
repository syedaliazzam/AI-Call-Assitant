/**
 * File: apps/web/src/core/notes/cutOff.ts
 * Purpose: The words shown with AI notes whose reply reached its length limit (CallNotes.cutOff, ADR-0121),
 *          in one place so the session review, the Meetings notes tab and the notes PDF say the same thing.
 * Used by: src/features/review/ReviewSections.tsx, src/features/meetings/NotesTab.tsx,
 *          src/core/drive/callFiles.ts (notesParagraphs)
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0121-bugfix-batch-1-cut-offs-groq-voice-image.md §1
 */

/**
 * ADR-0121: the notes stop early. What is shown is complete up to the cut; the sections after it (in the
 * order summary, questions, next steps, unclear parts, lessons) may be missing or shorter.
 */
export const NOTES_CUT_OFF_TEXT =
  'These notes stop early: the reply reached its length limit, so later questions, next steps, unclear parts or lessons may be missing.';
