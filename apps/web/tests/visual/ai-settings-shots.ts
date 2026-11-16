/**
 * File: apps/web/tests/visual/ai-settings-shots.ts
 * Purpose: Pictures of Admin → AI settings (ADR-0086) for the visual check: the real page component with
 *          the real built-in rules and invented data, in simple mode (a try with the draft), in advanced
 *          mode (an edited prompt, tried, ready to save), with a draft prompt that lost two required
 *          rules (what the check names), simple mode in the dark theme, and (ADR-0087) the built-in
 *          change notice with its "View changes" diff. Builds the page, serves it on
 *          a free port with a mocked try endpoint, captures the PAGE only (never the screen) in headless
 *          Microsoft Edge, and exits.
 *          Usage: pnpm --filter web exec tsx --conditions=react-server tests/visual/ai-settings-shots.ts <out dir>
 * Used by: the developer (not part of the automated suites)
 * Depends on: esbuild, @tailwindcss/postcss, @playwright/test (Edge), src/server/aiTry.ts (lockedRulesFor,
 *             budgetFacts), tests/visual/rig-ai-settings.tsx, tests/lib/fonts.ts
 * Architecture: docs/decisions/ADR-0086-full-system-prompt-editing.md
 *
 * Invented data only; no Claude request is made (the try endpoint is mocked).
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
import { budgetFacts, lockedRulesFor } from '../../src/server/aiTry';
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
 * The page's HTML, with the built-in rules and budget facts from the server code.
 *
 * @returns The HTML.
 */
function html(): string {
  const locked = Object.fromEntries(
    AI_INSTRUCTION_BLOCKS.map((block) => [block, lockedRulesFor(block)]),
  );
  // Escaped so no rule text can close the script tag.
  const data = JSON.stringify({ locked, budget: budgetFacts() }).replaceAll('<', '\\u003c');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>AI settings rig</title><link rel="stylesheet" href="/rig/rig.css">' +
    brandFonts(true) +
    `</head><body class="font-sans"><div id="root"></div><script>window.__AI_SETTINGS__=${data}</script>` +
    '<script type="module" src="/rig/rig-ai-settings.js"></script></body></html>'
  );
}

/**
 * Serves the page and a mocked try endpoint on a free port.
 *
 * @param outDir The bundle folder.
 * @returns The base URL and a function that stops the server.
 */
async function serve(outDir: string): Promise<{ base: string; stop: () => void }> {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url === '/api/admin/ai-instructions/try') {
      const parts: Buffer[] = [];
      req.on('data', (part: Buffer) => parts.push(part));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as { prompt?: unknown };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            kind: 'answer',
            text: 'I calmed a frustrated client by listening first, then fixing the issue.\n- I confirmed what went wrong and owned it.\n- I agreed a clear fix and a date, and met it.',
            meta: { type: 'behavioural', target: 'call', source: 'example' },
            ...(body.prompt ? { promptToken: 'f'.repeat(64) } : {}),
          }),
        );
      });
      return;
    }
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

    // 1. Simple mode: the instructions box, a try with the draft, Save.
    await open(page, base, 'Instructions for the AI');
    await page
      .getByLabel('Sample question (as the other person asks it)')
      .first()
      .fill('Tell me about a time you handled a difficult client.');
    await page.getByRole('button', { name: 'Try with draft' }).first().click();
    await page.getByTestId('try-reply').first().waitFor();
    await page.screenshot({ path: path.join(OUT, '1-simple-mode.png'), fullPage: true });

    // 2. Advanced mode: an edited prompt, tried, ready to save.
    await open(page, `${base}/?mode=advanced`, 'Live answers: full system prompt');
    const editor = page.locator('section[aria-label="Live answers full system prompt"]');
    const reminder = editor.getByLabel('Reminder added after the question');
    await reminder.fill(`${await reminder.inputValue()} Keep every answer under 30 seconds.`);
    await editor
      .getByLabel('Sample question (as the other person asks it)')
      .fill('Tell me about a time you handled a difficult client.');
    await editor.getByRole('button', { name: 'Try with this prompt' }).click();
    await editor.getByTestId('try-reply').waitFor();
    await editor.getByText('Tried: ready to save.').waitFor();
    await page.screenshot({ path: path.join(OUT, '2-advanced-mode.png'), fullPage: true });

    // 3. Advanced mode with a draft that lost the hidden last line and the none rule.
    const core = editor.getByLabel('Rules for every live answer');
    const text = (await core.inputValue())
      .split('\n')
      .filter((line) => !line.includes('[[question|') && !line.startsWith('- none:'))
      .join('\n');
    await core.fill(text);
    await editor.getByTestId('prompt-problems').waitFor();
    await editor.getByTestId('prompt-problems').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, '3-advanced-missing-rules.png') });

    // 4. Simple mode, dark theme.
    await open(page, `${base}/?theme=dark`, 'Instructions for the AI');
    await page.screenshot({ path: path.join(OUT, '4-simple-mode-dark.png'), fullPage: true });

    // 5. ADR-0087: a custom prompt older than the built-in rules: the notice, then "View changes".
    await open(page, `${base}/?change=1`, 'Built-in rules were updated on');
    await page.screenshot({ path: path.join(OUT, '5-built-in-change-notice.png') });
    await page.getByRole('button', { name: 'View changes' }).click();
    await page.getByTestId('version-diff').waitFor();
    // The dialog's opening animation.
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '6-built-in-changes-diff.png') });
    console.info(`ai settings shots: ${OUT}`);
  } finally {
    await browser.close();
    stop();
  }
}

void main();
