/**
 * File: apps/web/vitest.config.ts
 * Purpose: Unit test settings for the web app (`pnpm --filter web test`).
 *          Tests live in tests/unit/<same path as src>, for example tests/unit/platform/index.test.ts.
 * Used by: `pnpm --filter web test`, the root `pnpm test` (and so CI's Web job)
 * Depends on: vitest
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing)
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // Same `@/*` → `src/*` alias as tsconfig.json, so tests import modules the way the app does.
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // `server-only` throws when imported outside a Next.js server build; in unit tests the
      // server modules are imported directly, so replace it with an empty module.
      {
        find: 'server-only',
        replacement: fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      },
      // pdf.js: the app uses the modern build through 'pdfjs-dist/webpack.mjs' (it starts the
      // pdf.js worker in the browser). Node 24 lacks a JavaScript feature that build needs
      // (Uint8Array.prototype.toHex), and pdf.js asks for its legacy build in Node.js, which
      // runs the same text extraction without a worker.
      { find: /^pdfjs-dist\/webpack\.mjs$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      // mammoth: in Node its default entry only reads { path } or { buffer }; the browser
      // bundle reads { arrayBuffer }, which is what the app passes. Tests use the browser bundle
      // so they run the same input path as the app.
      { find: /^mammoth$/, replacement: 'mammoth/mammoth.browser.js' },
    ],
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
