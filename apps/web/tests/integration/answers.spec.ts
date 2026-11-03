/**
 * Harness test for the live answer UI (day-04-answers.md Stage 6), no sign-in, runs in CI.
 * Covers, with the real LiveAnswers component on a fixture transcript and a mocked, slowly
 * streaming /api/answer: the Answer hotkey (Ctrl+Enter) sends an answer request built from the
 * transcript (stable lines in the conversation, the question "from N lines"); the headline
 * appears before the bullets; Copy puts the clean answer on the clipboard; Cancel stops a
 * streaming answer (no bullets ever arrive); Previous / Next move between answers; Chat sends a
 * typed question (mode chat); the second request's conversation starts with the first's chunk
 * and adds the earlier answer (append-only). Stage 7: finished answers are saved (a cancelled
 * one is not); a rating and a note survive a reload; deleting the session removes its answers.
 * Day 5: the browser compact view opens in Document Picture-in-Picture where the browser has
 * it (else a clear message); a second page with the real compact view shows the live answer, and its Answer
 * button and typed question make the live page answer.
 * ADR-0030: the switch next to the chat box goes in the request and is remembered; a private answer
 * shows code with its own Copy; the type and source tags show, and choosing another type answers
 * again; a figure in no document is underlined with a "check before saying" note; a repeated
 * question sends the earlier answer; other answers are listed newest first.
 * All text is invented.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import type { AnswerRequest } from '@kite/shared';
import { build } from 'esbuild';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The mocked answer: a headline, then (after a pause) two bullets. */
const HEADLINE = 'Forty seats cost 2,080 dollars a month.';
const BULLETS = ['52 dollars per seat on Professional', 'Billed yearly'];

/** Pause between the headline and the bullets, so the test can see the order (and cancel). */
const BULLET_DELAY_MS = 1_500;

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
 * @param bundleDir Folder with answers.js.
 * @returns The server and its origin.
 */
async function serve(bundleDir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'POST' && req.url === '/api/answer') {
        const request = JSON.parse(await bodyOf(req)) as AnswerRequest;
        received.push(request);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const event = (name: string, data: unknown) =>
          res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        const done = () =>
          event('done', {
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 900,
            },
            ms: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 3, toFirstText: 4, total: 5 },
          });
        if (request.mode === 'warm') {
          done();
          res.end();
          return;
        }
        // ADR-0030: a question that asks for it gets the hidden line's contents and a richer answer.
        if (request.question?.startsWith('rich:') || request.answerType) {
          const target = request.target ?? 'call';
          event('meta', {
            meta: { type: request.answerType ?? 'coding', target, source: 'general' },
          });
          event('delta', {
            text:
              target === 'kite'
                ? 'Use **a loop**.\n```python\nprint(1)\n```'
                : 'We saved 37 percent last year.\n- Fixed yearly\nSay: I would keep it short.',
          });
          done();
          res.end();
          return;
        }
        const headline = request.mode === 'chat' ? 'The seat price is 52 dollars.' : HEADLINE;
        // As the real server does for every answer: the hidden line's contents come first, as their
        // own event (recorded streams in tests/fixtures/answers: meta → delta… → done).
        event('meta', { meta: { type: 'sales', target: 'call', source: 'docs' } });
        event('delta', { text: headline });
        await new Promise((resolve) => setTimeout(resolve, BULLET_DELAY_MS));
        if (res.destroyed) return;
        event('delta', { text: `\n- ${BULLETS[0]}\n- ${BULLETS[1]}` });
        done();
        res.end();
        return;
      }
      if (req.url === '/harness/answers.js' || req.url === '/harness/compact.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(readFileSync(path.join(bundleDir, path.basename(req.url))));
        return;
      }
      if (req.url === '/compact-harness') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<!doctype html><html><head><meta charset="utf-8"><title>Kite compact harness</title></head>' +
            '<body><div id="root"></div><script type="module" src="/harness/compact.js"></script></body></html>',
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Kite answer harness</title></head>' +
          '<body><div id="root"></div><script type="module" src="/harness/answers.js"></script></body></html>',
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, origin: `http://127.0.0.1:${port}` };
}

/** The page's Document Picture-in-Picture API, as far as the test reads it. */
interface PipApi {
  /** The open picture-in-picture window, or null. */
  window: Window | null;
}

/** A window with that API (Chrome / Edge 116+). */
interface WithPip {
  /** The API. */
  documentPictureInPicture: PipApi;
}

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let page: Page;
let origin = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-answers-test-'));
  await build({
    entryPoints: [
      path.join(WEB_DIR, 'tests', 'integration', 'harness', 'answers.tsx'),
      path.join(WEB_DIR, 'tests', 'integration', 'harness', 'compact.tsx'),
    ],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    // Resolves the `@/*` alias the same way the app does.
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    // Next.js compiles JSX itself (tsconfig "jsx": "preserve"); here esbuild must.
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  ({ server, origin } = await serve(bundleDir));
  browser = await chromium.launch();
  // A context of its own, so the compact view test can open a second page in it.
  page = await (await browser.newContext()).newPage();
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test('the Answer hotkey streams the headline before the bullets', async () => {
  // Focus the page body (not a text box), then the §7.3 Windows/Linux shortcut.
  await page.locator('body').click();
  await page.keyboard.press('Control+Enter');
  const headline = page.getByRole('heading', { name: 'Answer headline' });
  await expect(headline).toHaveText(HEADLINE);
  // The bullets have not arrived yet: the server waits before sending them.
  await expect(page.getByRole('list', { name: 'Answer details' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Answer details' }).getByRole('listitem')).toHaveText(
    BULLETS,
    { timeout: 10_000 },
  );
  await expect(page.getByText('1 of 1')).toBeVisible();
  await expect(page.getByText('from 2 lines')).toBeVisible();
  await expect(page.getByLabel('Question used')).toHaveText(
    'SO WHAT WOULD THE PROFESSIONAL PLAN COST FOR FORTY SEATS',
  );
  await expect(page.getByLabel('Time to first word')).toBeVisible();

  const request = received.find((body) => body.mode === 'answer')!;
  expect(request.question).toBe('SO WHAT WOULD THE PROFESSIONAL PLAN COST FOR FORTY SEATS');
  expect(request.conversation).toHaveLength(1);
  expect(request.conversation![0]!.length).toBe(4);
});

test('Copy puts the clean answer on the clipboard', async () => {
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => window.kiteAnswerHarness.copied);
  expect(copied).toEqual([`${HEADLINE}\n- ${BULLETS[0]}\n- ${BULLETS[1]}`]);
});

test('Cancel stops a streaming answer', async () => {
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Answer headline' })).toHaveText(HEADLINE);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();
  // Longer than the server's pause: the bullets never arrive.
  await page.waitForTimeout(BULLET_DELAY_MS + 500);
  await expect(page.getByRole('list', { name: 'Answer details' })).toHaveCount(0);

  // Append-only: the second request repeats the first chunk and adds the earlier answer.
  const [first, second] = received.filter((body) => body.mode === 'answer');
  expect(second!.conversation![0]).toEqual(first!.conversation![0]);
  expect(second!.conversation![1]).toEqual([
    expect.objectContaining({ kind: 'answer', mode: 'answer', question: first!.question }),
  ]);
});

test('Previous and Next move between answers', async () => {
  await page.getByRole('button', { name: 'Previous answer' }).click();
  await expect(page.getByText('1 of 2')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Answer details' }).getByRole('listitem')).toHaveText(
    BULLETS,
  );
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expect(page.getByText('Stopped.')).toBeVisible();
});

test('Chat sends a typed question', async () => {
  await page.getByRole('button', { name: 'Chat' }).click();
  const box = page.getByLabel('Type a question');
  await box.fill('What is the seat price?');
  await box.press('Enter');
  await expect(page.getByRole('heading', { name: 'Answer headline' })).toHaveText(
    'The seat price is 52 dollars.',
  );
  await expect(page.getByText('typed question')).toBeVisible();
  await expect(box).toHaveValue('');
  const chat = received.find((body) => body.mode === 'chat')!;
  expect(chat.question).toBe('What is the seat price?');
  // Escape clears the box.
  await box.fill('Something else');
  await box.press('Escape');
  await expect(box).toHaveValue('');
});

test('a rating and a note survive a reload', async () => {
  await page.getByRole('button', { name: 'Bad answer' }).click();
  await expect(page.getByRole('button', { name: 'Bad answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('What was wrong / better answer').fill('Give the monthly total too.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByLabel('Your note')).toContainText('Give the monthly total too.');

  // Finished answers are saved; the cancelled one is not.
  await expect
    .poll(() => page.evaluate(() => window.kiteAnswerHarness.saved()))
    .toEqual([
      { mode: 'answer', rating: null, note: '' },
      { mode: 'chat', rating: 'down', note: 'Give the monthly total too.' },
    ]);

  await page.reload();
  await page.getByRole('button', { name: 'Show last answer' }).click();
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expect(page.getByText('(earlier)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bad answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Your note')).toContainText('Give the monthly total too.');
});

test('deleting the session removes its answers', async () => {
  await page.evaluate(() => window.kiteAnswerHarness.deleteSession());
  expect(await page.evaluate(() => window.kiteAnswerHarness.saved())).toEqual([]);
});

test('the compact view shows the live answer and its Answer button asks the live page (Day 5)', async () => {
  // A second page in the same browser, like the desktop compact window.
  const compact = await page.context().newPage();
  await compact.goto(`${origin}/compact-harness`);
  // Nothing has been answered since the reload: the live page says so.
  await expect(compact.getByLabel('Latest words')).toContainText('For forty seats');
  await expect(compact.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  await compact.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(compact.getByRole('heading', { name: 'Answer line' })).toHaveText(HEADLINE);
  // The live page answered it (the same answer shows there).
  await expect(page.getByRole('heading', { name: 'Answer headline' })).toHaveText(HEADLINE);
  // A typed question from the overlay goes to the live page as chat.
  await compact.getByRole('button', { name: 'Chat' }).click();
  await compact.getByLabel('Type a question').fill('What is the seat price?');
  await compact.getByLabel('Type a question').press('Enter');
  await expect(compact.getByRole('heading', { name: 'Answer line' })).toHaveText(
    'The seat price is 52 dollars.',
  );
  // Answer preferences change from the overlay's menu; the next answer uses them.
  await compact.getByRole('button', { name: 'Overlay menu' }).click();
  await expect(compact.getByLabel('Tone')).toHaveValue('simple');
  await compact.getByLabel('Tone').selectOption('technical');
  await compact.getByLabel('Format').selectOption('bullets');
  await expect(compact.getByLabel('Tone')).toHaveValue('technical');
  await compact.getByRole('button', { name: 'Overlay menu' }).click();
  await compact.getByRole('button', { name: 'Chat' }).click();
  await compact.getByLabel('Type a question').fill('What is the seat price?');
  await compact.getByLabel('Type a question').press('Enter');
  await expect
    .poll(() => received.at(-1)?.session?.style)
    .toMatchObject({ tone: 'technical', format: 'bullets' });
  await compact.close();
});

test('Compact view in the browser: picture-in-picture, or a clear message where unsupported (Day 5)', async () => {
  const supported = await page.evaluate(() => 'documentPictureInPicture' in window);
  await page.getByRole('button', { name: 'Overlay' }).click();
  if (!supported) {
    await expect(
      page.getByText('This browser cannot show a small window on top of the meeting'),
    ).toBeVisible();
    console.log(
      '[harness] compact view: no Document Picture-in-Picture here, fallback message shown',
    );
    return;
  }
  // The picture-in-picture window renders the real compact view, linked to this live page.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as WithPip).documentPictureInPicture.window?.document.body.innerText ??
          '',
      ),
    )
    .toContain('Screenshot');
  const headline = await page.getByRole('heading', { name: 'Answer headline' }).textContent();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as WithPip).documentPictureInPicture.window?.document.querySelector(
            '[aria-label="Answer line"]',
          )?.textContent ?? '',
      ),
    )
    .toBe(headline);
  console.log('[harness] compact view: picture-in-picture window opened and shows the live answer');
});

test('the chat switch goes in the request, a private answer has code with Copy, and it is remembered', async () => {
  await page.reload();
  await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chat', exact: false }).first().click();
  const before = received.length;
  await page.getByLabel('Who the answer is for').selectOption('kite');
  await page.getByLabel('Type a question').fill('rich: how do I loop?');
  await page.getByLabel('Type a question').press('Enter');
  const answer = page.getByLabel('Private answer');
  await expect(answer).toContainText('a loop');
  await expect(answer.locator('strong')).toHaveText('a loop');
  await answer.getByRole('button', { name: 'Copy code' }).click();
  await expect(answer.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => window.kiteAnswerHarness.copied);
  expect(copied.at(-1)).toBe('print(1)');
  const sent = received.slice(before).find((body) => body.mode === 'chat')!;
  expect(sent.target).toBe('kite');
  // The typed question is never a "You" line: nothing but an answer carries it.
  expect(JSON.stringify(sent.tail ?? [])).not.toContain('how do I loop');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chat', exact: false }).first().click();
  await expect(page.getByLabel('Who the answer is for')).toHaveValue('kite');
  await page.getByLabel('Who the answer is for').selectOption('auto');
});

test('tags show, a figure in no document is flagged, and another type answers again', async () => {
  await page.getByLabel('Type a question').fill('rich: what did you save?');
  await page.getByLabel('Type a question').press('Enter');
  await expect(page.getByRole('heading', { name: 'Answer headline' })).toContainText('37 percent');
  const tags = page.getByLabel('About this answer');
  await expect(tags).toContainText('General knowledge');
  await expect(page.getByLabel('How to say it')).toContainText('keep it short');
  // The claim check, with no model call: underlined, with a private note.
  await expect(page.locator('[data-claim]').first()).toHaveText('37');
  await expect(page.getByLabel('Check before saying')).toContainText('37');
  // Copy leaves the note and the tags out.
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const copied = await page.evaluate(() => window.kiteAnswerHarness.copied);
  expect(copied.at(-1)).not.toContain('Check before');
  expect(copied.at(-1)).not.toContain('General knowledge');

  const before = received.length;
  await tags.getByRole('combobox').selectOption('design');
  await expect(page.getByLabel('About this answer').getByRole('combobox')).toHaveValue('design');
  expect(received.slice(before).find((body) => body.answerType)?.answerType).toBe('design');
});

test('a repeated question sends the earlier answer, and other answers are newest first', async () => {
  const ask = async (question: string) => {
    await page.getByLabel('Type a question').fill(question);
    await page.getByLabel('Type a question').press('Enter');
  };
  await ask('what does the seat cost');
  await expect(page.getByRole('heading', { name: 'Answer headline' })).toHaveText(
    'The seat price is 52 dollars.',
  );
  await expect(page.getByRole('list', { name: 'Answer details' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Answering…')).toHaveCount(0);
  const before = received.length;
  await ask('sorry what does the seat cost again');
  await expect(page.getByRole('list', { name: 'Answer details' })).toBeVisible({ timeout: 10_000 });
  const repeat = received.slice(before).find((body) => body.mode === 'chat')!;
  expect(repeat.similar?.question).toBe('what does the seat cost');
  expect(repeat.similar?.text).toContain('52 dollars');

  const others = page.getByRole('list', { name: 'Other answers' }).getByRole('button');
  await expect(others.first()).toHaveText('what does the seat cost');
  await others.first().click();
  await expect(page.getByLabel('Question used')).toHaveText('what does the seat cost');
});

test('an answer survives the parent re-rendering with a fresh session object (v1.0.0 fix)', async () => {
  // The production failure: the live page passed a new (equal) session object on every render,
  // the answer hook took it for a new call and cancelled the answer in flight, and the card sat on
  // "…". Here the parent re-renders every 50 ms through a slow (1.5 s) stream.
  const context = await browser!.newContext();
  const rerendering = await context.newPage();
  await rerendering.goto(`${origin}/?rerender`);
  await rerendering.locator('body').click();
  await rerendering.keyboard.press('Control+Enter');
  await expect(rerendering.getByRole('heading', { name: 'Answer headline' })).toHaveText(HEADLINE);
  await expect(
    rerendering.getByRole('list', { name: 'Answer details' }).getByRole('listitem'),
  ).toHaveText(BULLETS, { timeout: 10_000 });
  await expect(rerendering.getByText('Stopped.')).toHaveCount(0);
  await context.close();
});
