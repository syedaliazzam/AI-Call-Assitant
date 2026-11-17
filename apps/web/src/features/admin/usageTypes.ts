/**
 * File: apps/web/src/features/admin/usageTypes.ts
 * Purpose: Shapes shared by the Admin → Usage screen (client components) and its server action
 *          (v1.0.2, ADR-0036). Counts only: nothing here carries text from calls or answers.
 * Used by: src/features/admin/UsageTable.tsx, src/features/admin/DailyLimitForm.tsx,
 *          app/(app)/admin/usage/actions.ts, app/(app)/admin/usage/page.tsx
 * Depends on: nothing (types only)
 * Architecture: docs/decisions/ADR-0036-daily-limit-and-usage-counts.md
 */

/** One user's row on the usage table (a copy of the server's UsageRow, safe for the browser). */
export interface UsageTableRow {
  /** The account's id. */
  userId: string;
  /** Display name. */
  name: string;
  /** Login email. */
  email: string;
  /** Claude requests today (UTC). */
  today: number;
  /** Claude requests over the last 7 days, today included. */
  lastDays: number;
  /** ADR-0095: of today's requests, how many went to Groq. */
  groqToday: number;
  /** ADR-0095: of the last 7 days' requests, how many went to Groq. */
  groqLastDays: number;
}

/** The daily-limit form's state after a submit (useActionState). Never thrown. */
export type DailyLimitState =
  | {
      /** Nothing submitted yet. */
      status: 'idle';
    }
  | {
      /** The new limit was saved. */
      status: 'saved';
      /** The limit now in force. */
      limit: number;
    }
  | {
      /** It was not saved. */
      status: 'error';
      /** What to show under the field. */
      error: string;
    };
