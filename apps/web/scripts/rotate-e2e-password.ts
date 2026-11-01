/**
 * File: apps/web/scripts/rotate-e2e-password.ts
 * Purpose: Gives a production end-to-end test account a new random password and writes it
 *          straight into apps/web/.env.local, replacing only that account's PASSWORD line. The
 *          password is never printed, logged or shown. With --admin it rotates the admin test
 *          account (KITE_E2E_ADMIN_*) and leaves it disabled; without, the user test account
 *          (KITE_E2E_*), whose enabled state it does not change.
 *          Usage: pnpm --filter web rotate-e2e-password [--admin]
 * Used by: the "rotate-e2e-password" script in apps/web/package.json (run by a developer by
 *          hand, for example after a password was exposed)
 * Depends on: src/server/users.ts (setTestAccountPassword, setTestAccountDisabled), node:fs
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts), §11 (testing)
 *
 * Runs like e2e-admin.ts: tsx, `--env-file=.env.local`, `--conditions=react-server`. It reads
 * only the account's EMAIL from the environment, and edits .env.local without printing it.
 * The file is checked before the account changes, so a missing line changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTestAccountDisabled, setTestAccountPassword } from '@/server/users';

/** apps/web/.env.local. */
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local');

/**
 * A random password: 32 characters from 24 random bytes (as create-e2e-user.ts makes them).
 *
 * @returns The password.
 * Called from: main()
 */
function randomPassword(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}

/**
 * Rotates the password and stores it.
 *
 * @returns Nothing; sets a non-zero exit code (without printing secrets) when anything fails.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { admin: { type: 'boolean' } } });
  const prefix = values.admin ? 'KITE_E2E_ADMIN' : 'KITE_E2E';
  const email = process.env[`${prefix}_EMAIL`];
  if (!email) {
    console.error(`${prefix}_EMAIL is missing from .env.local. Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  const line = new RegExp(`^${prefix}_PASSWORD=.*$`, 'm');
  const before = readFileSync(ENV_FILE, 'utf8');
  if (!line.test(before)) {
    console.error(`${prefix}_PASSWORD is not in .env.local. Nothing changed.`);
    process.exitCode = 1;
    return;
  }

  const password = randomPassword();
  const id = await setTestAccountPassword(email, password);
  // A function replacement, so characters in the password are never read as $-patterns.
  writeFileSync(
    ENV_FILE,
    before.replace(line, () => `${prefix}_PASSWORD=${password}`),
  );
  if (values.admin) await setTestAccountDisabled(email, true);
  console.log(
    `Test account ${email} (id ${id}): new password stored in apps/web/.env.local (${prefix}_PASSWORD); sessions signed out${values.admin ? '; account disabled' : ''}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `rotate-e2e-password: failed (${error instanceof Error ? error.message : 'unknown'})`,
  );
  process.exitCode = 1;
});
