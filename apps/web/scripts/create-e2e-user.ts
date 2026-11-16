/**
 * File: apps/web/scripts/create-e2e-user.ts
 * Purpose: Creates a disposable test account for one run of the production end-to-end suites
 *          (tests/e2e-prod/): role 'user' (KITE_E2E_EMAIL / KITE_E2E_PASSWORD), or with --admin
 *          role 'admin' for the admin-only checks (/dev/latency, the domain
 *          suite's admin page; KITE_E2E_ADMIN_EMAIL / KITE_E2E_ADMIN_PASSWORD). Since 14 Nov 2026
 *          production keeps no test accounts: delete it after the run (delete-test-accounts --prod).
 *          It creates the account with a temporary password exactly
 *          like an admin would, completes the first password change the same way the
 *          /change-password page does, and appends the email and the new password to
 *          apps/web/.env.local. The password is never printed.
 *          Usage: pnpm --filter web create-e2e-user [--admin] [--email <address>]
 * Used by: the "create-e2e-user" script in apps/web/package.json (run by a developer before a run)
 * Depends on: src/server/users.ts (createUserAccount, markPasswordChanged),
 *             src/server/auth.ts (Better Auth: signInEmail, changePassword)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts), §11 (testing);
 *               ADR-0022
 *
 * Like create-admin, it runs with tsx, `--env-file=.env.local` (DATABASE_URL, BETTER_AUTH_*)
 * and `--conditions=react-server`. DATABASE_URL is the same for Development and Production
 * (one Neon database), so the account exists in production.
 *
 * .env.local is git-ignored. `vercel env pull` rewrites that file and drops the two lines: delete
 * the account (delete-test-accounts --prod) and create a new one. --email must be a
 * kite-e2e…@example.com address, so that delete-test-accounts can remove it afterwards.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { auth } from '@/server/auth';
import { createUserAccount, markPasswordChanged } from '@/server/users';
import { requireProduction } from './lib/require-prod';
import { isTestAccountEmail } from './lib/test-accounts';

/** The two kinds of test account. */
const ACCOUNTS = {
  /** The suites' normal account. */
  user: {
    /** Default email (example.com is reserved for examples: no real mailbox). */
    email: 'kite-e2e@example.com',
    /** Display name. */
    name: 'Kite E2E (disposable test account)',
    /** Prefix of the two .env.local lines. */
    prefix: 'KITE_E2E',
  },
  /** The admin account, for the admin-only checks. */
  admin: {
    /** Default email. */
    email: 'kite-e2e-admin@example.com',
    /** Display name. */
    name: 'Kite E2E admin (disposable test account)',
    /** Prefix of the two .env.local lines. */
    prefix: 'KITE_E2E_ADMIN',
  },
} as const;

/** Where the credentials are written (git-ignored; see .gitignore `.env*`). */
const ENV_FILE = path.join(process.cwd(), '.env.local');

/** The part of a Better Auth APIError this script reads (the error code, never the message). */
interface BetterAuthErrorShape {
  /** The error body, when the error came from Better Auth. */
  body?: {
    /** Machine-readable code, for example 'INVALID_PASSWORD'. */
    code?: string;
  };
}

/**
 * A random password for the test account: 32 characters from 24 random bytes.
 *
 * @returns The password.
 * Called from: main()
 */
function randomPassword(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}

/**
 * Creates the account, changes its temporary password, and stores the credentials.
 *
 * @returns Nothing; sets a non-zero exit code (without printing secrets) when anything fails.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  // ADR-0050: one database, the production one; writing to it needs --prod.
  requireProduction('create-e2e-user');
  const { values } = parseArgs({
    options: { email: { type: 'string' }, admin: { type: 'boolean' }, prod: { type: 'boolean' } },
  });
  const role = values.admin ? 'admin' : 'user';
  const account = ACCOUNTS[role];
  const email = (values.email ?? account.email).trim().toLowerCase();
  // Only an address delete-test-accounts will remove: never a real person's address.
  if (!isTestAccountEmail(email)) {
    console.error('--email must be a kite-e2e…@example.com address. Nothing changed.');
    process.exitCode = 1;
    return;
  }

  // Refuse to add a second set of lines: the suites read the first one. (The admin prefix
  // also starts with KITE_E2E_, so the user check names EMAIL/PASSWORD right after it.)
  const existing = new RegExp(`^${account.prefix}_(EMAIL|PASSWORD)=`, 'm');
  if (existing.test(readFileSync(ENV_FILE, 'utf8'))) {
    console.error(
      `${account.prefix}_EMAIL / ${account.prefix}_PASSWORD are already in .env.local. Nothing changed.`,
    );
    process.exitCode = 1;
    return;
  }

  // 1. The account, with a temporary password, as an admin creates it (mustChangePassword).
  const created = await createUserAccount({ name: account.name, email, role });

  // 2. The first password change, as the /change-password page does it: sign in with the
  //    temporary password, change it with that session, then clear mustChangePassword.
  const signIn = await auth.api.signInEmail({
    body: { email, password: created.temporaryPassword },
    returnHeaders: true,
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
  const password = randomPassword();
  await auth.api.changePassword({
    body: {
      currentPassword: created.temporaryPassword,
      newPassword: password,
      revokeOtherSessions: true,
    },
    headers: new Headers({ cookie }),
  });
  await markPasswordChanged(created.id);

  // 3. Store the credentials for the suites (never printed).
  appendFileSync(
    ENV_FILE,
    `\n# Production end-to-end test account (tests/e2e-prod), role ${role}. Delete it after the run: delete-test-accounts --prod.\n${account.prefix}_EMAIL=${email}\n${account.prefix}_PASSWORD=${password}\n`,
  );
  // No email or id in the output: the account is named by its role and the .env.local lines.
  console.log(`Disposable test account created, role ${role}, password changed.`);
  console.log(
    `Credentials appended to apps/web/.env.local (${account.prefix}_EMAIL, ${account.prefix}_PASSWORD).`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message === 'EMAIL_TAKEN') {
    console.error('An account with this email already exists. Nothing was changed.');
  } else {
    // The error's name and code only: messages from the database can quote parameters.
    const code = (error as BetterAuthErrorShape).body?.code;
    console.error(
      `Could not create the test account (${error instanceof Error ? error.name : 'unknown'}${code ? `, ${code}` : ''}).`,
    );
  }
  process.exitCode = 1;
});
