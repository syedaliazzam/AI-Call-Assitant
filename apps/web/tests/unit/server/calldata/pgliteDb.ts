/**
 * File: apps/web/tests/unit/server/calldata/pgliteDb.ts
 * Purpose: Test helper for the call-data tests (ADR-0049): a real Postgres in memory (PGlite) with
 *          the committed migrations applied (drizzle/*.sql, exactly as production runs them), two
 *          invented accounts, and test data keys made fresh for each run (never a real key).
 * Used by: tests/unit/server/calldata/store.test.ts, api.test.ts
 * Depends on: @electric-sql/pglite, drizzle-orm/pglite, src/server/schema.ts, src/server/calldata/crypto.ts
 * Architecture: ADR-0049, ADR-0050 (migrations are additive only)
 */
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { loadDataKeys, type DataKeys } from '@/server/calldata/crypto';
import type { CallDataDb } from '@/server/calldata/store';
import * as schema from '@/server/schema';

/** apps/web/drizzle: the committed SQL migrations. */
const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'drizzle',
);

/** The two invented accounts every test database has. */
export const ALICE = 'user-alice-test';
/** The second invented account, for the cross-account checks. */
export const BOB = 'user-bob-test';

/** A fresh test database. */
export interface TestDb {
  /** The PGlite instance (for raw reads in tests). */
  pg: PGlite;
  /** Drizzle over it. */
  db: CallDataDb;
  /** Fresh test data keys (version 1 only). */
  keys: DataKeys;
}

/**
 * Fresh random test keys, as the environment would hold them.
 *
 * @param versions Which versions to make.
 * @returns An environment-like object (KITE_DATA_KEY_V<n> → base64).
 * Called from: createTestDb(); store.test.ts, crypto.test.ts
 */
export function testKeyEnv(versions: readonly number[]): Record<string, string> {
  return Object.fromEntries(
    versions.map((version) => [`KITE_DATA_KEY_V${version}`, randomBytes(32).toString('base64')]),
  );
}

/**
 * Makes a database with every migration applied and the two accounts.
 *
 * @returns The database, Drizzle and keys.
 * Called from: beforeEach() in store.test.ts and api.test.ts
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    for (const statement of readFileSync(path.join(MIGRATIONS, file), 'utf8').split(
      '--> statement-breakpoint',
    )) {
      if (statement.trim()) await pg.exec(statement);
    }
  }
  for (const id of [ALICE, BOB]) {
    await pg.query(`INSERT INTO "user" (id, name, email, updated_at) VALUES ($1, $2, $3, now())`, [
      id,
      id,
      `${id}@example.test`,
    ]);
  }
  const db = drizzle({ client: pg, schema }) as unknown as CallDataDb;
  return { pg, db, keys: loadDataKeys(testKeyEnv([1])) };
}

/**
 * Empties the tables the tests write (call data, sign-in codes) and restarts the revision sequence, so
 * each test starts clean without building a new database (that takes seconds). The two accounts stay.
 *
 * @param t The test database.
 * Called from: beforeEach() in the PGlite tests
 */
export async function resetTestDb(t: TestDb): Promise<void> {
  await t.pg.exec(
    'DELETE FROM call_record; DELETE FROM verification; ALTER SEQUENCE call_record_rev_seq RESTART WITH 1;',
  );
}
