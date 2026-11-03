/**
 * Harness test for the Ask Kite page (ADR-0030), no sign-in, runs in CI. With the real page and its
 * real storage, and a mocked /api/answer: a question streams an answer with a code block; the hidden
 * line never shows; the chat stays after a reload; a follow-up sends the chat so far; a library item
 * and a past session can be attached and are sent; a pasted screenshot is sent as a JPEG and is not
 * kept; a chat can be deleted. It fits at phone width with no sideways scrolling.
 * All text is invented.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import type { AnswerRequest } from '@kite/shared';
import { build } from 'esbuild';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every request body the mocked /api/answer received, in order. */
const received: AnswerRequest[] = [];

/**
 * Reads a request body.
 *
 * @param req The request.
 * @returns The body text.
 */
async function bodyOf(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

/**
 * Serves the page, the bundle and the mocked /api/answer.
 *
 * @param bundleDir Folder with ask-kite.js.
 * @returns The server and its origin.
 */
async function serve(bundleDir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'POST' && req.url === '/api/answer') {
        received.push(JSON.parse(await bodyOf(req)) as AnswerRequest);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const event = (name: string, data: unknown) =>
          res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        event('meta', { meta: { type: 'coding', target: 'kite', source: 'general' } });
        event('delta', { text: 'Here is how.\n```python\nprint("hi")\n```' });
        event('done', {
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          ms: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 3, toFirstText: 4, total: 5 },
        });
        res.end();
        return;
      }
      if (req.url === '/harness/ask-kite.js' || req.url === '/harness/ask-kite.css') {
        const css = req.url.endsWith('.css');
        res.writeHead(200, { 'Content-Type': css ? 'text/css' : 'text/javascript' });
        res.end(readFileSync(path.join(bundleDir, path.basename(req.url))));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Ask Kite harness</title>' +
          '<link rel="stylesheet" href="/harness/ask-kite.css"></head>' +
          '<body><div id="root"></div><script type="module" src="/harness/ask-kite.js"></script></body></html>',
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, origin: `http://127.0.0.1:${port}` };
}

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let page: Page;
let origin = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-ask-kite-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'ask-kite.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    // Resolves the `@/*` alias the same way the app does.
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    // Next.js compiles JSX itself (tsconfig "jsx": "preserve"); here esbuild must.
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    // The theme's @import lines are for the app's Tailwind build: not needed for behaviour.
    loader: { '.css': 'empty' },
    logLevel: 'error',
  });
  // esbuild writes no CSS for an empty loader, and the page still links one.
  rmSync(path.join(bundleDir, 'ask-kite.css'), { force: true });
  writeFileSync(path.join(bundleDir, 'ask-kite.css'), '');
  ({ server, origin } = await serve(bundleDir));
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  page = await context.newPage();
  await page.goto(origin);
  await expect(page.getByLabel('Ask Kite', { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test('a question streams an answer with code, and the hidden line never shows', async () => {
  await page.getByLabel('Ask Kite', { exact: true }).fill('How do I print in Python?');
  await page.getByLabel('Ask Kite', { exact: true }).press('Enter');
  const answer = page.getByRole('listitem', { name: 'Kite answered' });
  await expect(answer).toContainText('Here is how.');
  await expect(answer.locator('pre')).toHaveText('print("hi")');
  await expect(answer).not.toContainText('[[');
  await expect(answer.getByLabel('About this answer')).toContainText('Coding');
  await expect(answer.getByLabel('About this answer')).toContainText('General knowledge');
  expect(received.at(-1)).toMatchObject({ mode: 'kite', question: 'How do I print in Python?' });
});

test('the chat stays after a reload, and a follow-up sends the chat so far', async () => {
  await page.reload();
  const chats = page.getByRole('navigation', { name: 'Chats' });
  await chats.getByRole('button', { name: 'How do I print in Python?', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'Kite answered' })).toContainText('Here is how.');
  await page.getByLabel('Ask Kite', { exact: true }).fill('And in Go?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('listitem', { name: 'Kite answered' })).toHaveCount(2);
  expect(received.at(-1)?.history).toEqual([
    { role: 'you', text: 'How do I print in Python?' },
    { role: 'kite', text: 'Here is how.\n```python\nprint("hi")\n```' },
  ]);
});

test('a library item and a past session can be attached, and are sent', async () => {
  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('button', { name: 'invented-cv.txt' }).click();
  const attached = page.getByRole('list', { name: 'Attached' });
  await expect(attached).toContainText('invented-cv.txt');
  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('button', { name: /Quillon Labs/ }).click();
  await expect(attached).toContainText('Session: Quillon Labs');
  await page.getByLabel('Ask Kite', { exact: true }).fill('From these, what stands out?');
  await page.getByLabel('Ask Kite', { exact: true }).press('Enter');
  await expect(page.getByRole('listitem', { name: 'Kite answered' })).toHaveCount(3);
  const sent = received.at(-1)!;
  expect(sent.attachments?.map((item) => item.name)).toEqual([
    'invented-cv.txt',
    expect.stringContaining('Session: Quillon Labs'),
  ]);
  expect(sent.attachments?.[1]?.text).toContain('An invented interview.');
  await attached.getByRole('button', { name: 'Remove invented-cv.txt' }).click();
  await expect(attached).not.toContainText('invented-cv.txt');
});

test('a pasted screenshot is sent as a JPEG and is not kept', async () => {
  // A small PNG, pasted the way a browser delivers one.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('textarea')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
  });
  await expect(
    page.getByRole('list', { name: 'Screenshots to send' }).getByRole('img'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('listitem', { name: 'Kite answered' })).toHaveCount(4);
  const sent = received.at(-1)!;
  expect(sent.images).toHaveLength(1);
  expect(sent.images![0]).toMatch(/^data:image\/jpeg;base64,/);
  expect(sent.question).toBeUndefined();
  await expect(page.getByRole('listitem', { name: 'You asked' }).last()).toContainText('not kept');
  // Only the count is stored: the image is in no row of the database.
  const stored = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('kite');
        open.onerror = () => reject(new Error('open failed'));
        open.onsuccess = () => {
          const all = open.result.transaction('chats').objectStore('chats').getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
        };
      }),
  );
  expect(stored).not.toContain('data:image');
});

test('it fits at phone width with no sideways scrolling', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(wide).toBe(false);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('a chat can be deleted', async () => {
  const chats = page.getByRole('navigation', { name: 'Chats' });
  await chats
    .getByRole('button', { name: /^Delete / })
    .first()
    .click();
  await expect(chats.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await expect(page.getByText('Ask anything: an explanation')).toBeVisible();
});
