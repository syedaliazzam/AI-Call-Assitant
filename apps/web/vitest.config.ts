/**
 * File: apps/web/vitest.config.ts
 * Purpose: Unit test settings for the web app (`pnpm --filter web test`).
 *          Tests live in tests/unit/<same path as src>, for example tests/unit/platform/index.test.ts.
 * Depends on: vitest
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing)
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same `@/*` → `src/*` alias as tsconfig.json, so tests import modules the way the app does.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws when imported outside a Next.js server build; in unit tests the
      // server modules are imported directly, so replace it with an empty module.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Plain Node by default; tests stub `window` / `navigator` themselves when they need them.
    environment: 'node',
    // Undo vi.stubGlobal() after every test so one test's fake window cannot leak into another.
    unstubGlobals: true,
    restoreMocks: true,
  },
});
