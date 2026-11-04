/**
 * File: apps/web/tests/integration/harness/db-v104-read.ts
 * Purpose: Opens this browser's real IndexedDB with today's storage code, which upgrades a database
 *          left by a past release, and hands back everything in it for the test to compare. It holds
 *          invented text only.
 * Used by: tests/integration/db-upgrade.spec.ts (bundled with esbuild)
 * Depends on: src/core/storage/db.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0041
 */
import { getDb } from '@/core/storage/db';

/** What the test does through the page. */
declare global {
  interface Window {
    /** Upgrades the database if needed, and returns its version and all its rows by store. */
    readDatabase: () => Promise<{ version: number; rows: Record<string, unknown[]> }>;
  }
}

window.readDatabase = async () => {
  const db = getDb();
  await db.open();
  const rows: Record<string, unknown[]> = {};
  for (const table of db.tables) rows[table.name] = await table.toArray();
  return { version: db.verno, rows };
};
