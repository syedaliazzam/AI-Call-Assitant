/**
 * File: apps/web/scripts/delete-test-accounts.ts
 * Purpose: Deletes the end-to-end test accounts and everything stored for them: sign-in sessions,
 *          the password credential, daily request counts, synced call data, Google Drive rows and
 *          desktop link codes. It acts only on kite-e2e…@example.com addresses (the two legacy
 *          accounts, plus a disposable one named in .env.local), never on anyone else.
 *          Without --prod it is read-only: it prints the SQL it would run and the row counts per
 *          table. With --prod it runs the same statements in one transaction, prints the rows
 *          removed, and takes the deleted accounts' KITE_E2E_* lines out of apps/web/.env.local.
 *          Prints roles, dates and counts only: never an email, id or password.
 *          Usage: pnpm --filter web delete-test-accounts          (dry run: SQL and counts)
 *                 pnpm --filter web delete-test-accounts --prod   (delete)
 * Used by: the developer: once for the two legacy accounts, then after each production e2e run
 * Depends on: src/server/db.ts, src/server/schema.ts, scripts/lib/test-accounts.ts,
 *             scripts/lib/require-prod.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts), §11 (testing);
 *               ADR-0050 (one database, --prod to write)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, count, inArray, like, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '@/server/db';
import {
  account,
  callRecord,
  driveCompany,
  driveMember,
  driveNotification,
  googleDrive,
  session,
  usageDay,
  user,
  verification,
} from '@/server/schema';
import { PROD_FLAG, productionRefusal } from './lib/require-prod';
import { DELETION_PLAN, removeTestAccountLines, targetEmails } from './lib/test-accounts';

/** The script's name in printed lines. */
const SCRIPT = 'delete-test-accounts';

/** Where create-e2e-user.ts wrote the test accounts' credentials (git-ignored). */
const ENV_FILE = path.join(process.cwd(), '.env.local');

/**
 * The condition for each planned table, in DELETION_PLAN order, for the given account ids.
 *
 * @param ids The test accounts' ids.
 * @returns table name → [table, where].
 * Called from: main()
 */
function conditions(ids: string[]): Record<string, [PgTable, SQL | undefined]> {
  /**
   * `column = ANY(ids)`.
   *
   * @param column A column holding a user id.
   * @returns The condition.
   */
  const owned = (column: PgColumn) => inArray(column, ids);
  return {
    // Desktop link codes store '<userId>|<sessionId>' as their value (server/desktopLink.ts).
    verification: [
      verification,
      and(
        like(verification.identifier, 'desktop-link:%'),
        inArray(sql`split_part(${verification.value}, '|', 1)`, ids),
      ),
    ],
    session: [session, owned(session.userId)],
    account: [account, owned(account.userId)],
    usage_day: [usageDay, owned(usageDay.userId)],
    call_record: [callRecord, owned(callRecord.userId)],
    google_drive: [googleDrive, owned(googleDrive.userId)],
    drive_member: [driveMember, owned(driveMember.userId)],
    drive_notification: [driveNotification, owned(driveNotification.userId)],
    drive_company: [driveCompany, owned(driveCompany.connectedBy)],
    user: [user, owned(user.id)],
  };
}

/**
 * Counts the rows a condition matches.
 *
 * @param table The table.
 * @param where The condition.
 * @returns The number of rows.
 * Called from: main()
 */
async function countRows(table: PgTable, where: SQL | undefined): Promise<number> {
  const rows = await db.select({ n: count() }).from(table).where(where);
  return rows[0]?.n ?? 0;
}

/**
 * Shows the plan and counts, and deletes when --prod was given.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const write = productionRefusal(process.argv) === null;
  console.info(`${SCRIPT}: database: production; ${write ? 'DELETING' : 'dry run (read-only)'}`);

  const { emails, refused } = targetEmails([
    process.env.KITE_E2E_EMAIL,
    process.env.KITE_E2E_ADMIN_EMAIL,
  ]);
  if (refused > 0) {
    console.warn(
      `${SCRIPT}: ${refused} address(es) in .env.local are not test addresses; ignored.`,
    );
  }

  const found = await db
    .select({ id: user.id, role: user.role, banned: user.banned, createdAt: user.createdAt })
    .from(user)
    .where(inArray(user.email, emails));
  console.info(
    `\nTest accounts found: ${found.length} (of ${emails.length} test addresses checked)`,
  );
  found.forEach((row, index) => {
    const state = row.banned ? 'disabled' : 'enabled';
    console.info(
      `  ${index + 1}. role ${row.role ?? 'user'}, ${state}, created ${row.createdAt.toISOString().slice(0, 10)}`,
    );
  });
  if (found.length === 0) {
    console.info('Nothing to delete.');
    return;
  }

  const ids = found.map((row) => row.id);
  const where = conditions(ids);
  console.info('\nPlan (one transaction; $ids = the accounts above):');
  for (const step of DELETION_PLAN) {
    const [table, condition] = where[step.table]!;
    const rows = await countRows(table, condition);
    console.info(`  ${String(rows).padStart(6)} row(s)  ${step.sql}`);
  }

  if (!write) {
    console.info(`\nDry run: nothing changed. Run again with ${PROD_FLAG} to delete.`);
    return;
  }

  // One HTTP batch is one transaction on Neon: either every statement applies or none does.
  const statements = DELETION_PLAN.map((step) => {
    const [table, condition] = where[step.table]!;
    if (step.table === 'drive_company') {
      return db
        .update(driveCompany)
        .set({ connectedBy: null })
        .where(condition)
        .returning({ id: driveCompany.id });
    }
    return db
      .delete(table)
      .where(condition)
      .returning({ one: sql<number>`1` });
  });
  const results = await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
  console.info('\nDone:');
  DELETION_PLAN.forEach((step, index) => {
    const changed = (results[index] as unknown[]).length;
    console.info(`  ${String(changed).padStart(6)} row(s)  ${step.table}`);
  });

  // The suites read their credentials from .env.local; drop the deleted accounts' lines so
  // create-e2e-user can write a fresh account before the next run.
  const prefixes = [
    ['KITE_E2E', process.env.KITE_E2E_EMAIL],
    ['KITE_E2E_ADMIN', process.env.KITE_E2E_ADMIN_EMAIL],
  ]
    .filter(([, email]) => email && emails.includes(email.trim().toLowerCase()))
    .map(([prefix]) => prefix!);
  if (prefixes.length > 0) {
    const cleaned = removeTestAccountLines(readFileSync(ENV_FILE, 'utf8'), prefixes);
    writeFileSync(ENV_FILE, cleaned.text);
    console.info(`Removed ${cleaned.removed} test-account line(s) from apps/web/.env.local.`);
  }
}

main().catch((error: unknown) => {
  // The error's name only: database messages can quote parameters (ids, emails).
  console.error(`${SCRIPT}: failed (${error instanceof Error ? error.name : 'unknown'})`);
  process.exitCode = 1;
});
