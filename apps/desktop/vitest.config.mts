/**
 * File: apps/desktop/vitest.config.mts
 * Purpose: Settings for the desktop shell's unit tests of its pure rules (security, media).
 *          They mock the `electron` module, so no Electron binary is needed or started.
 *          The Electron smoke test is separate (playwright.config.ts, `pnpm --filter desktop test`).
 *          The file is .mts so it loads as an ES module; the package itself stays CommonJS for
 *          Electron.
 * Used by: `pnpm --filter desktop test:unit`, the root `pnpm test` (and so CI's Web job)
 * Depends on: vitest
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing)
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    unstubGlobals: true,
    unstubEnvs: true,
    restoreMocks: true,
  },
});
