/**
 * File: apps/web/src/server/db.ts
 * Purpose: The Drizzle database client for the accounts database (Neon Postgres).
 * Used by: src/server/auth.ts (Better Auth adapter), src/server/users.ts, scripts/create-admin.ts
 * Depends on: @neondatabase/serverless, drizzle-orm, src/server/env.ts, src/server/schema.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.1, §10.1
 */
import 'server-only';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { getAuthEnv } from './env';
import * as schema from './schema';

/**
 * The database client.
 * It uses Neon's serverless driver over HTTP: each query is one HTTPS request, with no
 * long-lived TCP connection or pool. That suits Vercel functions, which start and stop often
 * and would otherwise leak or exhaust Postgres connections. (HTTP mode has no interactive
 * transactions; Kite's account queries do not need them.)
 * Reading DATABASE_URL here means any import of this module fails fast with a clear message
 * when the variable is missing.
 */
export const db = drizzle({ client: neon(getAuthEnv().databaseUrl), schema });
