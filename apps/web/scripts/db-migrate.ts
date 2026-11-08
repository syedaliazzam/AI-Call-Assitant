/**
 * File: apps/web/scripts/db-migrate.ts
 * Purpose: Applies the committed SQL migrations (drizzle/*.sql) to the database, through Drizzle
 *          Kit, only with --prod (ADR-0050: Kite has one database, the production one). Migrations
 *          are additive only (new tables, columns, indexes), and each one's SQL is shown to the
 *          developer before it is applied.
 *          Usage: pnpm --filter web db:migrate --prod
 * Used by: the "db:migrate" script in apps/web/package.json
 * Depends on: drizzle-kit (drizzle.config.ts reads DATABASE_URL from apps/web/.env.local),
 *             scripts/lib/require-prod.ts
 * Architecture: ADR-0050
 */
import { spawnSync } from 'node:child_process';
import { requireProduction } from './lib/require-prod';

requireProduction('db:migrate');
// shell: true lets Windows find the pnpm-installed drizzle-kit command.
const result = spawnSync('drizzle-kit', ['migrate'], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
