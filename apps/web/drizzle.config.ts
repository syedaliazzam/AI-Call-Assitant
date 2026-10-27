/**
 * File: apps/web/drizzle.config.ts
 * Purpose: Drizzle Kit settings: where the schema is, where SQL migrations are written, and
 *          which database to migrate.
 * Used by: `pnpm --filter web db:generate` (writes drizzle/*.sql from src/server/schema.ts),
 *          `pnpm --filter web db:migrate` (applies them to Neon)
 * Depends on: drizzle-kit; DATABASE_URL from apps/web/.env.local
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.1
 */
import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Drizzle Kit does not read .env files itself. Load the file written by `vercel env pull`
// when it exists (local runs); on CI or Vercel the variables are already in the environment.
if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/schema.ts',
  // Generated SQL migrations; committed so every environment applies the same changes.
  out: './drizzle',
  dbCredentials: {
    // Only needed by `db:migrate`; `db:generate` works without a database.
    url: process.env.DATABASE_URL ?? '',
  },
});
