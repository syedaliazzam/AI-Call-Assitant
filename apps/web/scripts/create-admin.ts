/**
 * File: apps/web/scripts/create-admin.ts
 * Purpose: Creates the FIRST admin account from the command line (after that, admins create
 *          users at /admin/users). Prints the temporary password once; the admin must change
 *          it at first sign-in.
 *          Usage: pnpm --filter web create-admin --email you@company.com --name "Your Name"
 * Used by: the "create-admin" script in apps/web/package.json (run by a developer, once)
 * Depends on: src/server/users.ts (which uses Better Auth's own createUser and password hashing;
 *             no password is ever written to the database by this script directly)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (First admin), ADR-0022
 *
 * The package.json script runs this with tsx and two Node options:
 * - `--env-file=.env.local` loads DATABASE_URL and BETTER_AUTH_* written by `vercel env pull`;
 * - `--conditions=react-server` lets server-only modules load outside Next.js (the
 *   `server-only` package throws unless that condition is set).
 */
import { parseArgs } from 'node:util';
import { createUserAccount } from '@/server/users';
import { requireProduction } from './lib/require-prod';

/**
 * Reads --email and --name, creates the admin account and prints its temporary password.
 * Sets a non-zero exit code (without printing secrets) when anything fails.
 *
 * @returns Nothing; output goes to the terminal.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  // ADR-0050: one database, the production one; writing to it needs --prod.
  requireProduction('create-admin');
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      prod: { type: 'boolean' },
    },
  });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !name || !email.includes('@')) {
    console.error(
      'Usage: pnpm --filter web create-admin --email you@company.com --name "Your Name"',
    );
    process.exitCode = 1;
    return;
  }

  try {
    // No request headers: Better Auth allows createUser from trusted server code without a
    // signed-in admin, which is exactly the "first admin" case.
    const created = await createUserAccount({ name, email, role: 'admin' });
    console.log(`\nAdmin account created for ${email} (id ${created.id}).`);
    console.log(`Temporary password (shown once): ${created.temporaryPassword}`);
    console.log('Sign in at /login; you will be asked to choose a new password.\n');
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_TAKEN') {
      console.error(`An account with the email ${email} already exists. Nothing was changed.`);
    } else {
      // Print only the underlying cause (for example "fetch failed" or a Postgres error).
      // Drizzle's own message includes the query parameters, which could contain the hash.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      const reason = cause instanceof Error ? cause.message : 'unknown error';
      console.error(`Could not create the admin account: ${reason}`);
    }
    process.exitCode = 1;
  }
}

void main();
