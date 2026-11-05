/**
 * Simulated calls (v1.1.0, item 27), run end to end with the real answer panel, transcript and overlay,
 * lines from the test and a mocked /api/answer; no sign-in, no spending:
 * a) an interview: a greeting, "say yes when ready", a garbled line, three real questions and a
 *    follow-up;
 * b) a coding round with a problem on screen;
 * c) a slide, a table, a code error and a screen that cannot be read;
 * d) a 40-minute call with silence gaps (hygiene prompts), echo and background speech.
 * Checks that the right questions are answered, with no duplicates; that panels, hotkeys and arrows
 * behave; and that the transcript is readable. Also the home panel and a keyboard pass (item 26).
 * All text is invented.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { ANSWER_TYPE_LABELS, type AnswerRequest, type AnswerType } from '@kite/shared';
import { build } from 'esbuild';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every real answer the mocked /api/answer received, in order (warm-ups left out). */
const received: AnswerRequest[] = [];

/** What the mocked server replies to the next screenshot. */
let nextScreen: AnswerType = 'coding';

/** A coding answer in the item 7 shape, with code that runs. */
const CODING_REPLY = [
  'Count the vowels with one pass over the lower-cased text.',
  'Key steps:',
  '- Lower-case the text.',
  '- Count the characters in a set of vowels.',
  '```python',
  'def count_vowels(text):',
  '    return sum(c in "aeiou" for c in text.lower())',
  '',
  'print(count_vowels("Harbor"))',
  '```',
  'Complexity: O(n) time, O(1) space.',
  'Say: I walk the string once and count what is in the vowel set.',
].join('\n');

/** What each kind of screen is answered with. */
const SCREEN_REPLIES: Partial<Record<AnswerType, string>> = {
  coding: CODING_REPLY,
  codefix: [
    'An empty list makes the length zero, so it divides by zero.',
    '- Return zero when the list is empty.',
    '```python',
    'def average(values):',
    '    return sum(values) / len(values) if values else 0',
    '```',
    'Say: It fails on an empty list, so I check for that first.',
  ].join('\n'),
  slide: 'Renewal is on 1 December.\n- 128 seats\n- 6,656 dollars a month\nTip: Confirm the date.',
  table: 'Tickets fell every week.\n- 420 in week 1\n- 95 in week 4',
  unreadable: 'The screen is too blurred to read; share it again larger.',
};

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
 * Serves the pages, the bundles and the mocked /api/answer.
 *
 * @param bundleDir Folder with the bundles.
 * @returns The server and its origin.
 */
async function serve(bundleDir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'POST' && req.url === '/api/answer') {
        const request = JSON.parse(await bodyOf(req)) as AnswerRequest;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const event = (name: string, data: unknown) =>
          res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        if (request.mode !== 'warm') {
          received.push(request);
          if (request.mode === 'screenshot') {
            event('meta', { meta: { type: nextScreen, target: 'call', source: 'general' } });
            event('delta', { text: SCREEN_REPLIES[nextScreen] ?? '' });
          } else if (/SLOWLY/.test(request.question ?? '')) {
            // Time to see the card before the first word.
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            event('meta', { meta: { type: 'behavioural', target: 'call', source: 'docs' } });
            event('delta', { text: 'A slow answer arrives.\n- A short point.' });
          } else if (/GRONK|TUESDAY POTATO/.test(request.question ?? '')) {
            // Words the rules let through, or a second press on noise: Claude says it is noise.
            event('meta', { meta: { type: 'garbled', target: 'call', source: 'general' } });
          } else {
            event('meta', { meta: { type: 'behavioural', target: 'call', source: 'docs' } });
            event('delta', {
              text: `Answer ${received.length} comes first.\n- A short point.\n- Another point.`,
            });
          }
        }
        event('done', {
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 900,
          },
          ms: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 3, toFirstText: 4, total: 5 },
        });
        res.end();
        return;
      }
      if (req.url === '/harness/simcall.js' || req.url === '/harness/compact.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(readFileSync(path.join(bundleDir, path.basename(req.url))));
        return;
      }
      if (req.url === '/harness/simcall.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(readFileSync(path.join(bundleDir, 'simcall.css')));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const script = req.url?.startsWith('/compact') ? 'compact' : 'simcall';
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Paramount AI simulated call</title></head>' +
          `<body><div id="root"></div><script type="module" src="/harness/${script}.js"></script></body></html>`,
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
let origin = '';
let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-sim-test-'));
  await build({
    entryPoints: [
      path.join(WEB_DIR, 'tests', 'integration', 'harness', 'simcall.tsx'),
      path.join(WEB_DIR, 'tests', 'integration', 'harness', 'compact.tsx'),
    ],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
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
    logLevel: 'error',
  });
  ({ server, origin } = await serve(bundleDir));
  browser = await chromium.launch();
});

test.beforeEach(async () => {
  received.length = 0;
  context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
});

test.afterEach(async () => {
  await context.close();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

/**
 * Opens the call, and a clock for its lines: each one a few seconds after the last, ending now.
 *
 * @param view The view ('call' or 'desktop').
 * @returns say(), which adds a line; press(), which waits for the answer panel to be free.
 */
async function openCall(view: 'call' | 'desktop' = 'call') {
  await page.goto(`${origin}/?view=${view}`);
  await expect(page.getByRole('button', { name: 'Answer', exact: true }).first()).toBeVisible();
  await page.locator('body').click();
  let ago = 110;
  return {
    say: async (speaker: 'you' | 'them', text: string) => {
      ago -= 6;
      await page.evaluate(
        ([who, words, seconds]) =>
          window.kiteSim.say(who as 'you' | 'them', words as string, seconds as number),
        [speaker, text, ago] as const,
      );
    },
  };
}

/**
 * The questions asked so far, as the mocked server got them.
 *
 * @returns The questions.
 */
const questions = () => received.map((request) => request.question ?? '');

/**
 * The answers on screen.
 *
 * @returns Their cards.
 */
const cards = () => page.getByRole('region', { name: 'Answers', exact: true }).locator('article');

test('a) interview: only real questions are answered, once each', async () => {
  const { say } = await openCall();
  // A greeting and an instruction: nothing to answer, and no request spent.
  await say('them', 'HI THANKS FOR JOINING TODAY');
  await say('you', 'THANKS FOR HAVING ME TODAY');
  await say('them', 'SAY YES WHEN READY');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('No question to answer yet', { exact: false })).toBeVisible();
  expect(received).toHaveLength(0);
  await expect(cards()).toHaveCount(0);

  // A garbled line: says so, and spends nothing; a second press asks, and Claude says it is noise.
  await say('you', 'YES I AM READY NOW');
  await say('them', 'GRONK BLIMP SPROCKET WIBBLE FLANGE');
  await page.keyboard.press('Control+Enter');
  const garbled = page.getByText("Didn't catch the question clearly", { exact: false });
  await expect(garbled).toBeVisible();
  expect(received).toHaveLength(0);
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => received.length).toBe(1);
  await expect(garbled).toBeVisible();
  await expect(cards()).toHaveCount(0);
  received.length = 0;

  // Words the rules cannot tell from a question: Claude's garbled type is the second net.
  await say('them', 'WHAT THE TUESDAY POTATO OF THE RIVER SINGS UNDER');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => received.length).toBe(1);
  await expect(garbled).toBeVisible();
  await expect(cards()).toHaveCount(0);
  received.length = 0;

  // Three real questions and a follow-up.
  const Q1 = 'TELL ME ABOUT A TIME YOU LED A MIGRATION';
  const Q2 = 'HOW DID YOU TEST THE NEW EXPORT';
  const Q3 = 'WHY DID YOU CHOOSE GO FOR IT';
  const FOLLOW_UP = 'AND HOW LONG DID THAT TAKE';
  await say('them', Q1);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Answer line' }).first()).toContainText(
    'Answer 1',
  );
  await say('you', 'YES SO LAST YEAR WE MOVED THE BILLING EXPORT');

  // "Give me a second" after it: Answer goes back to that question, and shows what is there.
  await say('them', 'GIVE ME A SECOND');
  await page.keyboard.press('Control+Enter');
  await expect(cards()).toHaveCount(1);
  expect(received).toHaveLength(1);

  for (const [index, question] of [Q2, Q3, FOLLOW_UP].entries()) {
    await say('them', question);
    await page.keyboard.press('Control+Enter');
    await expect(cards()).toHaveCount(index + 2);
    await expect.poll(() => received.length).toBe(index + 2);
    // Newest at the top of the list (the card under the answer is the one before).
    await expect(page.getByRole('heading', { name: 'Answer line' }).first()).toContainText(
      `Answer ${index + 2}`,
    );
  }
  expect(questions()).toEqual([Q1, Q2, Q3, FOLLOW_UP]);

  // The same question again within a minute is one entry, showing the newest answer.
  await say('them', 'AND HOW LONG DID THAT TAKE YOU');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => received.length).toBe(5);
  await expect(cards()).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Answer line' }).first()).toContainText(
    'Answer 5',
  );

  // The arrows move between this call's questions.
  const selected = page.locator('article[aria-current="true"]');
  await expect(selected).toContainText('Answer 5');
  await page.keyboard.press('Control+ArrowLeft');
  await expect(selected).toContainText('Answer 3');
  await page.keyboard.press('Control+ArrowRight');
  await expect(selected).toContainText('Answer 5');

  // The transcript reads well: oldest first, named, questions marked, the noise out of the way.
  const transcript = page
    .getByRole('log', { name: 'Live transcript' })
    .or(page.getByLabel('Live transcript'));
  const bubbles = transcript.getByRole('listitem', { name: /said$/ });
  await expect(bubbles.first()).toContainText('Dana');
  await expect(bubbles.first()).toContainText('Hi thanks for joining today');
  await expect(transcript.getByRole('button', { name: /^Unclear speech/ })).toHaveText(
    'Unclear speech (1)',
  );
  await expect(transcript.getByRole('img', { name: 'Question' }).first()).toBeVisible();
  await expect(transcript.getByRole('button', { name: 'Answer this' }).first()).toBeVisible();

  // Pressing it on the greeting answers the greeting, because it was asked for.
  received.length = 0;
  await bubbles.first().hover();
  await bubbles.first().getByRole('button', { name: 'Answer this' }).click();
  await expect.poll(() => received.length).toBe(1);
  expect(questions()[0]).toMatch(/hi thanks for joining/i);

  // Clear transcript keeps the answers.
  const before = await cards().count();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Shift+Backspace');
  await expect(bubbles).toHaveCount(0);
  await expect(cards()).toHaveCount(before);

  // Chat moved to Ctrl+Shift+Space.
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByLabel('Type a question')).toBeFocused();
});

test('b) coding round: a problem on screen gets the coding shape, about the question just asked', async () => {
  const { say } = await openCall('desktop');
  nextScreen = 'coding';
  const asked = 'OKAY HERE IS THE PROBLEM CAN YOU SOLVE THIS ONE';
  await say('them', asked);
  await page.keyboard.press('Control+Shift+Enter');
  await expect(cards()).toHaveCount(1);
  expect(received[0]!.mode).toBe('screenshot');
  expect(received[0]!.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(received[0]!.question).toBe(asked);

  const card = cards().first();
  await expect(card.getByRole('heading', { name: 'Answer line' })).toContainText(
    'one pass over the lower-cased text',
  );
  await expect(card.getByText('Key steps', { exact: true })).toBeVisible();
  await expect(
    card.getByRole('list', { name: 'Answer details' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(card.locator('pre')).toContainText('def count_vowels');
  await expect(card.getByRole('button', { name: 'Copy code' })).toBeVisible();
  await expect(card.getByLabel('Complexity')).toContainText('O(n) time');
  await expect(card.getByLabel('How to say it')).toContainText('vowel set');
  // In the order of item 7.
  const order = await card.evaluate((element) => {
    const text = element.textContent ?? '';
    return ['Key steps', 'def count_vowels', 'Complexity:', 'I walk the string'].map((part) =>
      text.indexOf(part),
    );
  });
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('c) screens: each kind in its own shape, never merged', async () => {
  const { say } = await openCall('desktop');
  await say('them', 'WHAT DO YOU MAKE OF WHAT IS ON THE SCREEN');
  const KINDS: { type: AnswerType; words: string }[] = [
    { type: 'slide', words: 'Renewal is on 1 December' },
    { type: 'table', words: 'Tickets fell every week' },
    { type: 'codefix', words: 'divides by zero' },
    { type: 'unreadable', words: 'too blurred to read' },
  ];
  for (const [index, { type, words }] of KINDS.entries()) {
    nextScreen = type;
    await page.keyboard.press('Control+Shift+Enter');
    await expect(cards()).toHaveCount(index + 1);
    const card = cards().first();
    await expect(card.getByRole('heading', { name: 'Answer line' })).toContainText(words);
    await expect(card.getByLabel('About this answer')).toContainText(ANSWER_TYPE_LABELS[type]);
  }
  expect(received.map((request) => request.mode)).toEqual(new Array(4).fill('screenshot'));
  // The code error's corrected code is there; the unreadable screen is one line with nothing guessed.
  await expect(cards().first().getByRole('list', { name: 'Answer details' })).toHaveCount(0);
  await page.keyboard.press('Control+ArrowLeft');
  await expect(cards().nth(1).locator('pre')).toContainText('if values else 0');
  await expect(page.locator('article[aria-current="true"]')).toContainText('divides by zero');
});

test('d) a 40-minute call: hygiene prompts, echo, background speech', async () => {
  test.setTimeout(180_000);
  await context.clock.install();
  await page.goto(`${origin}/?view=call`);
  await expect(page.getByRole('button', { name: 'Answer', exact: true }).first()).toBeVisible();
  const overlay = await context.newPage();
  await overlay.goto(`${origin}/compact-harness`);
  const strip = overlay.getByRole('region', { name: 'Live transcript bar' });
  await expect(strip).toBeVisible();

  /**
   * Adds a line.
   *
   * @param speaker    Who spoke.
   * @param text       What they said.
   * @param secondsAgo When it ended.
   * @returns When the page has it.
   */
  const say = (speaker: 'you' | 'them', text: string, secondsAgo = 0) =>
    page.evaluate(
      ([who, words, seconds]) =>
        window.kiteSim.say(who as 'you' | 'them', words as string, seconds as number),
      [speaker, text, secondsAgo] as const,
    );

  await say('them', 'LET US START WITH THE PILOT RESULTS', 30);

  // Ten quiet minutes: asks.
  await context.clock.fastForward('10:30');
  await expect(strip.getByRole('alert')).toContainText('Still in a call?');
  await strip.getByRole('button', { name: 'Yes' }).click();
  await expect(strip.getByRole('alert')).toHaveCount(0);

  // The other person speaks again; the speakers echo it three times; one real reply stays.
  const ECHOES = [
    'THE NIGHT SHIFT LIKED THE NEW ROUTES A LOT',
    'WE SAW FEWER LATE DELIVERIES IN THE NORTH',
    'THE DRIVERS ASKED FOR THE SAME PLAN AGAIN',
  ];
  for (const [index, line] of ECHOES.entries()) {
    const ago = 60 - index * 15;
    await say('them', line, ago);
    await say('you', line, ago - 1);
  }
  await say('you', 'THAT IS GOOD TO HEAR FROM THEM', 5);
  const transcript = page.getByLabel('Live transcript');
  await expect(transcript.getByRole('listitem', { name: 'You said' })).toHaveCount(1);
  // One hint, once.
  await expect(overlay.getByText('Your speakers are echoing. Use headphones.')).toBeVisible();
  await overlay.getByRole('button', { name: 'OK' }).click();
  await expect(overlay.getByText('Your speakers are echoing. Use headphones.')).toHaveCount(0);

  // Background speech collapses, and it is not "someone on the call" for the transcript's sake.
  await say('them', 'GRONK BLIMP SPROCKET WIBBLE FLANGE', 4);
  await say('you', 'HMM BRR TSK PFFT SHH MM', 2);
  await expect(transcript.getByRole('button', { name: /^Unclear speech/ })).toHaveText(
    'Unclear speech (2)',
  );

  // The overlay's transcript panel shows the same, under its own bar.
  await overlay.getByRole('button', { name: 'Open the transcript', exact: true }).click();
  const panel = overlay.getByRole('region', { name: 'Transcript panel' });
  await expect(panel.getByLabel('Live transcript')).toContainText('Dana');
  await expect(panel.getByRole('button', { name: /^Unclear speech/ })).toBeVisible();

  // Thirty quiet minutes: pauses, once, with Resume. Until then the call is not lost.
  await context.clock.fastForward('31:00');
  await expect.poll(() => page.evaluate(() => window.kiteSim.pauses())).toBe(1);
  await overlay.getByRole('button', { name: 'Close the transcript' }).click();
  await expect(strip.getByRole('alert')).toContainText('Listening is paused');
  await strip.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => page.evaluate(() => window.kiteSim.resumes())).toBe(1);
  await expect(strip.getByRole('alert')).toHaveCount(0);

  // After all that, a question still gets its answer, in both views.
  received.length = 0;
  await say('them', 'WHAT WOULD THE NEXT STEP BE FOR THE PILOT');
  await overlay.getByRole('button', { name: 'Answer', exact: false }).first().click();
  await expect.poll(() => received.length).toBe(1);
  await expect(overlay.getByRole('heading', { name: 'Answer line' })).toContainText('Answer 1');
  await expect(page.getByRole('heading', { name: 'Answer line' })).toContainText('Answer 1');
  // The timer has run the whole call.
  await expect(overlay.getByRole('timer', { name: 'Call time' })).toContainText(/^4\d:\d\d$/);
});

test('the overlay: panels open with an answer, the arrows move, Clear keeps the answer', async () => {
  const { say } = await openCall();
  const overlay = await context.newPage();
  await overlay.goto(`${origin}/compact-harness`);
  const answerPanel = overlay.getByRole('region', { name: 'Latest answer' });
  // Closed until an answer starts.
  await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  await expect(answerPanel).toHaveCount(0);

  await say('them', 'HOW DID YOU TEST THE NEW EXPORT');
  await overlay.getByRole('button', { name: 'Answer', exact: false }).first().click();
  await expect(answerPanel).toBeVisible();
  await expect(answerPanel.getByRole('heading', { name: 'Answer line' })).toContainText('Answer 1');
  await say('them', 'WHY DID YOU CHOOSE GO FOR IT');
  await overlay.getByRole('button', { name: 'Answer', exact: false }).first().click();
  await expect(answerPanel.getByRole('heading', { name: 'Answer line' })).toContainText('Answer 2');

  await answerPanel.getByRole('button', { name: 'Previous question' }).click();
  await expect(answerPanel.getByRole('heading', { name: 'Answer line' })).toContainText('Answer 1');
  await answerPanel.getByRole('button', { name: 'Next question' }).click();
  await expect(answerPanel.getByRole('heading', { name: 'Answer line' })).toContainText('Answer 2');
  // Bar 1 keeps every control on screen while End asks to confirm, at the narrowest width too.
  for (const width of [680, 560]) {
    await overlay.setViewportSize({ width, height: 452 });
    await overlay.getByRole('button', { name: 'End call' }).click();
    const cancel = await overlay.getByRole('button', { name: 'Cancel' }).boundingBox();
    expect(cancel!.x + cancel!.width).toBeLessThanOrEqual(width);
    await overlay.getByRole('button', { name: 'Cancel' }).click();
  }
  await overlay.setViewportSize({ width: 680, height: 660 });

  // The question shows at once, with Thinking… and Stop, before the first word.
  await say('them', 'WHAT WOULD YOU DO SLOWLY AT THE START');
  await overlay.getByRole('button', { name: 'Answer', exact: false }).first().click();
  await expect(answerPanel.getByText('Thinking…')).toBeVisible();
  await expect(answerPanel.getByLabel('Question', { exact: true })).toContainText(
    'What would you do slowly at the start',
  );
  await expect(answerPanel.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(answerPanel.getByRole('heading', { name: 'Answer line' })).toContainText(
    'A slow answer arrives',
  );
  await expect(answerPanel.getByRole('button', { name: 'Stop' })).toHaveCount(0);

  // Clear never empties the card.
  await answerPanel.getByRole('button', { name: 'Clear' }).click();
  await expect(answerPanel.getByRole('heading', { name: 'Answer line' })).toBeVisible();

  // Both panels at once: transcript above answer in a narrow window (side by side in a wide one).
  await overlay.setViewportSize({ width: 780, height: 700 });
  await overlay.getByRole('button', { name: 'Open the transcript', exact: true }).click();
  const transcriptPanel = overlay.getByRole('region', { name: 'Transcript panel' });
  await expect(transcriptPanel).toBeVisible();
  await expect(answerPanel).toBeVisible();
  const [top, bottom] = await Promise.all([
    transcriptPanel.boundingBox(),
    answerPanel.boundingBox(),
  ]);
  expect(top!.y).toBeLessThan(bottom!.y);

  // Remembered next time the overlay opens.
  await overlay.reload();
  await expect(overlay.getByRole('region', { name: 'Transcript panel' })).toBeVisible();
  await expect(overlay.getByRole('region', { name: 'Latest answer' })).toBeVisible();
});

test('home panel: cards, search, sort, the menu and its buttons', async () => {
  await page.goto(`${origin}/?view=home`);
  // The acceptable-use notice, word for word, once on this device.
  const notice = page.getByRole('dialog', { name: 'Using Paramount AI' });
  await expect(notice).toContainText(
    "Use Paramount AI in calls where AI assistance is allowed — your own meetings, client calls, practice and mock interviews. Don't use it to get hidden help in interviews, exams or assessments where outside help isn't permitted. Screen-share protection only hides Paramount AI's windows; it does nothing against monitoring or proctoring tools. Recording or transcribing others may require their consent.",
  );
  await notice.getByRole('button', { name: 'Got it' }).click();
  await expect(notice).toHaveCount(0);
  const list = page.getByRole('list', { name: 'Sessions' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  // Newest first, each with its type, Transcript chip, status and Start.
  await expect(list.getByRole('listitem').first()).toContainText('Northwind Routes');
  await expect(list.getByRole('listitem').first()).toContainText('Regular');
  await expect(list.getByRole('listitem').first()).toContainText('Transcript');
  await expect(
    list.getByRole('listitem').first().getByRole('button', { name: 'Start' }),
  ).toBeVisible();

  await page.getByLabel('Search sessions').fill('harbor');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Search sessions').fill('nothing like this');
  await expect(page.getByText('Nothing matches that')).toBeVisible();
  await page.getByLabel('Search sessions').fill('');

  await page.getByRole('button', { name: 'Sorted newest first' }).click();
  await expect(list.getByRole('listitem').first()).toContainText('Harbor Lane');

  // The buttons open pages through the shell.
  const opened = () =>
    page.evaluate(() => (window as unknown as { opened: string[] }).opened.slice());
  await page.getByRole('button', { name: 'View in dashboard' }).click();
  await page.getByRole('button', { name: 'Create session' }).click();
  expect(await opened()).toEqual(['/', '/sessions/new']);

  // The menu: the email, Dashboard, Private, Zoom, Theme, Log out. Escape closes it.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Home panel menu' });
  for (const words of ['sam@example.com', 'Dashboard', 'Private', 'Zoom', 'Log out']) {
    await expect(menu).toContainText(words);
  }
  // The theme reaches the page at once, and stays.
  await menu.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('.k-dark').first()).toBeVisible();
  await menu.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('.k-light').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('the chat bar: Ctrl+Alt+Enter sends with a screenshot; pressing Chat twice dictates (spec S14)', async () => {
  await openCall('desktop');
  const overlay = await context.newPage();
  await overlay.goto(`${origin}/compact-harness`);
  await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  const input = overlay.getByLabel('Type a question');
  const sent = received.length;

  // Ctrl+Alt+Enter with words sends them about a screenshot, and the bar closes.
  await overlay.getByRole('button', { name: 'Chat', exact: false }).first().click();
  await input.fill('WHAT IS ON MY SCREEN');
  await input.press('Control+Alt+Enter');
  await expect(input).toHaveCount(0);
  await expect.poll(() => received.length).toBe(sent + 1);
  expect(received.at(-1)!.question).toBe('WHAT IS ON MY SCREEN');
  expect(received.at(-1)!.mode).toBe('screenshot');
  expect(received.at(-1)!.image).toMatch(/^data:image\/jpeg;base64,/);

  // Chat pressed once opens it, without the microphone.
  await overlay.locator('body').click();
  await overlay.keyboard.press('Control+Shift+Space');
  await expect(input).toBeFocused();
  await expect(overlay.getByRole('button', { name: 'Speak a question' })).toBeVisible();
  await overlay.keyboard.press('Escape');
  await expect(input).toHaveCount(0);

  // Pressed twice: open, with the microphone on. Escape cancels and nothing is sent.
  await overlay.waitForTimeout(600);
  const before = received.length;
  await overlay.keyboard.press('Control+Shift+Space');
  // As a person presses twice: faster than this is a held key repeating.
  await overlay.waitForTimeout(120);
  await overlay.keyboard.press('Control+Shift+Space');
  await expect(overlay.getByRole('button', { name: 'Stop listening' })).toBeVisible();
  await overlay.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await page.evaluate(() => window.kiteSim.dictate('THIS MUST NOT BE SENT'));
  await overlay.waitForTimeout(1_700);
  expect(received.length).toBe(before);

  // Pressed twice again: what is said goes by itself after 1.5 s of silence.
  await overlay.keyboard.press('Control+Shift+Space');
  // As a person presses twice: faster than this is a held key repeating.
  await overlay.waitForTimeout(120);
  await overlay.keyboard.press('Control+Shift+Space');
  await expect(overlay.getByRole('button', { name: 'Stop listening' })).toBeVisible();
  await page.evaluate(() => window.kiteSim.dictate('WHAT IS THE NOTICE PERIOD'));
  await overlay.waitForTimeout(1_200);
  expect(received.length, 'not before the 1.5 s').toBe(before);
  await expect.poll(() => received.length, { timeout: 2_000 }).toBe(before + 1);
  expect(received.at(-1)!.question).toBe('WHAT IS THE NOTICE PERIOD');
  await expect(overlay.getByRole('button', { name: 'Speak a question' })).toBeVisible();
});

test('keyboard pass: every control of the overlay and the panel can be reached and used', async () => {
  const { say } = await openCall();
  const overlay = await context.newPage();
  await overlay.goto(`${origin}/compact-harness`);
  await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  await say('them', 'HOW DID YOU TEST THE NEW EXPORT');
  await overlay.getByRole('button', { name: 'Answer', exact: false }).first().click();
  await expect(overlay.getByRole('region', { name: 'Latest answer' })).toBeVisible();

  /**
   * Tabs through a page until focus comes back round.
   *
   * @param target The page.
   * @returns What each stop is called, and whether it showed a focus ring.
   */
  const tabStops = async (target: Page) => {
    await target.locator('body').click({ position: { x: 2, y: 2 } });
    const stops: { name: string; ring: boolean }[] = [];
    for (let i = 0; i < 40; i += 1) {
      await target.keyboard.press('Tab');
      const stop = await target.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        const style = getComputedStyle(element);
        return {
          name:
            element.getAttribute('aria-label') ??
            element.textContent?.trim().slice(0, 30) ??
            element.tagName,
          ring: style.boxShadow !== 'none' || style.outlineStyle !== 'none',
        };
      });
      if (!stop) continue;
      if (stops.some((seen) => seen.name === stop.name)) break;
      stops.push(stop);
    }
    return stops;
  };
  const stops = await tabStops(overlay);
  const names = stops.map((stop) => stop.name);
  for (const expected of [
    'Answer',
    'Screenshot',
    'Chat',
    'Overlay menu',
    'Exit: end call',
    'Open the transcript',
    'Copy the answer',
    'Good answer',
  ]) {
    expect(names.join(' | '), expected).toContain(expected);
  }
  for (const stop of stops) expect(stop.ring, `${stop.name} shows where focus is`).toBe(true);

  // A key can open the menu, and Escape closes it.
  await overlay.getByRole('button', { name: 'Overlay menu' }).focus();
  await overlay.keyboard.press('Enter');
  await expect(overlay.getByRole('group', { name: 'Overlay settings' })).toBeVisible();
  await overlay.keyboard.press('Escape');
  await expect(overlay.getByRole('group', { name: 'Overlay settings' })).toHaveCount(0);

  // Exit asks first, with the safe choice one key away.
  await overlay.getByRole('button', { name: 'End call' }).focus();
  await overlay.keyboard.press('Enter');
  await expect(overlay.getByRole('button', { name: 'End call?' })).toBeFocused();
  await overlay.keyboard.press('Tab');
  await expect(overlay.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await overlay.keyboard.press('Enter');
  await expect(overlay.getByRole('button', { name: 'End call' })).toBeVisible();
});
