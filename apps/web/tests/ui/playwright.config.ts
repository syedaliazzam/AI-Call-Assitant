/**
 * File: apps/web/tests/ui/playwright.config.ts
 * Purpose: Playwright configuration for the UI screenshot runs (UI theme stages U1–U3): signed-in
 *          pages of a running Kite (local `pnpm dev` by default, KITE_UI_URL to change it),
 *          saved as full-page screenshots for the stage reports. Developer-only; never in CI
 *          (it needs a signed-in account).
 * Used by: the "test:ui-shots" script in apps/web/package.json
 * Depends on: @playwright/test
 * Architecture: docs/design/kite-ui-theme.md §9 (gates: screenshots at 1440 and 390 px)
 */
import { defineConfig } from '@playwright/test';

/** One worker, steps in order. */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  // The first page load compiles it in `next dev`, which can take a while.
  timeout: 180_000,
  expect: { timeout: 60_000 },
  reporter: 'list',
  outputDir: '../../test-results/ui',
});
