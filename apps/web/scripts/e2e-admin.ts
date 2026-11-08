/**
 * File: apps/web/scripts/e2e-admin.ts
 * Purpose: Disables or re-enables the admin test account used only by the production latency
 *          run (tests/e2e-prod/latency.spec.ts). The account stays disabled except during a
 *          run: enable it, run the latency suite, disable it again.
 *          Usage: pnpm --filter web e2e-admin --enable    (before a latency run)
 *                 pnpm --filter web e2e-admin --disable   (straight after)
 * Used by: the "e2e-admin" script in apps/web/package.json (run by a developer by hand)
 * Depends on: src/server/users.ts (setTestAccountDisabled)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (accounts), §11 (testing);
 *               day-04-answers.md Stage 11
 *
 * Runs like create-e2e-user.ts: tsx, `--env-file=.env.local`, `--conditions=react-server`.
 * It reads only KITE_E2E_ADMIN_EMAIL (the email; never the password) from the environment
 * file, and prints only the email, the id and the new state.
 */
import { parseArgs } from 'node:util';
import { setTestAccountDisabled } from '@/server/users';
import { requireProduction } from './lib/require-prod';

/**
 * Enables or disables the admin test account.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  // ADR-0050: one database, the production one; writing to it needs --prod.
  requireProduction('e2e-admin');
  const { values } = parseArgs({
    options: {
      enable: { type: 'boolean' },
      disable: { type: 'boolean' },
      prod: { type: 'boolean' },
    },
  });
  if (Boolean(values.enable) === Boolean(values.disable)) {
    console.error('Pass exactly one of --enable or --disable.');
    process.exitCode = 1;
    return;
  }
  const email = process.env.KITE_E2E_ADMIN_EMAIL;
  if (!email) {
    console.error('KITE_E2E_ADMIN_EMAIL is missing from .env.local (create-e2e-user --admin).');
    process.exitCode = 1;
    return;
  }
  const disabled = Boolean(values.disable);
  const id = await setTestAccountDisabled(email, disabled);
  console.log(`${email} (id ${id}) is now ${disabled ? 'disabled' : 'enabled'}.`);
}

main().catch((error: unknown) => {
  // The error's name and message code only: database messages can quote parameters.
  const code = error instanceof Error && error.message === 'USER_NOT_FOUND' ? ', not found' : '';
  console.error(`e2e-admin: failed (${error instanceof Error ? error.name : 'unknown'}${code})`);
  process.exitCode = 1;
});
