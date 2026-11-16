/**
 * File: apps/web/tests/visual/ai-settings-shots.ts
 * Purpose: Pictures of Admin → AI settings (ADR-0089, simplified in ADR-0091) for the visual check: the
 *          real page component with the real default prompts and app contracts and invented data. For each
 *          tab (Live answers, AI notes, Ask AI): Edit, Preview and History; then the side-by-side
 *          comparison of a version, an edited draft ready to save (with the lint hint), and Edit and
 *          History in the dark theme. Builds the page, serves it on a free port, captures the PAGE only
 *          (never the screen) in headless Microsoft Edge, and exits.
 *          Usage: pnpm --filter web exec tsx --conditions=react-server tests/visual/ai-settings-shots.ts <out dir>
 * Used by: the developer (not part of the automated suites)
 * Depends on: esbuild, @tailwindcss/postcss, @playwright/test (Edge), src/server/aiBudget.ts (budgetFacts),
 *             src/server/prompts/defaults.ts, src/server/prompts/contract.ts (contractFor),
 *             tests/visual/rig-ai-settings.tsx, tests/lib/fonts.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * Invented data only; no Claude request is made.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { AI_INSTRUCTION_BLOCKS } from '@kite/shared';
import { budgetFacts } from '../../src/server/aiBudget';
import { contractFor } from '../../src/server/prompts/contract';
import { DEFAULT_PROMPTS } from '../../src/server/prompts/defaults';
import { brandFonts } from '../lib/fonts';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the pictures go. */
const OUT = path.resolve(process.argv[2] ?? 'test-results/ai-settings-shots');

/** The part of postcss used here (not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

/**
 * Bundles the page and compiles the stylesheet.
 *
 * @returns The folder holding rig-ai-settings.js and rig.css.
 */
async function bundle(): Promise<string> {
  const outDir = mkdtempSync(path.join(tmpdir(), 'kite-ai-settings-rig-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'visual', 'rig-ai-settings.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: outDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    alias: {
      'next/link': path.join(WEB_DIR, 'tests', 'integration', 'harness', 'next-link-stub.tsx'),
      'next/navigation': path.join(
        WEB_DIR,
        'tests',
        'integration',
        'harness',
        'next-navigation-stub.ts',
      ),
    },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  const fromTailwind = createRequire(
    createRequire(import.meta.url).resolve('@tailwindcss/postcss'),
  );
  const postcss = fromTailwind('postcss') as PostcssRunner;
  const from = path.join(WEB_DIR, 'app', 'globals.css');
  const result = await postcss([tailwind({ base: WEB_DIR })]).process(readFileSync(from, 'utf8'), {
    from,
  });
  writeFileSync(path.join(outDir, 'rig.css'), result.css);
  return outDir;
}

/**
 * The page's HTML, with the default prompts, the contracts and the budget facts from the server code.
 *
 * @returns The HTML.
 */
function html(): string {
  const contracts = Object.fromEntries(
    AI_INSTRUCTION_BLOCKS.map((block) => [block, contractFor(block)]),
  );
  // Escaped so no prompt text can close the script tag.
  const data = JSON.stringify({
    defaults: DEFAULT_PROMPTS,
    contracts,
    budget: budgetFacts(),
  }).replaceAll('<', '\\u003c');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>AI settings rig</title><link rel="stylesheet" href="/rig/rig.css">' +
    brandFonts(true) +
    `</head><body class="font-sans"><div id="root"></div><script>window.__AI_SETTINGS__=${data}</script>` +
    '<script type="module" src="/rig/rig-ai-settings.js"></script></body></html>'
  );
}

/**
 * Serves the page on a free port.
 *
 * @param outDir The bundle folder.
 * @returns The base URL and a function that stops the server.
 */
async function serve(outDir: string): Promise<{ base: string; stop: () => void }> {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/rig/')) {
      const file = path.join(outDir, path.basename(url.split('?')[0]!));
      try {
        const content = readFileSync(file);
        res.writeHead(200, {
          'Content-Type': file.endsWith('.css') ? 'text/css' : 'text/javascript',
        });
        res.end(content);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(html());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, stop: () => server.close() };
}

/**
 * Opens a page and waits until the editor is on screen.
 *
 * @param page  The browser page.
 * @param url   The address.
 * @param ready Text that shows the page is ready.
 */
async function open(page: Page, url: string, ready: string): Promise<void> {
  await page.goto(url);
  await page.getByText(ready).first().waitFor();
  // The brand font, so the pictures look like the app.
  await page.evaluate(() => document.fonts.ready);
}

/** Builds, serves, takes the pictures, stops. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const { base, stop } = await serve(await bundle());
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let n = 0;
    /**
     * Saves the visible page.
     *
     * @param name The picture's name.
     */
    const shot = async (name: string) => {
      n += 1;
      await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) });
    };
    for (const tab of AI_INSTRUCTION_BLOCKS) {
      // Edit: the writing editor with its toolbar and the sticky actions bar.
      await open(page, `${base}/?tab=${tab}`, 'Live version: 3');
      await shot(`${tab}-edit`);
      // Preview: the prompt as a document.
      await open(page, `${base}/?tab=${tab}&mode=preview`, 'Live version: 3');
      await shot(`${tab}-preview`);
      // History: the versions with their badges.
      await open(page, `${base}/?tab=${tab}&history=1`, 'Moved from old settings');
      await shot(`${tab}-history`);
    }
    // The side-by-side comparison of version 1 with the live version.
    await open(page, `${base}/?tab=live&history=1`, 'Moved from old settings');
    await page.getByRole('button', { name: 'Compare' }).last().click();
    await page.getByText('Removed text on the left').waitFor();
    // The dialog's opening animation.
    await page.waitForTimeout(600);
    await shot('live-compare');
    // An edited draft with a layout line: the lint hint shows and Save stays enabled (no try needed).
    await open(page, `${base}/?tab=live&edited=1`, 'Unsaved changes');
    await page.getByText('Structure and personal preferences').scrollIntoViewIfNeeded();
    await shot('live-edited-save');
    // Dark theme.
    await open(page, `${base}/?tab=live&theme=dark`, 'Live version: 3');
    await shot('live-edit-dark');
    await open(page, `${base}/?tab=notes&history=1&theme=dark`, 'Moved from old settings');
    await shot('notes-history-dark');
    console.info(`ai settings shots: ${n} pictures in ${OUT}`);
  } finally {
    await browser.close();
    stop();
  }
}

void main();
