/**
 * File: apps/desktop/playwright.manual.config.ts
 * Purpose: Settings for the desktop app's manual checks (tests/manual/), which need a real
 *          desktop and installed apps, so they run by hand only, never in CI. Today: the
 *          screen-share protection check through Google Chrome's own screen sharing (Day 5).
 *          Usage: pnpm --filter desktop test:manual
 * Used by: the "test:manual" script in apps/desktop/package.json
 * Depends on: @playwright/test
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (protection), §11 (testing)
 */
import { defineConfig } from '@playwright/test';

/** Playwright configuration for the manual checks. */
export default defineConfig({
  testDir: 'tests/manual',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  reporter: 'list',
});
