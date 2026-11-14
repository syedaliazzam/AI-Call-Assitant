/**
 * File: apps/web/scripts/lib/test-accounts.ts
 * Purpose: The pure parts of scripts/delete-test-accounts.ts: which emails count as end-to-end test
 *          accounts (so the script can never delete a real person's account), the SQL it runs, and
 *          removing a deleted account's lines from apps/web/.env.local. No database access here, so
 *          the rules are unit-tested.
 * Used by: scripts/delete-test-accounts.ts; tests/unit/scripts/test-accounts.test.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts), §11 (testing); ADR-0050
 */

/**
 * The two long-lived test accounts the production suites used until 14 Nov 2026. From then on the
 * suites use disposable accounts (create-e2e-user before a run, delete-test-accounts after), which
 * also match TEST_EMAIL below.
 */
export const LEGACY_TEST_EMAILS = ['kite-e2e@example.com', 'kite-e2e-admin@example.com'] as const;

/**
 * What a test account's email looks like: `kite-e2e`, optional `-word` parts, at example.com (a
 * domain reserved for examples, so no real person can have such an address). Anything else is
 * refused, whatever the environment says.
 */
const TEST_EMAIL = /^kite-e2e(?:-[a-z0-9]+)*@example\.com$/;

/**
 * Whether an email is an end-to-end test account's.
 *
 * @param email The address (any case).
 * @returns True only for kite-e2e…@example.com addresses.
 * Called from: targetEmails(); tests
 */
export function isTestAccountEmail(email: string): boolean {
  return TEST_EMAIL.test(email.trim().toLowerCase());
}

/**
 * The emails the script acts on: the two legacy test accounts plus any test account named in
 * .env.local (KITE_E2E_EMAIL, KITE_E2E_ADMIN_EMAIL), lower-case, without duplicates.
 *
 * @param fromEnv The values of KITE_E2E_EMAIL and KITE_E2E_ADMIN_EMAIL (undefined when unset).
 * @returns `emails` to act on, and `refused`: how many env values were not test addresses (never
 *          acted on; the script says so without printing them).
 * Called from: scripts/delete-test-accounts.ts main(); tests
 */
export function targetEmails(fromEnv: readonly (string | undefined)[]): {
  emails: string[];
  refused: number;
} {
  const emails = new Set<string>(LEGACY_TEST_EMAILS);
  let refused = 0;
  for (const value of fromEnv) {
    const email = (value ?? '').trim().toLowerCase();
    if (!email) continue;
    if (isTestAccountEmail(email)) emails.add(email);
    else refused += 1;
  }
  return { emails: [...emails], refused };
}

/** One statement of the deletion, as printed before anything runs. */
export interface PlannedStatement {
  /** The table it touches. */
  table: string;
  /** What it does, in SQL; `$ids` is the list of the test accounts' ids (never printed). */
  sql: string;
}

/**
 * The statements the script runs with --prod, in order, inside one transaction. Every table that
 * holds a user id is listed explicitly (most would also go by ON DELETE CASCADE), so the printed
 * counts show exactly what is removed. drive_company only loses the "connected by" link, and only
 * if a test account had connected the company Drive.
 */
export const DELETION_PLAN: readonly PlannedStatement[] = [
  {
    table: 'verification',
    sql: `DELETE FROM verification WHERE identifier LIKE 'desktop-link:%' AND split_part(value, '|', 1) = ANY($ids)`,
  },
  { table: 'session', sql: 'DELETE FROM session WHERE user_id = ANY($ids)' },
  { table: 'account', sql: 'DELETE FROM account WHERE user_id = ANY($ids)' },
  { table: 'usage_day', sql: 'DELETE FROM usage_day WHERE user_id = ANY($ids)' },
  { table: 'call_record', sql: 'DELETE FROM call_record WHERE user_id = ANY($ids)' },
  { table: 'google_drive', sql: 'DELETE FROM google_drive WHERE user_id = ANY($ids)' },
  { table: 'drive_member', sql: 'DELETE FROM drive_member WHERE user_id = ANY($ids)' },
  { table: 'drive_notification', sql: 'DELETE FROM drive_notification WHERE user_id = ANY($ids)' },
  {
    table: 'drive_company',
    sql: 'UPDATE drive_company SET connected_by = NULL WHERE connected_by = ANY($ids)',
  },
  { table: 'user', sql: 'DELETE FROM "user" WHERE id = ANY($ids)' },
];

/**
 * Removes the credential lines of the given test-account prefixes from .env.local text, with the
 * comment line create-e2e-user.ts wrote above them, so create-e2e-user can make a fresh account
 * next time. Other lines are kept exactly.
 *
 * @param text     The file's contents.
 * @param prefixes For example ['KITE_E2E', 'KITE_E2E_ADMIN'].
 * @returns The new contents and how many lines were removed.
 * Called from: scripts/delete-test-accounts.ts main(); tests
 */
export function removeTestAccountLines(
  text: string,
  prefixes: readonly string[],
): { text: string; removed: number } {
  const credential = new RegExp(`^(?:${prefixes.join('|')})_(?:EMAIL|PASSWORD)=`);
  const comment = /^# Production end-to-end test account \(tests\/e2e-prod\)/;
  const lines = text.split('\n');
  // A comment goes only with the credential lines right under it (another account's stays).
  const kept = lines.filter(
    (line, index) =>
      !credential.test(line) && !(comment.test(line) && credential.test(lines[index + 1] ?? '')),
  );
  return { text: kept.join('\n'), removed: lines.length - kept.length };
}
