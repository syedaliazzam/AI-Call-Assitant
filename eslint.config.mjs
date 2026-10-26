/**
 * File: eslint.config.mjs
 * Purpose: One ESLint configuration for the whole monorepo (run from the root with `pnpm lint`).
 *          Next.js rules apply to apps/web; plain TypeScript rules apply to every other package.
 *          Formatting is left to Prettier (eslint-config-prettier turns off conflicting rules).
 * Used by: root package.json "lint" script, CI (Stage 7)
 * Depends on: @eslint/js, typescript-eslint, eslint-config-next, eslint-config-prettier, globals
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.2 (code rules)
 */
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Glob for every source file inside the Next.js app. */
const WEB_FILES = ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'];

/** Glob for every source file outside the Next.js app (shared package, desktop shell, root configs). */
const OTHER_FILES = ['**/*.{js,mjs,cjs,ts,tsx}'];

/**
 * Restricts a list of config objects to the given files.
 * Next's configs register their own copy of the TypeScript ESLint plugin, so they must not
 * overlap with our generic TypeScript config, or ESLint reports "cannot redefine plugin".
 *
 * @param configs Flat config objects (for example from eslint-config-next).
 * @param files   Globs the configs should apply to.
 * @returns The same configs, each limited to `files`.
 * Called from: the default export below.
 */
function scopeTo(configs, files) {
  return configs.map((config) => ({ ...config, files }));
}

export default defineConfig([
  // Generated output, dependencies and downloaded model files are never linted.
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/out/**',
    '**/coverage/**',
    '**/.vercel/**',
    'apps/web/next-env.d.ts',
    'apps/web/public/models/**',
  ]),

  // apps/web: the official Next.js rules (React, hooks, accessibility, Core Web Vitals, TypeScript).
  ...scopeTo(nextVitals, WEB_FILES),
  ...scopeTo(nextTypescript, WEB_FILES),
  {
    files: WEB_FILES,
    settings: {
      // The Next.js plugin needs to know where the app lives inside the monorepo.
      next: { rootDir: 'apps/web/' },
    },
  },

  // Everything else: recommended JavaScript + TypeScript rules.
  {
    files: OTHER_FILES,
    ignores: WEB_FILES,
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Rules for the whole repository.
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    rules: {
      // CLAUDE.md: "No `any` unless commented why" — disable this rule per line with a reason.
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused values are errors, except names starting with "_" (intentionally unused).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // CLAUDE.md: "All desktop/browser differences live in apps/web/src/platform/".
  // Outside that folder, code must use getPlatform() / isDesktop() instead of the bridge.
  {
    files: WEB_FILES,
    ignores: ['apps/web/src/platform/**', 'apps/web/tests/unit/platform/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'kiteDesktop',
          message: 'Use getPlatform() or isDesktop() from @/platform instead.',
        },
        {
          object: 'globalThis',
          property: 'kiteDesktop',
          message: 'Use getPlatform() or isDesktop() from @/platform instead.',
        },
      ],
    },
  },

  // Must be last: turns off every rule that would fight with Prettier's formatting.
  prettier,
]);
