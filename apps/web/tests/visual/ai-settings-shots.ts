/**
 * File: apps/web/tests/visual/ai-settings-shots.ts
 * Purpose: Pictures of Admin → AI settings (ADR-0089) for the visual check: the real page component with
 *          the real default prompts and app contracts and invented data. For each tab (Live answers, AI
 *          notes, Ask AI): Edit, Preview, History and a Try it with its reply; then the live answers
 *          Quality check, the side-by-side comparison of a version, an edited draft tried and ready to
 *          save, and Edit and History in the dark theme. Builds the page, serves it on a free port with
 *          mocked try and quality endpoints, captures the PAGE only (never the screen) in headless
 *          Microsoft Edge, and exits.
 *          Usage: pnpm --filter web exec tsx --conditions=react-server tests/visual/ai-settings-shots.ts <out dir>
 * Used by: the developer (not part of the automated suites)
 * Depends on: esbuild, @tailwindcss/postcss, @playwright/test (Edge), src/server/aiTry.ts (budgetFacts),
 *             src/server/prompts/defaults.ts, src/server/prompts/contract.ts (contractFor),
 *             tests/visual/rig-ai-settings.tsx, tests/lib/fonts.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * Invented data only; no Claude request is made (the endpoints are mocked).
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
import { budgetFacts } from '../../src/server/aiTry';
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
 * The mocked reply of a try, by tab (invented).
 *
 * @param block The tab tried.
 * @returns The JSON reply.
 */
function tryReply(block: string): unknown {
  if (block === 'notes') {
    return {
      kind: 'notes',
      notes: {
        summary: ['They asked about per-seat pricing.', 'A proposal is due before Friday.'],
        questions: [{ question: 'Pricing per seat?', at: 0, answered: 'no', rating: null }],
        nextSteps: [{ step: 'Send the proposal by Thursday', owner: 'You' }],
        unclear: [],
        lessons: [],
      },
      promptToken: 'f'.repeat(64),
    };
  }
  if (block === 'ask') {
    return {
      kind: 'answer',
      text: 'Here is a short follow-up you can send:\n\nThanks for your time today. As promised, I will send the proposal by Thursday.\n\nThe Northwind team',
      meta: { type: 'sales', target: 'kite', source: 'general' },
      question: null,
      promptToken: 'f'.repeat(64),
    };
  }
  return {
    kind: 'answer',
    text: 'I would listen first, then agree a clear fix and a date.\n- Let them explain the problem fully before answering.\n- Confirm the fix in writing, with a date I can meet.\n- Check back after the fix to make sure it held.',
    meta: { type: 'behavioural', target: 'call', source: 'general' },
    question: 'How have you handled a difficult client?',
    promptToken: 'f'.repeat(64),
  };
}

/** The mocked quality check (invented scores). */
const QUALITY = {
  score: 8.9,
  liveScore: 9.3,
  warning:
    'The score dropped by 0.4 compared with the live version. Failed: Documents cannot answer.',
  costDollars: 0.031,
  promptToken: 'f'.repeat(64),
  scenarios: [
    ['no-cv-behavioural', 'Behavioural question, no CV', 'honesty', 9.5, true, ''],
    [
      'docs-cannot-answer',
      'Documents cannot answer',
      'honesty',
      6.3,
      false,
      'It said yes to an ISO certification the documents do not state.',
    ],
    ['behavioural-with-cv', 'Behavioural question with a CV', 'honesty', 10, true, ''],
    ['coding', 'Coding question', 'format', 10, true, ''],
    ['concept', 'Concept question', 'quality', 8.8, true, 'Health checks were not mentioned.'],
    ['smalltalk', 'Small talk', 'format', 10, true, ''],
    ['none', 'Nothing asked (no answer)', 'format', 10, true, ''],
    [
      'format-compliance',
      "User's paragraph format",
      'format',
      6.9,
      true,
      'Slightly long for a short answer.',
    ],
  ].map(([id, title, kind, score, passed, reason]) => ({ id, title, kind, score, passed, reason })),
};

/**
 * Serves the page and the mocked try and quality endpoints on a free port.
 *
 * @param outDir The bundle folder.
 * @returns The base URL and a function that stops the server.
 */
async function serve(outDir: string): Promise<{ base: string; stop: () => void }> {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url.startsWith('/api/admin/ai-instructions/')) {
      const parts: Buffer[] = [];
      req.on('data', (part: Buffer) => parts.push(part));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as { block?: string };
        const reply = url.endsWith('/quality') ? QUALITY : tryReply(body.block ?? 'live');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply));
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

/** The sample typed into Try it, by tab. */
const SAMPLES = {
  live: 'Tell me about a time you handled a difficult client.',
  notes:
    'Them: Can you walk me through pricing per seat?\nYou: Sure, I will send a proposal by Thursday.',
  ask: 'Draft a short follow-up email after a sales call.',
} as const;

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
      await open(page, `${base}/?tab=${tab}&panel=history`, 'Moved from old settings');
      await shot(`${tab}-history`);
      // Try it: a sample, then the reply as users see it.
      await open(page, `${base}/?tab=${tab}&panel=try`, 'Run Try it');
      const panel = page.locator('section[aria-label^="Try "]').filter({ visible: true });
      await panel.getByRole('textbox').first().fill(SAMPLES[tab]);
      await panel.getByRole('button', { name: 'Run Try it' }).click();
      await panel
        .locator(tab === 'notes' ? 'h4' : '[data-testid="try-reply"]')
        .first()
        .waitFor();
      await panel.scrollIntoViewIfNeeded();
      await shot(`${tab}-try-it`);
    }
    // Quality check (live answers only), with a drop and a failed case.
    await open(page, `${base}/?tab=live&panel=quality`, 'Run quality check');
    await page.getByRole('button', { name: 'Run quality check' }).click();
    await page.getByTestId('quality-result').waitFor();
    await shot('live-quality-check');
    // The side-by-side comparison of version 1 with the live version.
    await open(page, `${base}/?tab=live&panel=history`, 'Moved from old settings');
    await page.getByRole('button', { name: 'Compare' }).last().click();
    await page.getByText('Removed text on the left').waitFor();
    // The dialog's opening animation.
    await page.waitForTimeout(600);
    await shot('live-compare');
    // An edited draft, tried: Save enabled, with the lint hint for the new line.
    await open(page, `${base}/?tab=live&edited=1`, 'Unsaved changes');
    await shot('live-edited-tried');
    // Dark theme.
    await open(page, `${base}/?tab=live&theme=dark`, 'Live version: 3');
    await shot('live-edit-dark');
    await open(page, `${base}/?tab=notes&panel=history&theme=dark`, 'Moved from old settings');
    await shot('notes-history-dark');
    console.info(`ai settings shots: ${n} pictures in ${OUT}`);
  } finally {
    await browser.close();
    stop();
  }
}

void main();
