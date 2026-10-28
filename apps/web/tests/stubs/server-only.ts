/**
 * File: apps/web/tests/stubs/server-only.ts
 * Purpose: Test stub for the `server-only` package. The real package throws when imported
 *          outside a Next.js server build, which would stop unit tests from importing
 *          src/server/* modules. This empty module replaces it in tests only.
 * Used by: apps/web/vitest.config.ts (resolve.alias 'server-only')
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.2 (src/server is server-only)
 */
export {};
