/**
 * File: apps/web/scripts/make-guide.ts
 * Purpose: Copies the user guide (docs/user-guide/using-kite.md, the one to edit) into the web app, so
 *          /help can show it: the deployed app has no docs folder to read from.
 *          Run after editing the guide: `pnpm --filter @kite/web make-guide`. A unit test fails when the
 *          copy is out of date.
 * Used by: developers; tests/unit/features/help/guideText.test.ts checks the result
 * Depends on: node:fs
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2 Help)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The guide. */
const SOURCE = path.resolve(WEB_DIR, '..', '..', 'docs', 'user-guide', 'using-kite.md');

/** The copy. */
const TARGET = path.join(WEB_DIR, 'src', 'features', 'help', 'guideText.ts');

const text = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
// A template literal: prettier leaves its text alone, so the file stays stable.
const literal = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
writeFileSync(
  TARGET,
  `/**
 * File: apps/web/src/features/help/guideText.ts
 * Purpose: The user guide's text for the /help page. Made by scripts/make-guide.ts from
 *          docs/user-guide/using-kite.md: edit that file, not this one.
 * Used by: src/features/help/HelpPage.tsx
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2 Help)
 */

/** The guide, as Markdown. */
export const USER_GUIDE_MD = \`${literal}\`;
`,
);
