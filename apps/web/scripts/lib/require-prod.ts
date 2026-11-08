/**
 * File: apps/web/scripts/lib/require-prod.ts
 * Purpose: The first step of every developer script that writes to the database (ADR-0050). Kite
 *          has ONE database, the production one: the deployed app, `pnpm dev` and these scripts all
 *          use it. So each such script says "production" and refuses to run unless --prod was
 *          given on purpose. Never prints the connection string.
 * Used by: scripts/create-admin.ts, create-e2e-user.ts, e2e-admin.ts, rotate-e2e-password.ts,
 *          db-migrate.ts
 * Depends on: nothing
 * Architecture: ADR-0050
 */

/** The flag that confirms a write to the production database. */
export const PROD_FLAG = '--prod';

/**
 * Says why a database-writing script may not run.
 *
 * @param argv The command line (normally process.argv).
 * @returns The reason, or null when --prod was given.
 * Called from: requireProduction(); tests
 */
export function productionRefusal(argv: readonly string[]): string | null {
  return argv.includes(PROD_FLAG)
    ? null
    : `this writes to the PRODUCTION database (Kite has only one). Run it again with ${PROD_FLAG} to confirm.`;
}

/**
 * Prints that the database is production, and stops unless --prod was given.
 *
 * @param script The script's name, for the printed lines.
 * @returns When --prod was given.
 * Called from: main() of each database-writing script, before anything touches the database
 */
export function requireProduction(script: string): void {
  console.info(`${script}: database: production`);
  const reason = productionRefusal(process.argv);
  if (reason) {
    console.error(`${script}: refused: ${reason}`);
    process.exit(1);
  }
}
