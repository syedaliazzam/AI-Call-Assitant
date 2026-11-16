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
 * it (else a clear message); a second page with the real compact view shows the live answer, and its
 * Answer key (Ctrl+Enter) makes the live page answer. ADR-0082: the overlay has no Answer, Screenshot or
 * Chat buttons and no message box; Ctrl+Backspace there clears the answers on both pages.
 * ADR-0030: the switch next to the chat box goes in the request and is remembered; a private answer
 * shows code with its own Copy; the type and source tags show, and choosing another type answers
 * again; a figure in no document is underlined with a "check before saying" note; a repeated
 * question sends the earlier answer. ADR-0094: the overlay switches the answer model mid-call: an answer
 * already streaming finishes on the old model, the next one uses the new one, the new model is warmed and
 * saved with the session, and Smart stays off when an admin has turned it off.
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

/** ADR-0094: true while the mocked admin setting has the deeper model turned off. */
let smartOff = false;

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
      if (req.url === '/api/models') {
        // ADR-0094: the admin's switch, as GET /api/models says it.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deepModel: !smartOff }));
        return;
      }
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
            // ADR-0094: the tier that answered, as the real server says (fast when Smart is off).
            model: request.model === 'smart' && !smartOff ? 'smart' : 'fast',
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
  await expect(page.getByRole('button', { name: 'Answer', exact: true }).first()).toBeVisible();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test('the Answer hotkey streams the answer line before the bullets', async () => {
  // Focus the page body (not a text box), then the §7.3 Windows/Linux shortcut.
  await page.locator('body').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  // The bullets have not arrived yet: the server waits before sending them.
  await expect(page.getByRole('list', { name: 'Answer details' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Answer details' }).getByRole('listitem')).toHaveText(
    BULLETS,
    { timeout: 10_000 },
  );
  await expect(page.getByLabel('Question', { exact: true })).toContainText(
    /what would the professional plan cost for forty seats/i,
  );
  await expect(page.getByLabel('Time to first word')).toBeVisible();

  const request = received.find((body) => body.mode === 'answer')!;
  expect(request.question).toBe('SO WHAT WOULD THE PROFESSIONAL PLAN COST FOR FORTY SEATS');
  expect(request.conversation).toHaveLength(1);
  expect(request.conversation![0]!.length).toBe(4);
});

test('Copy puts the clean answer on the clipboard', async () => {
  await page.getByRole('button', { name: 'Copy the answer' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => window.kiteAnswerHarness.copied);
  expect(copied).toEqual([`${HEADLINE}\n- ${BULLETS[0]}\n- ${BULLETS[1]}`]);
});

test('Cancel stops a streaming answer', async () => {
  // New speech: pressing Answer again on the same speech would show the answer it already has.
  await page.evaluate(() => window.kiteAnswerHarness.addThem('HOW LONG DOES ONBOARDING TAKE'));
  await page.getByRole('button', { name: 'Answer', exact: true }).first().click();
  await expect(page.getByRole('article', { name: 'Answer' })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();
  // Longer than the server's pause: the bullets never arrive.
  await page.waitForTimeout(BULLET_DELAY_MS + 500);
  await expect(page.getByRole('list', { name: 'Answer details' })).toHaveCount(0);

  // Append-only: the second request repeats the first chunk and adds the earlier answer.
  const [first, second] = received.filter((body) => body.mode === 'answer');
  expect(second!.conversation![0]).toEqual(first!.conversation![0]);
  expect(second!.conversation![1]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'answer', mode: 'answer', question: first!.question }),
    ]),
  );
});

test('Previous and Next move between answers', async () => {
  const selected = page.locator('article[aria-current="true"]');
  await page.locator('body').click();
  await page.keyboard.press('Control+ArrowLeft');
  await expect(
    selected.getByRole('list', { name: 'Answer details' }).getByRole('listitem'),
  ).toHaveText(BULLETS);
  await page.keyboard.press('Control+ArrowRight');
  await expect(selected.getByText('Stopped.')).toBeVisible();
});

test('Chat sends a typed question', async () => {
  await page.getByRole('button', { name: 'Chat' }).click();
  const box = page.getByLabel('Type a question');
  await expect(box).toBeFocused();
  await box.fill('What is the seat price?');
  await box.press('Enter');
  await expect(page.getByRole('heading', { name: 'Answer line' })).toContainText(
    'The seat price is 52 dollars.',
  );
  await expect(page.locator('article[aria-current="true"]').getByText('Typed')).toBeVisible();
  await expect(box).toHaveValue('');
  const chat = received.find((body) => body.mode === 'chat')!;
  expect(chat.question).toBe('What is the seat price?');
  // Escape clears the box.
  await box.fill('Something else');
  await box.press('Escape');
  await expect(box).toHaveValue('');
});

test('a rating and a report are saved, and survive a reload', async () => {
  await page.getByRole('button', { name: 'Bad answer' }).click();
  await expect(page.getByRole('button', { name: 'Bad answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Report this answer' }).click();
  await page.getByLabel('What was wrong?').fill('Give the monthly total too.');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(page.getByLabel('Your note')).toContainText('Give the monthly total too.');

  // Finished answers are saved; the cancelled one is not.
  await expect
    .poll(() => page.evaluate(() => window.kiteAnswerHarness.saved()))
    .toEqual([
      { mode: 'answer', rating: null, note: '' },
      { mode: 'chat', rating: 'down', note: 'Give the monthly total too.' },
    ]);

  // v1.1.0: the panel holds this call's answers only, and a reload starts a new call. What was saved
  // stays saved, for the session's review.
  await page.reload();
  await expect(page.locator('article[aria-current="true"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.kiteAnswerHarness.saved()))
    .toEqual([
      { mode: 'answer', rating: null, note: '' },
      { mode: 'chat', rating: 'down', note: 'Give the monthly total too.' },
    ]);
});

test('deleting the session removes its answers', async () => {
  await page.evaluate(() => window.kiteAnswerHarness.deleteSession());
  expect(await page.evaluate(() => window.kiteAnswerHarness.saved())).toEqual([]);
  // The panel holds what it loaded until the page reloads.
  await page.reload();
  await expect(page.getByRole('article', { name: 'Answer' })).toHaveCount(0);
});

test('the compact view shows the live answer; its Answer and Clear answers keys ask the live page (Day 5, ADR-0082)', async () => {
  // A second page in the same browser, like the desktop compact window.
  const compact = await page.context().newPage();
  await compact.goto(`${origin}/compact-harness`);
  const bar = compact.getByRole('toolbar', { name: 'Overlay controls' });
  await expect(bar).toBeVisible();
  // ADR-0085: the transcript panel is open on a device's first call (this fresh profile), in bar 2's place;
  // its switch closes it, and bar 2 with the latest words shows again.
  const transcriptSwitch = bar.getByRole('switch', { name: 'Transcript' });
  await expect(transcriptSwitch).toBeChecked();
  await transcriptSwitch.click();
  // Nothing has been answered since the reload: the live page says so.
  await expect(compact.getByLabel('Latest words')).toContainText(/forty/i);
  // ADR-0082: no Answer, Screenshot or Chat buttons on the overlay, and no message box; the shortcuts do
  // their work. Ctrl+Enter with the overlay focused asks the live page.
  for (const name of ['Answer', 'Screenshot', 'Chat']) {
    await expect(bar.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(compact.getByLabel('Type a question')).toHaveCount(0);
  await compact.locator('body').click({ position: { x: 2, y: 2 } });
  await compact.keyboard.press('Control+Enter');
  await expect(compact.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  // The live page answered it (the same answer shows there).
  await expect(page.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  // ADR-0082: Ctrl+Backspace clears the answers: the overlay shows none, and neither does the live page,
  // until the next answer.
  await compact.keyboard.press('Control+Backspace');
  await expect(compact.getByRole('heading', { name: 'Answer line' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Answer line' })).toHaveCount(0);
  // Answer preferences change from the overlay's menu; the next answer uses them.
  await compact.getByRole('button', { name: 'Overlay menu' }).click();
  await compact.getByRole('button', { name: 'Answer preferences', exact: true }).click();
  await expect(compact.getByRole('button', { name: 'Tone: Plain' })).toBeVisible();
  await compact.getByRole('button', { name: /^Tone:/ }).click();
  await compact.getByRole('option', { name: 'Technical' }).click();
  await compact.getByRole('button', { name: /^Format:/ }).click();
  await compact.getByRole('option', { name: 'Bullets only' }).click();
  await expect(compact.getByRole('button', { name: 'Tone: Technical' })).toBeVisible();
  await compact.getByRole('button', { name: 'Overlay menu' }).click();
  // New speech, then Answer from the overlay's keyboard: the answer comes back after the clear.
  await page.evaluate(() => window.kiteAnswerHarness.addThem('HOW LONG DOES THE ROLLOUT TAKE'));
  await compact.locator('body').click({ position: { x: 2, y: 2 } });
  await compact.keyboard.press('Control+Enter');
  await expect
    .poll(() => received.at(-1)?.session?.style)
    .toMatchObject({ tone: 'technical', format: 'bullets' });
  await expect(compact.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  await compact.close();
});

test('the browser overlay: picture-in-picture, or a clear message where unsupported (Day 5)', async () => {
  const supported = await page.evaluate(() => 'documentPictureInPicture' in window);
  await page.getByRole('button', { name: 'Back to compact' }).click();
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
    // ADR-0082: bar 1 has no Screenshot button any more; Exit is always there.
    .toContain('Exit');
  const headline = await page
    .locator('article[aria-current="true"]')
    .getByRole('heading', { name: 'Answer line' })
    .textContent();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as WithPip).documentPictureInPicture.window?.document.querySelector(
            '[aria-label="Answer line"]',
          )?.textContent ?? '',
      ),
    )
    .toBe(headline?.replace(/^Answer:\s*/, ''));
  console.log('[harness] compact view: picture-in-picture window opened and shows the live answer');
});

test('the chat switch goes in the request, a private answer has code with Copy, and it is remembered', async () => {
  await page.reload();
  await expect(page.getByRole('button', { name: 'Answer', exact: true }).first()).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Answer', exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Who the answer is for')).toHaveValue('kite');
  await page.getByLabel('Who the answer is for').selectOption('auto');
});

test('tags show, a figure in no document is flagged, and another type answers again', async () => {
  await page.getByLabel('Type a question').fill('rich: what did you save?');
  await page.getByLabel('Type a question').press('Enter');
  const card = page.locator('article[aria-current="true"]');
  await expect(card.getByRole('heading', { name: 'Answer line' })).toContainText('37 percent');
  const tags = card.getByLabel('About this answer');
  await expect(tags).toContainText('General knowledge');
  await expect(card.getByLabel('How to say it')).toContainText('keep it short');
  // The claim check, with no model call: underlined, with a private note.
  await expect(card.locator('[data-claim]').first()).toHaveText('37');
  await expect(card.getByLabel('Check before saying')).toContainText('37');
  // Copy leaves the note and the tags out.
  await card.getByRole('button', { name: 'Copy the answer' }).click();
  const copied = await page.evaluate(() => window.kiteAnswerHarness.copied);
  expect(copied.at(-1)).not.toContain('Check before');
  expect(copied.at(-1)).not.toContain('General knowledge');

  const before = received.length;
  await tags.getByRole('combobox').selectOption('design');
  await expect(
    page
      .locator('article[aria-current="true"]')
      .getByLabel('About this answer')
      .getByRole('combobox'),
  ).toHaveValue('design');
  expect(received.slice(before).find((body) => body.answerType)?.answerType).toBe('design');
});

test('a repeated question sends the earlier answer', async () => {
  const card = page.locator('article[aria-current="true"]');
  const ask = async (question: string) => {
    await page.getByLabel('Type a question').fill(question);
    await page.getByLabel('Type a question').press('Enter');
  };
  await ask('what does the seat cost');
  await expect(card.getByRole('heading', { name: 'Answer line' })).toContainText(
    'The seat price is 52 dollars.',
  );
  await expect(card.getByRole('list', { name: 'Answer details' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Answering…')).toHaveCount(0);
  const before = received.length;
  await ask('sorry what does the seat cost again');
  await expect(card.getByRole('list', { name: 'Answer details' })).toBeVisible({ timeout: 10_000 });
  const repeat = received.slice(before).find((body) => body.mode === 'chat')!;
  expect(repeat.similar?.question).toBe('what does the seat cost');
  expect(repeat.similar?.text).toContain('52 dollars');
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
  await expect(rerendering.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  await expect(
    rerendering.getByRole('list', { name: 'Answer details' }).getByRole('listitem'),
  ).toHaveText(BULLETS, { timeout: 10_000 });
  await expect(rerendering.getByText('Stopped.')).toHaveCount(0);
  await context.close();
});

test('ADR-0094: the overlay switches the model mid-call; the streaming answer finishes on the old one', async () => {
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.kiteAnswerHarness.sessionModel()))
    .toBe('fast');
  const compact = await page.context().newPage();
  await compact.goto(`${origin}/compact-harness`);
  const bar = compact.getByRole('toolbar', { name: 'Overlay controls' });
  const chip = bar.getByRole('button', { name: 'Model: Fast' });
  await expect(chip).toBeVisible();
  // Earlier tests saved answers for this session too: only the ones from here on are compared.
  const savedBefore = (await page.evaluate(() => window.kiteAnswerHarness.savedModels())).length;
  const savedSince = async () =>
    (await page.evaluate(() => window.kiteAnswerHarness.savedModels())).slice(savedBefore);

  // An answer starts on Fast; while it streams (its bullets come 1.5 s later), Smart is picked on the chip.
  await page.evaluate(() => window.kiteAnswerHarness.addThem('WHAT ABOUT THE ONBOARDING FEE'));
  await compact.locator('body').click({ position: { x: 2, y: 2 } });
  await compact.keyboard.press('Control+Enter');
  await expect(compact.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  expect(received.at(-1)).toMatchObject({ mode: 'answer', model: 'fast' });
  const warmsBefore = received.filter((body) => body.mode === 'warm').length;
  await chip.click();
  const popover = compact.getByRole('group', { name: 'Model' });
  await expect(popover.getByRole('radio', { name: 'Fast — quickest answers' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await popover.getByRole('radio', { name: 'Smart — more thorough, slower' }).click();
  await expect(popover).toHaveCount(0);
  await expect(compact.getByRole('status').filter({ hasText: 'Smart model on' })).toHaveText(
    'Smart model on — answers may take a bit longer',
  );
  await expect(bar.getByRole('button', { name: 'Model: Smart' })).toBeVisible();

  // The answer that was streaming finishes, on Fast, and is saved as Fast.
  await expect(page.getByRole('list', { name: 'Answer details' }).getByRole('listitem')).toHaveText(
    BULLETS,
    { timeout: 10_000 },
  );
  await expect.poll(savedSince).toEqual(['fast']);
  // The new model's cache is warmed in the background, and the switch is saved with the session.
  await expect
    .poll(() => received.filter((body) => body.mode === 'warm' && body.model === 'smart').length)
    .toBeGreaterThan(0);
  expect(received.filter((body) => body.mode === 'warm').length).toBeGreaterThan(warmsBefore);
  await expect
    .poll(() => page.evaluate(() => window.kiteAnswerHarness.sessionModel()))
    .toBe('smart');

  // The next answer uses Smart, and is saved as Smart.
  await page.evaluate(() => window.kiteAnswerHarness.addThem('AND HOW LONG IS THE CONTRACT'));
  await compact.locator('body').click({ position: { x: 2, y: 2 } });
  await compact.keyboard.press('Control+Enter');
  await expect.poll(() => received.at(-1)).toMatchObject({ mode: 'answer', model: 'smart' });
  await expect.poll(savedSince, { timeout: 10_000 }).toEqual(['fast', 'smart']);

  // Back to Fast from the ⋮ menu's Model row: the menu closes and the toast says so.
  await compact.getByRole('button', { name: 'Overlay menu' }).click();
  const menu = compact.getByRole('group', { name: 'Overlay settings' });
  const row = menu.getByRole('radiogroup', { name: 'Answer model' });
  await expect(row.getByRole('radio', { name: 'Smart — more thorough, slower' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await row.getByRole('radio', { name: 'Fast — quickest answers' }).click();
  await expect(menu).toHaveCount(0);
  await expect(compact.getByRole('status').filter({ hasText: 'Fast model on' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.kiteAnswerHarness.sessionModel()))
    .toBe('fast');

  // An admin turns Smart off: picking it changes nothing and says so; Smart then shows disabled, with its
  // tooltip drawn in the page.
  smartOff = true;
  const warmsOff = received.filter((body) => body.mode === 'warm').length;
  await bar.getByRole('button', { name: 'Model: Fast' }).click();
  await popover.getByRole('radio', { name: 'Smart — more thorough, slower' }).click();
  await expect(
    compact.getByRole('status').filter({ hasText: 'Smart model is turned off by your admin' }),
  ).toBeVisible();
  await bar.getByRole('button', { name: 'Model: Fast' }).click();
  const smart = popover.getByRole('radio', { name: 'Smart — more thorough, slower' });
  await expect(smart).toHaveAttribute('aria-disabled', 'true');
  await smart.hover();
  await expect(compact.getByRole('tooltip')).toHaveText('Turned off by your admin');
  // Playwright waits for an aria-disabled control to be enabled; forced, the click lands and does nothing.
  await smart.click({ force: true });
  await expect(popover).toBeVisible();
  expect(await page.evaluate(() => window.kiteAnswerHarness.sessionModel())).toBe('fast');
  expect(received.filter((body) => body.mode === 'warm').length).toBe(warmsOff);
  smartOff = false;
  await compact.close();
});
