/**
 * File: apps/web/tests/e2e-prod/playwright.config.ts
 * Purpose: Playwright settings for the manual production end-to-end suites (chrome.spec.ts,
 *          desktop.spec.ts). They run against https://kite-call-assistant.vercel.app as the
 *          dedicated test account, so they are run by a developer by hand and never in CI.
 *          Usage: pnpm --filter web test:e2e-prod   (the desktop suite builds the shell first)
 * Used by: the "test:e2e-prod" script in apps/web/package.json
 * Depends on: @playwright/test; tests/e2e-prod/helpers.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing)
 */
import { defineConfig } from '@playwright/test';

/** Playwright configuration: one worker, steps in order, long limits for the model download. */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // The suites share one test account; one at a time keeps them independent.
  workers: 1,
  fullyParallel: false,
  // A fresh profile downloads the 204 MB speech model from Hugging Face before Connect.
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: '../../test-results/e2e-prod',
  // No traces: a trace records typed values, including the test account's password.
  use: { trace: 'off' },
});
