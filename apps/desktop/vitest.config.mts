/**
 * File: apps/desktop/vitest.config.mts
 * Purpose: (.mts so it loads as an ES module; the package itself stays CommonJS for Electron.)
 *          Unit tests for the desktop shell's pure rules (`pnpm --filter desktop test:unit`).
 *          They mock the `electron` module, so no Electron binary is needed or started.
 *          The Electron smoke test is separate (playwright.config.ts, `pnpm --filter desktop test`).
 * Depends on: vitest
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
