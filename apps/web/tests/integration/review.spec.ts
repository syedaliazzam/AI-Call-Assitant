/**
 * Harness test for the session review page (day-05-overlay-screenshots-notes.md Stage 6), no
 * sign-in, runs in CI. With the real SessionReview on invented sessions seeded into the
 * browser's IndexedDB and a mocked /api/notes (no Claude call), it covers: the page shows the
 * call details, the notes (summary, questions, next steps, unclear part, proposed lesson as a
 * suggestion), every answer with its rating and note, and the transcript; lessons (Stage 7):
 * Edit and Approve for all calls, Reject, only decisions stored; Regenerate replaces the notes
 * and, when it proposes the same lessons reworded, the decisions carry over (no duplicates); a usage-limit reply shows the clear message and keeps the old notes; a session
 * with "Save transcript" off says so, and its notes, written from the answers only (no lines
 * sent), are labelled "Written from answers only"; Delete asks in an in-app dialog, removes
 * everything stored for the session, and goes to the dashboard. Settings' "What Kite has
 * learned" lists the approved lesson as sent, edits it, and clears all lessons after a dialog.
 * Parity Phase 3: a side menu of sections; the transcript as a chat with answers inline, thumbs and
 * reports; TXT and PDF downloads; Ask AI with a mocked /api/ask; Clear transcript.
 * Set KITE_SCREENSHOT_DIR to save screenshots of the page (for stage reports; never in CI).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { CLAUDE_UNAVAILABLE_MESSAGES, type AskRequest, type NotesRequest } from '@kite/shared';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { pickOption } from '../lib/pick-option';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where to save screenshots, or '' for none. */
const SHOT_DIR = process.env.KITE_SCREENSHOT_DIR ?? '';

/** How the mocked /api/notes answers: new notes, or the usage-limit error. */
let notesMode: 'ok' | 'limit' = 'ok';

/** Every body the mocked /api/notes received, in order. */
const received: NotesRequest[] = [];

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
 * Serves the page, the bundle, a stand-in dashboard and the mocked /api/notes.
 *
 * @param bundleDir Folder with review.js.
 * @returns The server and its origin.
 */
async function serve(bundleDir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'POST' && req.url === '/api/notes') {
        received.push(JSON.parse(await bodyOf(req)) as NotesRequest);
        if (notesMode === 'limit') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: 'claude_unavailable',
              message: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit,
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            notes: {
              summary: ['Regenerated: 40 seats on Professional, proposal by Monday.'],
              questions: [],
              nextSteps: [{ step: 'Send the proposal by Monday', owner: 'You' }],
              unclear: [],
              // The same two lessons, reworded: decisions must carry over, not duplicate.
              lessons: [
                {
                  text: 'Give the monthly and yearly totals for the seat count they mention',
                  evidence: 'The 40-seat answer was rated down.',
                },
                {
                  text: 'Mention the onboarding fee with every price',
                  evidence: 'Invented.',
                },
              ],
            },
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            ms: 5,
          }),
        );
        return;
      }
      if (req.url === '/harness/review.js' || req.url === '/harness/review.css') {
        const css = req.url.endsWith('.css');
        res.writeHead(200, { 'Content-Type': css ? 'text/css' : 'text/javascript' });
        res.end(readFileSync(path.join(bundleDir, css ? 'review.css' : 'review.js')));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Paramount AI review harness</title>' +
          '<link rel="stylesheet" href="/harness/review.css"></head>' +
          '<body class="bg-slate-50"><div id="root"></div>' +
          '<script type="module" src="/harness/review.js"></script></body></html>',
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, origin: `http://127.0.0.1:${port}` };
}

/**
 * Saves a full-page screenshot when KITE_SCREENSHOT_DIR is set.
 *
 * @param name File name without extension.
 */
async function shot(name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

/**
 * Opens one section of the session window.
 *
 * @param name The section's name in the side menu.
 */
async function openSection(name: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Session sections' })
    .getByRole('button', { name, exact: true })
    .click();
}

/**
 * Compiles the app's real stylesheet (app/globals.css, Tailwind) into review.css, so the page
 * looks as it does in the app. Uses the postcss that @tailwindcss/postcss itself depends on
 * (no extra dependency).
 *
 * @param outDir Where to write review.css.
 */
async function buildCss(outDir: string): Promise<void> {
  const fromTailwind = createRequire(
    createRequire(import.meta.url).resolve('@tailwindcss/postcss'),
  );
  const postcss = fromTailwind('postcss') as PostcssRunner;
  const from = path.join(WEB_DIR, 'app', 'globals.css');
  const result = await postcss([tailwind({ base: WEB_DIR })]).process(readFileSync(from, 'utf8'), {
    from,
  });
  writeFileSync(path.join(outDir, 'review.css'), result.css);
}

/** The part of postcss used here (it is not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let page: Page;
let origin = '';
/** The 'full' fixture session. */
let fullId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-review-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'review.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    // Resolves the `@/*` alias the same way the app does.
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    // No Next.js router here: links are plain anchors.
    alias: {
      'next/link': path.join(WEB_DIR, 'tests', 'integration', 'harness', 'next-link-stub.tsx'),
    },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  await buildCss(bundleDir);
  ({ server, origin } = await serve(bundleDir));
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  await page.goto(origin);
  await page.waitForFunction(() => 'kiteReviewHarness' in window);
  fullId = await page.evaluate(() => window.kiteReviewHarness.seed('full'));
  await page.evaluate((id) => window.kiteReviewHarness.show(id), fullId);
  await expect(page.getByRole('heading', { name: 'Northwind Logistics (invented)' })).toBeVisible();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test('shows the call details, notes, answers and transcript', async () => {
  // The notes come first.
  await expect(page.getByRole('region', { name: 'AI notes' })).toBeVisible();
  await openSection('Call details');
  const details = page.getByRole('region', { name: 'Call details' });
  await expect(details).toContainText('Regular');
  await expect(details).toContainText('price-list.txt');
  await openSection('AI notes');
  const notes = page.getByRole('region', { name: 'AI notes' });
  await expect(notes.getByRole('list', { name: 'Summary' }).getByRole('listitem')).toHaveCount(2);
  await expect(notes.getByRole('list', { name: 'Questions asked' })).toContainText(
    '0:24 What would 40 seats cost? (Partly answered, 👎 Not helpful)',
  );
  await expect(notes.getByRole('list', { name: 'Next steps' })).toContainText(
    'Send the proposal by Monday (You)',
  );
  await expect(notes.getByRole('list', { name: 'Unclear parts' })).toContainText(
    '1:00–1:24 Garbled audio',
  );
  await expect(notes.getByRole('list', { name: 'Proposed lessons' })).toContainText(
    'Give monthly and yearly totals',
  );
  await expect(notes).toContainText('Suggestions only');
  await expect(notes).not.toContainText('Written from answers only');

  await openSection('Transcript');
  // Conversation (v1.1.0): the talk, with a chip for each answer that opens it in place.
  const answers = page.getByRole('listitem', { name: 'Saved answer' });
  const chips = page.getByRole('button', { name: 'Paramount AI answered' });
  await expect(chips).toHaveCount(2);
  await expect(answers).toHaveCount(0);
  await chips.first().click();
  await expect(chips.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(answers).toHaveCount(1);
  await chips.first().click();
  await expect(answers).toHaveCount(0);

  const transcript = page.getByRole('listitem', { name: /said$/ });
  await expect(transcript).toHaveCount(6);
  // Oldest first by default, the speaker before the words; the toggle turns it round.
  await expect(transcript.first()).toContainText(/^You/);
  await expect(transcript.nth(1)).toContainText(/^Them/);
  const oldestFirst = await transcript.allTextContents();
  await page.getByRole('checkbox', { name: 'Oldest first' }).uncheck();
  expect(await transcript.allTextContents()).toEqual([...oldestFirst].reverse());
  await page.getByRole('checkbox', { name: 'Oldest first' }).check();
  expect(await transcript.allTextContents()).toEqual(oldestFirst);

  // Answers: every answer as a card.
  await page.getByRole('button', { name: 'Answers', exact: true }).click();
  await expect(answers).toHaveCount(2);
  await expect(answers.first()).toContainText('What would forty seats on Professional cost?');
  await expect(answers.first().getByLabel('Rating')).toHaveText('👎 Not helpful');
  await expect(answers.first().getByLabel('Your note')).toContainText('monthly and yearly totals');
  await expect(answers.nth(1)).toContainText('Typed question');
  await expect(answers.nth(1).getByLabel('Rating')).toHaveText('👍 Helpful');
  await shot('review-transcript');
  await openSection('AI notes');
  await shot('review-full');
});

test('lessons: Edit and Approve for all calls, Reject; only decisions are stored', async () => {
  expect(await page.evaluate(() => window.kiteReviewHarness.lessons())).toEqual([]);
  const proposals = page.getByRole('listitem', { name: 'Proposed lesson' });
  await expect(proposals).toHaveCount(2);
  await proposals.first().getByRole('button', { name: 'Edit' }).click();
  // Typed newlines and long spaces are cleaned: what is shown is what is sent.
  await proposals
    .first()
    .getByLabel('Lesson', { exact: true })
    .fill('Give the monthly   and yearly totals.');
  await expect(proposals.first()).toContainText(
    '/200 characters. Paramount AI sends exactly this text',
  );
  await pickOption(page, proposals.first().getByLabel('Applies to'), 'All calls');
  await shot('review-lesson-edit');
  await proposals.first().getByRole('button', { name: 'Approve' }).click();
  await expect(proposals.first().getByLabel('Decision')).toHaveText('Approved · All calls');
  await expect(proposals.first()).toContainText('Give the monthly and yearly totals.');
  await proposals.nth(1).getByRole('button', { name: 'Reject' }).click();
  await expect(proposals.nth(1).getByLabel('Decision')).toHaveText('Rejected');
  expect(await page.evaluate(() => window.kiteReviewHarness.lessons())).toEqual([
    { text: 'Give the monthly and yearly totals.', scope: 'all', status: 'approved' },
    { text: 'Mention the onboarding fee with every price.', scope: 'regular', status: 'rejected' },
  ]);
  await shot('review-lessons-decided');
});

test('a usage-limit reply shows the clear message and keeps the old notes', async () => {
  notesMode = 'limit';
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    "The call notes could not be written: the team's Claude usage limit has been reached.",
  );
  await expect(page.getByRole('list', { name: 'Summary' }).getByRole('listitem')).toHaveCount(2);
  await shot('review-usage-limit');
});

test('Regenerate replaces the notes from the saved call', async () => {
  notesMode = 'ok';
  received.length = 0;
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('The new notes are saved.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Summary' })).toHaveText(
    'Regenerated: 40 seats on Professional, proposal by Monday.',
  );
  expect(received).toHaveLength(1);
  // The saved lines and answers, in seconds since the call started.
  expect(received[0]!.lines.map((line) => line.at)).toEqual([5, 12, 24, 40, 95, 103]);
  expect(received[0]!.answers.map((answer) => answer.rating)).toEqual(['down', 'up']);
  // The regenerated notes propose the same lessons in other words: the decisions carry over.
  const proposals = page.getByRole('listitem', { name: 'Proposed lesson' });
  await expect(proposals.first().getByLabel('Decision')).toHaveText('Approved · All calls');
  await expect(proposals.nth(1).getByLabel('Decision')).toHaveText('Rejected');
  expect(await page.evaluate(() => window.kiteReviewHarness.lessons())).toHaveLength(2);
});

test('with "Save transcript" off: says so, and notes are written from answers only', async () => {
  const offId = await page.evaluate(() => window.kiteReviewHarness.seed('transcript-off'));
  await page.evaluate((id) => window.kiteReviewHarness.show(id), offId);
  await expect(page.getByRole('heading', { name: 'Pinecrest Clinics (invented)' })).toBeVisible();
  await openSection('Transcript');
  await expect(page.getByRole('region', { name: 'Transcript' })).toContainText(
    'Transcript not saved. "Save transcript" was off for this session, so only the answers and the notes were kept.',
  );
  await openSection('AI notes');
  received.length = 0;
  await page.getByRole('button', { name: 'Write the notes' }).click();
  await expect(page.getByText('Written from answers only')).toBeVisible();
  expect(received[0]!.lines).toEqual([]);
  expect(received[0]!.answers).toHaveLength(2);
  await shot('review-transcript-off');
  // Back to the full session for the delete test.
  await page.evaluate((id) => window.kiteReviewHarness.show(id), fullId);
  await expect(page.getByRole('heading', { name: 'Northwind Logistics (invented)' })).toBeVisible();
});

test('Transcript: a chat with answer chips, an Answers tab; thumbs and reports are stored here', async () => {
  await page.evaluate((id) => window.kiteReviewHarness.show(id), fullId);
  await openSection('Transcript');
  const conversation = page.getByRole('list', { name: 'Conversation' });
  // Each answer's chip sits where it was asked: lines before it, and after it.
  const order = await conversation
    .locator('> li')
    .evaluateAll((items) =>
      items.map((item) => item.textContent?.includes('Paramount AI answered')),
    );
  expect(order.indexOf(true)).toBeGreaterThan(0);
  expect(order.filter(Boolean)).toHaveLength(2);
  expect(order.at(-1)).toBe(false);
  // Them on the left, You on the right.
  const you = await page.getByRole('listitem', { name: 'You said' }).first().boundingBox();
  const them = await page.getByRole('listitem', { name: 'Them said' }).first().boundingBox();
  const area = (await conversation.boundingBox())!;
  expect(Math.round(them!.x)).toBe(Math.round(area.x));
  expect(Math.round(you!.x + you!.width)).toBe(Math.round(area.x + area.width));

  // The oldest answer, which has no rating of its own to begin with.
  await page.getByRole('button', { name: 'Answers', exact: true }).click();
  const card = page.getByRole('listitem', { name: 'Saved answer' }).first();
  await card.getByRole('button', { name: 'Bad answer' }).click();
  await card.getByRole('button', { name: 'Bad answer' }).click();
  await card.getByRole('button', { name: 'Good answer' }).click();
  await expect(card.getByLabel('Rating')).toHaveText('👍 Helpful');
  await card.getByRole('button', { name: 'Good answer' }).click();
  await expect(card.getByLabel('Rating')).toHaveCount(0);
  await card.getByRole('button', { name: 'Bad answer' }).click();
  await expect(card.getByLabel('Rating')).toHaveText('👎 Not helpful');

  await card.getByRole('button', { name: 'Report this answer' }).click();
  await card.getByLabel('What was wrong?').fill('The total is wrong (invented).');
  await card.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Reported' })).toBeVisible();
  await expect(card.getByLabel('Your note')).toContainText('The total is wrong');
  await shot('review-conversation');
});

test('Download gives TXT and PDF with the conversation, not the private notes', async () => {
  await page.evaluate((id) => window.kiteReviewHarness.show(id), fullId);
  await openSection('Transcript');
  const [txt] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download TXT' }).click(),
  ]);
  expect(txt.suggestedFilename()).toMatch(/^paramount-ai-transcript-.*\.txt$/);
  const text = readFileSync(await txt.path(), 'utf8');
  expect(text).toContain('Paramount AI transcript: Northwind Logistics (invented)');
  expect(text).toContain('Them: ');
  expect(text).toContain('Paramount AI answer');
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/^paramount-ai-transcript-.*\.pdf$/);
  const bytes = readFileSync(await pdf.path());
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  expect(bytes.toString('latin1')).toContain('Paramount AI transcript');
});

test('Ask AI: sends the call and the chat, shows replies, and keeps a failed question', async () => {
  await page.evaluate((id) => window.kiteReviewHarness.show(id), fullId);
  await openSection('Ask AI');
  const bodies: AskRequest[] = [];
  let fail = false;
  await page.route('**/api/ask', async (route) => {
    bodies.push(route.request().postDataJSON() as AskRequest);
    if (fail) {
      await route.fulfill({ status: 502, json: { code: 'upstream_error', message: 'detail' } });
    } else {
      await route.fulfill({ json: { text: `Reply ${bodies.length}: they asked about seats.` } });
    }
  });
  const box = page.getByLabel('Ask about this call');
  await box.fill('What did they ask?');
  await box.press('Enter');
  await expect(page.getByRole('list', { name: 'Chat' })).toContainText('Reply 1');
  expect(bodies[0]!.question).toBe('What did they ask?');
  expect(bodies[0]!.history).toEqual([]);
  expect(bodies[0]!.lines.length).toBeGreaterThan(0);
  expect(bodies[0]!.notes).toContain('Summary:');
  await shot('review-ask');

  await box.fill('And then?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Chat' })).toContainText('Reply 2');
  expect(bodies[1]!.history.map((turn) => turn.role)).toEqual(['you', 'kite']);

  fail = true;
  await box.fill('One more?');
  await box.press('Enter');
  await expect(page.getByRole('region', { name: 'Ask AI' }).getByRole('alert')).toContainText(
    'could not answer',
  );
  await expect(box).toHaveValue('One more?');
  await page.unroute('**/api/ask');
});

test('Clear transcript asks first, and keeps the answers and notes', async () => {
  const id = await page.evaluate(() => window.kiteReviewHarness.seed('full'));
  await page.evaluate((target) => window.kiteReviewHarness.show(target), id);
  await openSection('Transcript');
  await expect(page.getByRole('listitem', { name: /said$/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear transcript' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear this transcript?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('listitem', { name: /said$/ })).toHaveCount(6);
  await page.getByRole('button', { name: 'Clear transcript' }).click();
  await dialog.getByRole('button', { name: 'Clear transcript' }).click();
  await expect(page.getByRole('listitem', { name: /said$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Paramount AI answered' })).toHaveCount(2);
  await openSection('AI notes');
  await expect(page.getByRole('list', { name: 'Summary' })).toBeVisible();
  await page.evaluate((target) => window.kiteReviewHarness.remove(target), id);
  await page.evaluate((target) => window.kiteReviewHarness.show(target), fullId);
});

test('Settings lists the approved lesson as sent; edit, then clear all in a dialog', async () => {
  await page.evaluate(() => window.kiteReviewHarness.showLearned());
  const learned = page.getByRole('listitem', { name: 'Learned lesson' });
  await expect(learned).toHaveCount(1);
  await expect(learned).toContainText('Give the monthly and yearly totals.');
  await expect(learned).toContainText('All calls');
  await expect(page.getByText('1 rejected proposal is remembered')).toBeVisible();
  await shot('settings-learned');
  await learned.getByRole('button', { name: 'Edit' }).click();
  await learned.getByLabel('Lesson', { exact: true }).fill('Give monthly and yearly totals.');
  await pickOption(page, learned.getByLabel('Applies to'), 'Regular calls only');
  await learned.getByRole('button', { name: 'Save' }).click();
  await expect(learned).toContainText('Regular calls only');
  await page.getByRole('button', { name: 'Clear all lessons' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear all lessons?' });
  await dialog.getByRole('button', { name: 'Clear all lessons' }).click();
  await expect(page.getByText('No lessons yet.')).toBeVisible();
  expect(await page.evaluate(() => window.kiteReviewHarness.lessons())).toEqual([]);
  // Back to the review for the delete test.
  await page.evaluate((id) => window.kiteReviewHarness.show(id), fullId);
  await expect(page.getByRole('heading', { name: 'Northwind Logistics (invented)' })).toBeVisible();
});

test('Delete asks in a dialog, removes everything and returns to the dashboard', async () => {
  // An in-app dialog, not window.confirm (a native dialog would fail this test).
  page.on('dialog', () => {
    throw new Error('A native browser dialog was opened');
  });
  await page.getByRole('button', { name: 'Delete session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this session?' });
  await expect(dialog).toBeVisible();
  await shot('review-delete-dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect((await page.evaluate((id) => window.kiteReviewHarness.count(id), fullId)).sessions).toBe(
    1,
  );

  await page.getByRole('button', { name: 'Delete session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard stand-in' })).toBeVisible();
  // A fresh load, so the counts below come from what IndexedDB really kept.
  await page.goto(origin);
  await page.waitForFunction(() => 'kiteReviewHarness' in window);
  expect(await page.evaluate((id) => window.kiteReviewHarness.count(id), fullId)).toEqual({
    sessions: 0,
    lines: 0,
    answers: 0,
    notes: 0,
    documents: 0,
  });
});

test('Export my data, wipe, Import data restores it; importing again adds nothing (Day 6)', async () => {
  const id = await page.evaluate(() => window.kiteReviewHarness.seed('full'));
  const before = await page.evaluate((sessionId) => window.kiteReviewHarness.count(sessionId), id);
  await page.evaluate(() => window.kiteReviewHarness.showData());

  // A warning first; the file is saved only after "Save file".
  await page.getByRole('button', { name: 'Export my data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export my data' });
  await expect(dialog).toContainText(
    'This file contains your session documents and transcripts — keep it private.',
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Save file' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^paramount-ai-export-\d{4}-\d{2}-\d{2}\.json$/);
  const file = (await download.path())!;
  const exported = JSON.parse(readFileSync(file, 'utf8')) as {
    format: string;
    version: number;
    documents: { text?: string }[];
  };
  expect(exported.format).toBe('kite-export');
  expect(exported.version).toBe(5);
  // Documents with their text, so a restore is complete.
  expect(exported.documents.length).toBeGreaterThan(0);
  expect(exported.documents.every((document) => typeof document.text === 'string')).toBe(true);
  await expect(page.getByRole('status')).toContainText('Exported');

  await page.evaluate(() => window.kiteReviewHarness.wipe());
  await page.evaluate(() => window.kiteReviewHarness.showData());
  await page.getByLabel('Paramount AI export file to import').setInputFiles(file);
  await expect(page.getByRole('status')).toContainText('Added');
  await expect(page.getByRole('status')).not.toContainText('attach the files again');
  const after = await page.evaluate((sessionId) => window.kiteReviewHarness.count(sessionId), id);
  // Everything, documents included, is back.
  expect(after).toEqual(before);

  await page.getByLabel('Paramount AI export file to import').setInputFiles(file);
  await expect(page.getByRole('status')).toContainText('Added 0 sessions');
  await expect(page.getByRole('status')).toContainText('already on this computer');

  // Not a Kite export: a clear message, nothing changed.
  await page.getByLabel('Paramount AI export file to import').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":1}'),
  });
  await expect(page.getByRole('alert')).toHaveText('This file is not a Paramount AI export.');
});
