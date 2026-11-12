/**
 * File: apps/web/src/features/notices/acceptableUseText.ts
 * Purpose: The acceptable-use notice's words (v1.1.0, the developer's wording), in a plain module so
 *          both the notice dialog (a client component) and the public /terms page (a server component)
 *          show exactly the same text. The same words are in docs/user-guide/using-kite.md.
 * Used by: src/features/notices/AcceptableUseNotice.tsx, src/features/legal/TermsOfUse.tsx
 * Depends on: nothing
 * Architecture: docs/implementation/v1.1.0-plan.md ("Added at approval")
 */

/** The notice's words, exactly as the developer wrote them. */
export const ACCEPTABLE_USE_TEXT =
  "Use Paramount AI in calls where AI assistance is allowed — your own meetings, client calls, practice and mock interviews. Don't use it to get hidden help in interviews, exams or assessments where outside help isn't permitted. Screen-share protection only hides Paramount AI's windows; it does nothing against monitoring or proctoring tools. Record a meeting only when everyone on it has agreed; recording or transcribing others may require their consent.";
