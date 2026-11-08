# ADR-0050: One production database, with write guards

- **Status:** Accepted (developer, 8 Nov 2026)
- **Date:** 2026-11-08
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §8.1, §10.1, §11
- **Supersedes / superseded by:** none. Instead of the separate development database proposed in the investigation (A5).

## Context

Kite has one Neon database. The deployed app, `pnpm dev`, the verify scripts and the end-to-end suites all use it: `DATABASE_URL` is the same in every environment. Until now it held only accounts, sign-in sessions and request counts.

With ADR-0049 it also holds each account's encrypted call data. A mistake in a script or test could now remove people's sessions, documents or transcripts.

A separate development database was proposed. The developer chose to keep one database and guard every write to it.

## Decision

1. **One database, the production one.** No development branch is created, and environment variables do not change.
2. **Every script that writes to the database says "production" and refuses to run without `--prod`** (`scripts/lib/require-prod.ts`):
   - `create-admin`, `create-e2e-user`, `e2e-admin`, `rotate-e2e-password`;
   - `db:migrate` (now `scripts/db-migrate.ts`, which then runs Drizzle Kit).

   The read-only `sync-user-ids` needs no flag.
3. **Tests touch only the dedicated test account, and clean up only what they created.**
   - No test or script truncates a table, bulk-deletes, or reads or changes another account's rows.
   - Unit tests never use the real database: the call-data tests run the committed migrations in PGlite, a Postgres in memory (`tests/unit/server/calldata/pgliteDb.ts`).
   - The production end-to-end suites sign in as the test account and delete what they create.
4. **Migrations are additive only:** new tables, columns and indexes. Existing tables and columns, the auth tables above all, are never altered or dropped.
5. **Each migration's SQL is shown to the developer before it is applied to production.** It is applied before the code that needs it is deployed.

## Consequences

- No second database to pay for, keep in step or confuse with the real one.
- A mistake that gets past the guards still lands in production. The guards, additive-only migrations and test-account-only tests are what stand between a bug and real data. Neon's point-in-time restore is the last resort.
- Local `pnpm dev` with the accountSync switch on writes real call data for whoever signs in. Developers use the test account for that.

## Alternatives considered

- **A Neon development branch for Development and Preview:** safer for experiments, but the developer chose one database to keep the setup simple.
- **Guards inside the app instead of the scripts:** the app only ever writes the signed-in account's own rows (ADR-0049). The risk is in scripts and tests, which act outside that rule.

## Validation

- `tests/unit/scripts/require-prod.test.ts`.
- The call-data tests run the committed migration files (`drizzle/*.sql`) as they are, on PGlite.
- The migration `drizzle/0002_call_records.sql` was shown to the developer before being applied.
