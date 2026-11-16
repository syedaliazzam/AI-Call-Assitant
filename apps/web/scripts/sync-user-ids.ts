/**
 * File: apps/web/scripts/sync-user-ids.ts
 * Purpose: Prints the value for a per-account rollout list such as KITE_STT_DEEPGRAM_USERS (ADR-0076;
 *          the accountSync switch it was made for was removed by ADR-0092): the account ids of the
 *          emails given, plus the end-to-end test account (KITE_E2E_EMAIL in .env.local),
 *          comma-separated, for the developer to paste into `vercel env add <NAME> production`.
 *          Read-only: it changes nothing in the database. The ids appear only in the developer's own
 *          terminal.
 *          Usage: pnpm --filter web sync-user-ids --email you@company.com [--email another@company.com]
 * Used by: the developer, once per rollout step
 * Depends on: src/server/db.ts, src/server/schema.ts (user)
 * Architecture: ADR-0049 (rollout)
 */
import { parseArgs } from 'node:util';
import { inArray } from 'drizzle-orm';
import { db } from '@/server/db';
import { user } from '@/server/schema';

/**
 * Looks the emails up and prints the ids.
 *
 * @returns Nothing; sets a non-zero exit code when an email has no account.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: 'string', multiple: true } } });
  const emails = [...(values.email ?? []), process.env.KITE_E2E_EMAIL ?? '']
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes('@'));
  if (emails.length === 0) {
    console.error('Usage: pnpm --filter web sync-user-ids --email you@company.com');
    process.exitCode = 1;
    return;
  }
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.email, emails));
  const missing = emails.filter((email) => !rows.some((row) => row.email === email));
  if (missing.length > 0) {
    console.error(`No account for: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.info(`Rollout list value for ${emails.length} account(s):`);
  console.info(rows.map((row) => row.id).join(','));
}

main().catch((error: unknown) => {
  console.error(`sync-user-ids failed: ${error instanceof Error ? error.name : 'unknown error'}`);
  process.exitCode = 1;
});
