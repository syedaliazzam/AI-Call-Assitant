/**
 * File: eslint.config.mjs
 * Purpose: One ESLint configuration for the whole monorepo (run from the root with `pnpm lint`).
 *          Next.js rules apply to apps/web; plain TypeScript rules apply to every other package.
 *          Formatting is left to Prettier (eslint-config-prettier turns off conflicting rules).
 * Used by: root package.json "lint" script, CI (Stage 7)
 *          It also enforces the CLAUDE.md commenting standard with eslint-plugin-jsdoc (JSDoc on
 *          everything exported, @param / @returns on documented functions); file headers are
 *          checked by scripts/check-file-headers.ts, also part of `pnpm lint`.
 * Depends on: @eslint/js, typescript-eslint, eslint-config-next, eslint-config-prettier, globals,
 *             eslint-plugin-jsdoc
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.2 (code rules)
 */
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Glob for every source file inside the Next.js app. */
const WEB_FILES = ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'];

/** Glob for the source files the CLAUDE.md commenting standard applies to (the three packages and scripts/). */
const PACKAGE_FILES = [
  'apps/web/**/*.{ts,tsx,mjs}',
  'apps/desktop/**/*.{ts,tsx,mjs}',
  'packages/shared/**/*.{ts,tsx,mjs}',
  // The repository's own scripts (scripts/check-file-headers.ts) follow the same standard.
  'scripts/**/*.ts',
];

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
    // The official sherpa-onnx runtime (downloaded, used unmodified; never linted or reformatted).
    'apps/web/public/stt-runtime/**',
    'apps/web/public/punct/**',
    // 1.5.2 (ADR-0070): the echo canceller, copied from npm (compiled code).
    'apps/web/public/aec/**',
    // Build output: the staged sherpa-onnx runtime (v1.0.1, used unmodified) and the installers.
    'apps/desktop/native/**',
    'apps/desktop/release/**',
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

  // CLAUDE.md commenting standard, rule 2: every exported function, component, class, method,
  // type and constant has a JSDoc block, and documented functions list their parameters and what
  // they return. ("Called from" and the file header are checked by scripts/check-file-headers.ts.)
  {
    files: PACKAGE_FILES,
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          // Only what a module exports (and the methods of exported classes); private helpers
          // are documented by convention, and when they are, the rules below apply to them too.
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            FunctionExpression: true,
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            MethodDefinition: true,
          },
          // Exported types, interfaces, enums and constants (arrow functions assigned to an
          // exported const are covered by ArrowFunctionExpression above).
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'VariableDeclaration',
          ],
        },
      ],
      // Every parameter of a documented function has an @param line. A destructured parameter
      // (React props, option objects) needs no root name: its type documents the fields.
      'jsdoc/require-param': ['error', { checkDestructuredRoots: false }],
      'jsdoc/require-param-description': 'error',
      // @param names must match the real parameters (catches comments left behind by renames).
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      // A documented function that returns a value says what it returns.
      'jsdoc/require-returns': ['error', { forceReturnsWithAsync: false }],
      'jsdoc/require-returns-description': 'error',
    },
  },

  // CLAUDE.md commenting standard, rule 5: every field of every interface and object-shaped type
  // alias (exported or not, including nested object types and each object in a union) has a
  // JSDoc comment saying what it means, its unit and any special values.
  // The same plugin is registered a second time as "jsdoc-fields" because ESLint allows one set
  // of options per rule: the rule-2 check above is limited to exports (publicOnly), and this
  // one must cover every type. Inline parameter types such as `fn(options: { x: number })` are
  // not included: the function's @param lines already describe them.
  {
    files: PACKAGE_FILES,
    plugins: { 'jsdoc-fields': jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      'jsdoc-fields/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          // Functions and classes are rule 2's job (above); only type members here.
          require: {
            FunctionDeclaration: false,
            FunctionExpression: false,
            ArrowFunctionExpression: false,
            ClassDeclaration: false,
            MethodDefinition: false,
          },
          // Members of: an interface; the object (or each object of a union / intersection) a
          // type alias names; and a field whose own type is an object (or an object or null).
          // Not members of method parameter/return types or generic arguments: those are
          // described by @param / @returns where they are used.
          contexts: [
            'TSInterfaceBody > :matches(TSPropertySignature, TSMethodSignature)',
            'TSTypeAliasDeclaration > TSTypeLiteral > :matches(TSPropertySignature, TSMethodSignature)',
            'TSTypeAliasDeclaration > :matches(TSUnionType, TSIntersectionType) > TSTypeLiteral > :matches(TSPropertySignature, TSMethodSignature)',
            'TSPropertySignature > TSTypeAnnotation > TSTypeLiteral > :matches(TSPropertySignature, TSMethodSignature)',
            'TSPropertySignature > TSTypeAnnotation > TSUnionType > TSTypeLiteral > :matches(TSPropertySignature, TSMethodSignature)',
          ],
        },
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
