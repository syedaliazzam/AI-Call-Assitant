/**
 * File: apps/web/tests/visual/v12-pairs.ts
 * Purpose: The v1.2.0 visual check (spec §7): lays each screen's capture beside its reference, one picture
 *          per pair, for looking at. The captures come from the harness tests, run with
 *          KITE_SCREENSHOT_DIR and KITE_VISUAL_THEME. The pairs hold another company's interface, so they
 *          go in the git-ignored docs/testing/v1.2-visual/ and are never committed or published.
 *          Usage: `pnpm --filter web exec tsx tests/visual/v12-pairs.ts <light shots> <dark shots>`
 * Used by: the developer before a release
 * Depends on: @playwright/test
 * Architecture: docs/design/paramount-ai-ui-spec.md §7
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/** The repository's root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Where the references are (git-ignored). */
const REFERENCES = path.join(ROOT, 'docs', 'design', 'references', 'v1.2');

/** Where the pairs go (git-ignored). */
const OUT = path.join(ROOT, 'docs', 'testing', 'v1.2-visual');

/** Each reference, and the capture of the same screen, without its theme or width. */
const PAIRS: readonly [reference: string, capture: string][] = [
  ['header.png', 'header-menu'],
  ['create session button menu.png', 'header-menu'],
  ['sidebar.png', 'sidebar'],
  ['sidebar user menu.png', 'user-menu'],
  ['active sessions.png', 'dashboard-grid'],
  ['past sessions.png', 'dashboard-list'],
  ['create session card.png', 'wizard-details'],
  ['documents menu.png', 'wizard-documents-menu'],
  ['upload resume menu.png', 'wizard-cv-menu'],
  ['preferences.png', 'wizard-preferences'],
  ['select language.png', 'wizard-language-menu'],
  ['select model.png', 'wizard-model-menu'],
  ['Add Instructions card.png', 'ai-instructions'],
  ['answer preferences card.png', 'answer-preferences'],
  ['answer preferences format view.png', 'answer-preferences-format'],
  ['answer preferences length view.png', 'answer-preferences-length'],
  ['answer preferences tone view.png', 'answer-preferences-tone'],
  ['choose platform card.png', 'choose-platform'],
  ['open desktop alert message.png', 'handoff'],
  ['first desktop app card appear.jpeg', 'start-card-400'],
  ['connect call session card.jpeg', 'connect'],
  ['3 dot menu options.jpeg', 'window-menu-400'],
  ['compact view.jpeg', 'call-bars'],
  ['compact view icon.jpeg', 'call-icon'],
  ['chat window.jpeg', 'call-chat'],
  ['transcript ans answer window.jpeg', 'call-panels'],
  ['trancrit window and 3 dot menu.jpeg', 'call-menu'],
];

/** The widths a capture may have been saved at, as its file name says. */
const WIDTHS = ['1440', '1440-1440', '1080', '780', '390', '390-390', '900'];

/**
 * Reads a picture as an address a page can show.
 *
 * @param file The picture.
 * @returns The data address.
 */
function asDataUrl(file: string): string {
  const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
}

const [lightDir, darkDir] = process.argv.slice(2);
if (!lightDir || !darkDir) throw new Error('Name the light and dark capture folders');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let made = 0;
const missing: string[] = [];
for (const [reference, capture] of PAIRS) {
  const referenceFile = path.join(REFERENCES, reference);
  if (!existsSync(referenceFile)) {
    missing.push(`reference: ${reference}`);
    continue;
  }
  for (const [theme, dir] of [
    ['light', lightDir],
    ['dark', darkDir],
  ] as const) {
    const found = WIDTHS.map((width) => [width, path.join(dir, `${capture}-${width}.png`)]).filter(
      ([, file]) => existsSync(file!),
    );
    if (found.length === 0 && existsSync(path.join(dir, `${capture}.png`))) {
      found.push(['', path.join(dir, `${capture}.png`)]);
    }
    if (found.length === 0) missing.push(`${theme}: ${capture}`);
    for (const [width, file] of found) {
      await page.setContent(
        `<!doctype html><body style="margin:0;display:flex;gap:16px;align-items:flex-start;background:#808080;font:14px sans-serif;color:#fff">
          <figure style="margin:8px;width:50%"><figcaption>Reference</figcaption><img style="width:100%" src="${asDataUrl(referenceFile)}"></figure>
          <figure style="margin:8px;width:50%"><figcaption>Paramount AI, ${theme} ${width}</figcaption><img style="width:100%" src="${asDataUrl(file!)}"></figure>
        </body>`,
      );
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
      const name = `${reference.replace(/\.\w+$/, '').replaceAll(' ', '-')}__${theme}${width ? `-${width.split('-')[0]}` : ''}.png`;
      await page.screenshot({ path: path.join(OUT, name), fullPage: true });
      made += 1;
    }
  }
}
await browser.close();
console.log(`${made} pairs in docs/testing/v1.2-visual`);
if (missing.length > 0) console.log(`Missing:\n${missing.join('\n')}`);
