/**
 * File: apps/web/tests/integration/playwright.config.ts
 * Purpose: Settings for the integration tests: speech-to-text (`pnpm --filter web test:stt`,
 *          stt.spec.ts) and the answer harness (`pnpm --filter web test:answers`,
 *          answers.spec.ts, Day 4). Each test launches Playwright's Chromium itself (the STT
 *          fixtures need their own fake-audio launch flags) and serves its own page, so no
 *          `use.browserName` or web server is configured here.
 * Used by: the "test:stt" and "test:answers" scripts in apps/web/package.json; the
 *          stt-integration CI job
 * Depends on: @playwright/test
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing); day-02-audio.md Stage 6
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // Only *.spec.ts here; tests/unit/*.test.ts are Vitest unit tests.
  testMatch: '*.spec.ts',
  // One browser at a time: two recognizers at once would slow each other down on a 2-core runner.
  workers: 1,
  fullyParallel: false,
  // Per test: model start (a few seconds) + the recording played in real time (up to 17 s) +
  // the end-of-utterance wait; generous for a slow CI runner.
  timeout: 120_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: '../../test-results/stt',
});
