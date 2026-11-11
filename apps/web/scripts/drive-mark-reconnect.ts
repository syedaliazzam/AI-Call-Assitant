/**
 * File: apps/web/scripts/drive-mark-reconnect.ts
 * Purpose: One-off, after switching the Google OAuth client to the team's Google Cloud project
 *          (docs/deploy/google-drive.md): marks every Google Drive connection made with the old client
 *          as "reconnect", so each person sees "Reconnect Google Drive" at once instead of after a
 *          failed upload. Only google_drive.status (and updated_at) changes: the folder, the switches,
 *          the team list, the encrypted token and every drive_notification row stay, and the devices'
 *          queued uploads wait and carry on after the reconnect.
 *          Only rows whose connected_at is before --connected-before (the time the new deployment went
 *          live) are touched, so a person who already reconnected with the new client is left alone.
 *          Without --prod it only counts (read-only); with --prod it writes (ADR-0050). Prints counts
 *          only: never an account id, email, folder or token.
 *          Usage: pnpm --filter web drive-mark-reconnect --connected-before 2026-11-11T19:49:10Z [--prod]
 * Used by: the developer, once, for the switch to the team's Google project
 * Depends on: src/server/db.ts, src/server/schema.ts (googleDrive), scripts/lib/require-prod.ts
 * Architecture: ADR-0072 (the 'reconnect' status), ADR-0050 (one database, --prod to write)
 */
import { parseArgs } from 'node:util';
import { and, count, eq, gte, lt, ne } from 'drizzle-orm';
import { db } from '@/server/db';
import { googleDrive } from '@/server/schema';
import { PROD_FLAG, productionRefusal } from './lib/require-prod';

/** The script's name in printed lines. */
const SCRIPT = 'drive-mark-reconnect';

/**
 * Counts google_drive rows matching a condition.
 *
 * @param where The condition (undefined: every row).
 * @returns The number of rows.
 * Called from: main()
 */
async function countRows(where?: ReturnType<typeof and>): Promise<number> {
  const rows = await db.select({ n: count() }).from(googleDrive).where(where);
  return rows[0]?.n ?? 0;
}

/**
 * Shows what would change, and changes it when --prod was given.
 *
 * @returns Nothing; sets a non-zero exit code on bad arguments.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { 'connected-before': { type: 'string' }, prod: { type: 'boolean' } },
  });
  const cutoff = new Date(values['connected-before'] ?? '');
  if (Number.isNaN(cutoff.getTime())) {
    console.error(`${SCRIPT}: give --connected-before <ISO time the new deployment went live>`);
    process.exitCode = 1;
    return;
  }
  console.info(`${SCRIPT}: database: production; cutoff ${cutoff.toISOString()}`);

  // The rows to change: still 'connected' and connected with the old client (before the cutoff).
  const target = and(eq(googleDrive.status, 'connected'), lt(googleDrive.connectedAt, cutoff));
  const total = await countRows();
  const already = await countRows(eq(googleDrive.status, 'reconnect'));
  const newer = await countRows(
    and(eq(googleDrive.status, 'connected'), gte(googleDrive.connectedAt, cutoff)),
  );
  const toChange = await countRows(target);
  const other = await countRows(
    and(ne(googleDrive.status, 'connected'), ne(googleDrive.status, 'reconnect')),
  );
  console.info(`${SCRIPT}: google_drive rows: ${total}`);
  console.info(`${SCRIPT}:   will be set to 'reconnect': ${toChange}`);
  console.info(`${SCRIPT}:   already 'reconnect' (unchanged): ${already}`);
  console.info(`${SCRIPT}:   connected after the cutoff (unchanged): ${newer}`);
  if (other > 0) console.info(`${SCRIPT}:   other status (unchanged): ${other}`);

  if (productionRefusal(process.argv)) {
    console.info(`${SCRIPT}: preview only, nothing changed. Run again with ${PROD_FLAG} to apply.`);
    return;
  }
  // UPDATE google_drive SET status = 'reconnect', updated_at = now()
  //   WHERE status = 'connected' AND connected_at < <cutoff>
  const changed = await db
    .update(googleDrive)
    .set({ status: 'reconnect' })
    .where(target)
    .returning({ userId: googleDrive.userId });
  console.info(`${SCRIPT}: set to 'reconnect': ${changed.length} row(s)`);
}

main().catch((error: unknown) => {
  console.error(`${SCRIPT} failed: ${error instanceof Error ? error.name : 'unknown error'}`);
  process.exitCode = 1;
});
