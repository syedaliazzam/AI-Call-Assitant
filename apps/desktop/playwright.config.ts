/**
 * File: apps/desktop/playwright.config.ts
 * Purpose: Settings for the Electron smoke test (`pnpm --filter desktop test`), which launches
 *          the built shell (dist/) against a local test page. No browser download is needed:
 *          Playwright drives the Electron binary itself.
 * Used by: `pnpm --filter desktop test`; the CI jobs "Desktop smoke test (Windows)" and
 *          "(macOS, manual)" in .github/workflows/ci.yml
 * Depends on: @playwright/test
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Desktop smoke)
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  // Only *.spec.ts files; tests/unit/*.test.ts are Vitest unit tests.
  testMatch: '*.spec.ts',
  // tests/manual: checks that need a real desktop and installed apps (playwright.manual.config.ts).
  testIgnore: '**/manual/**',
  // One Electron instance at a time: the app takes a single-instance lock.
  workers: 1,
  fullyParallel: false,
  // Starting Electron (and downloading nothing) takes a few seconds on a slow CI runner.
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
});
