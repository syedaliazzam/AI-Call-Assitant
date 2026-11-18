/**
 * File: apps/web/scripts/drive-stuck-uploads.ts
 * Purpose: Read-only count of calls whose Google Drive upload is still waiting (ADR-0106). Call records
 *          are stored encrypted, so the server cannot see a call's upload state directly; what it can see
 *          is each call's "saved" email record (drive_notification), which stays 'collecting' until every
 *          file it waits for is in Drive:
 *          - "<session>~<call start>~recording" rows wait for the call's recording (email 1 already went
 *            with the transcript and notes);
 *          - the other rows wait for the call's first files (transcript, notes) and recording.
 *          A call whose device never reported anything (the app closed before its first file reached
 *          Drive) has no row yet, so it is not counted here: the desktop app's own queue still has it.
 *          Prints ids, counts, states and ages only: never an email, a name, a title or any content.
 *          Never writes.
 *          Usage: pnpm --filter web drive-stuck-uploads [--older-than-minutes 30]
 * Used by: the developer (calls stuck after the app was closed right after a call, ADR-0106)
 * Depends on: src/server/db.ts, src/server/schema.ts (driveNotification, driveCompany, driveMember)
 * Architecture: ADR-0072, ADR-0077 (two-step emails), ADR-0106
 */
import { parseArgs } from 'node:util';
import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/server/db';
import { driveCompany, driveMember, driveNotification } from '@/server/schema';

/** The script's name in printed lines. */
const SCRIPT = 'drive-stuck-uploads';

/** The suffix of a call's "Recording saved" record key (server/google/report.ts RECORDING_KEY_SUFFIX). */
const RECORDING_SUFFIX = '~recording';

/**
 * Prints the waiting calls, by account.
 *
 * @returns Nothing; sets a non-zero exit code on bad arguments.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'older-than-minutes': { type: 'string' } } });
  const minutes = Number(values['older-than-minutes'] ?? '30');
  if (!Number.isFinite(minutes) || minutes < 0) {
    console.error(`${SCRIPT}: --older-than-minutes must be a number`);
    process.exitCode = 1;
    return;
  }
  const cutoff = new Date(Date.now() - minutes * 60_000);
  console.info(`${SCRIPT}: database: production (read-only); waiting longer than ${minutes} min`);

  // SELECT user_id, session_id, created_at FROM drive_notification
  //   WHERE status = 'collecting' AND created_at < <cutoff>
  const rows = await db
    .select({
      userId: driveNotification.userId,
      key: driveNotification.sessionId,
      createdAt: driveNotification.createdAt,
    })
    .from(driveNotification)
    .where(
      and(eq(driveNotification.status, 'collecting'), lt(driveNotification.createdAt, cutoff)),
    );

  const byUser = new Map<string, { recording: string[]; first: string[] }>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? { recording: [], first: [] };
    const hours = ((Date.now() - row.createdAt.getTime()) / 3_600_000).toFixed(1);
    if (row.key.endsWith(RECORDING_SUFFIX)) {
      entry.recording.push(`${row.key.slice(0, -RECORDING_SUFFIX.length)} (${hours} h)`);
    } else {
      entry.first.push(`${row.key} (${hours} h)`);
    }
    byUser.set(row.userId, entry);
  }
  const recordings = rows.filter((row) => row.key.endsWith(RECORDING_SUFFIX)).length;
  console.info(`${SCRIPT}: calls waiting: ${rows.length} in ${byUser.size} account(s)`);
  console.info(`${SCRIPT}:   waiting for the recording only: ${recordings}`);
  console.info(`${SCRIPT}:   waiting for their first files: ${rows.length - recordings}`);
  for (const [userId, entry] of byUser) {
    console.info(`${SCRIPT}: account ${userId}`);
    for (const key of entry.recording) console.info(`${SCRIPT}:   recording: ${key}`);
    for (const key of entry.first) console.info(`${SCRIPT}:   first files: ${key}`);
  }

  // The last 7 days by state, for context: a call whose recording never came is emailed "Recording not
  // uploaded" after 24 hours, and its record then leaves 'collecting' ('sent', 'failed', 'off').
  const week = new Date(Date.now() - 7 * 24 * 3_600_000);
  const recent = await db
    .select({
      key: driveNotification.sessionId,
      status: driveNotification.status,
      createdAt: driveNotification.createdAt,
      updatedAt: driveNotification.updatedAt,
    })
    .from(driveNotification)
    .where(gte(driveNotification.createdAt, week));
  const tally = new Map<string, number>();
  for (const row of recent) {
    const kind = row.key.endsWith(RECORDING_SUFFIX) ? 'recording' : 'call';
    const name = `${kind} ${row.status}`;
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  console.info(`${SCRIPT}: last 7 days, records by kind and state:`);
  for (const [name, n] of [...tally].sort()) console.info(`${SCRIPT}:   ${name}: ${n}`);
  // A recording record that left 'collecting' a day or more after it was made went by the 24-hour rule
  // ("Recording not uploaded"); one that left sooner had its recording arrive.
  const overdue = recent.filter(
    (row) =>
      row.key.endsWith(RECORDING_SUFFIX) &&
      row.status !== 'collecting' &&
      row.updatedAt.getTime() - row.createdAt.getTime() >= 24 * 3_600_000 - 60_000,
  );
  console.info(`${SCRIPT}: recording records closed by the 24-hour rule: ${overdue.length}`);
  for (const row of overdue)
    console.info(`${SCRIPT}:   ${row.key.slice(0, -RECORDING_SUFFIX.length)}`);

  // What would stop them finishing even with the app open: the company Drive, or saving switched off.
  const company = await db.select({ status: driveCompany.status }).from(driveCompany);
  console.info(
    `${SCRIPT}: company Drive: ${company.length === 0 ? 'not connected' : company.map((c) => c.status).join(', ')}`,
  );
  for (const userId of byUser.keys()) {
    const member = await db
      .select({ saveEnabled: driveMember.saveEnabled })
      .from(driveMember)
      .where(eq(driveMember.userId, userId));
    if (member[0] && !member[0].saveEnabled) {
      console.info(`${SCRIPT}: account ${userId}: saving to Drive is switched off`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(`${SCRIPT} failed: ${error instanceof Error ? error.name : 'unknown error'}`);
  process.exitCode = 1;
});
