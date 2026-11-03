/**
 * File: apps/desktop/tests/visual/call-window-shots.ts
 * Purpose: v1.0.4 on-screen checks: runs a simulated call in the REAL desktop shell (dev build)
 *          against the overlay rig (apps/web/tests/visual/overlay-rig.ts), with a real browser window
 *          behind it, and checks each item of ADR-0040 by driving the real windows: the overlay's
 *          live question, ⛶ to the full call window and back (button, Esc, ⋮, taskbar), the
 *          transcript and answer cards, one entry per question, the latest answer after Clear, and
 *          solid backgrounds everywhere but the overlay. Saves real screen captures (capture.ps1) of
 *          each state, to be looked at, and prints PASS or FAIL for each check.
 *          Usage: start the rig, then `pnpm --filter @kite/desktop build` and
 *                 `pnpm --filter web exec tsx ../desktop/tests/visual/call-window-shots.ts <out dir>`
 * Used by: the developer before a release (not part of the automated suites: it needs a screen)
 * Depends on: @playwright/test (_electron), PowerShell (capture.ps1)
 * Architecture: docs/decisions/ADR-0040-full-call-window-and-one-entry-per-question.md
 *
 * All text is invented. It captures only Kite's own windows and the Wikipedia page behind them: this
 * runs on someone's real screen, so a capture is refused unless a pinned window is verified to cover
 * everything else (a first version without that check caught the developer's own browser).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { BrowserWindow } from 'electron';

/** apps/desktop. */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the captures go. */
const OUT = path.resolve(process.argv[2] ?? path.join(APP_DIR, 'test-results', 'call-window'));

/** The rig. */
const RIG = 'http://localhost:3123';

/** The page behind the overlay: a real site with plenty of text and images. */
const BACKDROP = 'https://en.wikipedia.org/wiki/Kite';

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many checks failed. */
let failures = 0;

/** The running app, closed even when the run stops on an error. */
let shell: ElectronApplication | null = null;

/**
 * Records one check.
 *
 * @param name   What was checked.
 * @param ok     Whether it held.
 * @param detail What was seen, when it did not.
 */
function check(name: string, ok: boolean, detail = ''): void {
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures += 1;
}

/**
 * Polls until a condition holds.
 *
 * @param condition What to wait for.
 * @param ms        How long to wait.
 * @returns True if it held in time.
 */
async function until(condition: () => Promise<boolean>, ms = 8_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await condition()) return true;
    await wait(100);
  }
  return false;
}

/** The state of the shell's windows. */
interface WindowsState {
  /** The overlay is showing. */
  overlayVisible: boolean;
  /** The main window is minimised. */
  mainMinimized: boolean;
  /** The main window is focused. */
  mainFocused: boolean;
}

/**
 * Reads the shell's windows.
 *
 * @param app The app.
 * @returns Their state.
 */
function windows(app: ElectronApplication): Promise<WindowsState> {
  return app.evaluate(() => {
    const overlay = (globalThis as unknown as { rig: RigShell }).rig.find('overlay');
    const main = (globalThis as unknown as { rig: RigShell }).rig.find('call');
    return {
      overlayVisible: overlay?.isVisible() ?? false,
      mainMinimized: main?.isMinimized() ?? false,
      mainFocused: main?.isFocused() ?? false,
    };
  });
}

/**
 * The opacity of an element's painted background.
 *
 * @param page     The page.
 * @param selector The element.
 * @returns 0 to 1.
 */
function backgroundAlpha(page: Page, selector: string): Promise<number> {
  return page.evaluate((target) => {
    const color = getComputedStyle(document.querySelector(target)!).backgroundColor;
    const parts = color.match(/[\d.]+/g)!.map(Number);
    return parts.length > 3 ? parts[3]! : 1;
  }, selector);
}

/** The rig page's controls (window.rig in rig-live.tsx). */
interface RigPage {
  /** The controls. */
  rig: {
    /**
     * Feeds a line as the speech engine would.
     *
     * @param speaker 'them' or 'you'.
     * @param text    The words.
     * @param final   False for words still being heard.
     */
    say: (speaker: string, text: string, final?: boolean) => void;
  };
}

/** What the run keeps in the shell's main process. */
interface RigShell {
  /** Finds a window by what it shows: a page's own title replaces the window's. */
  find: (kind: 'overlay' | 'call' | 'backdrop') => BrowserWindow | undefined;
  /** Holds the window behind, so it is never garbage-collected during the run. */
  backdrop?: BrowserWindow;
}

/** Starts the checks. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // Set when this runs from an editor built on Electron: it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    // Its own profile: an installed Kite that is running keeps its single-instance lock.
    args: [APP_DIR, `--kite-url=${RIG}`, `--user-data-dir=${path.join(OUT, 'profile')}`],
    cwd: APP_DIR,
    env: env as Record<string, string>,
  });
  shell = app;
  // tsx names functions with a helper that does not exist in the shell's main process.
  await app.evaluate('globalThis.__name = (fn) => fn');
  // Never fail silently: a page error fails the run.
  const pageErrors: string[] = [];
  app.on('window', (page) => page.on('pageerror', (error) => pageErrors.push(error.name)));

  let found: Page | undefined;
  for (let i = 0; i < 60 && !found; i += 1) {
    found = app.windows().find((page) => page.url().includes('/compact/'));
    if (!found) await wait(500);
  }
  if (!found) throw new Error('The overlay did not open');
  const overlay = found;
  const call = app.windows().find((page) => !page.url().includes('/compact/'))!;
  await call.evaluate('window.__name = (fn) => fn');
  // A missing element fails its check soon, instead of holding the run for the default 30 s.
  overlay.setDefaultTimeout(5_000);
  call.setDefaultTimeout(5_000);
  await overlay.waitForSelector('[aria-label="Overlay controls"]');
  await app.evaluate(({ BrowserWindow }) => {
    (globalThis as unknown as { rig: RigShell }).rig = {
      find: (kind) =>
        BrowserWindow.getAllWindows().find((win) => {
          const url = win.webContents.getURL();
          if (kind === 'overlay') return url.includes('/compact/');
          if (kind === 'backdrop') return url.includes('wikipedia');
          return (
            url.startsWith('http://localhost') && !url.includes('/compact/') && !win.isAlwaysOnTop()
          );
        }),
    };
    (globalThis as unknown as { rig: RigShell }).rig.find('overlay')?.setSize(640, 480);
  });

  // The real window behind: a browser window on a real page, so nothing else on this computer ends
  // up in the captures. Pinned above ordinary windows but below the overlay.
  await app.evaluate(async ({ BrowserWindow, screen }, url) => {
    const backdrop = new BrowserWindow({
      ...screen.getPrimaryDisplay().bounds,
      frame: false,
      show: true,
    });
    (globalThis as unknown as { rig: RigShell }).rig.backdrop = backdrop;
    backdrop.setAlwaysOnTop(true, 'normal');
    await backdrop.loadURL(url);
    (globalThis as unknown as { rig: RigShell }).rig.find('overlay')?.moveTop();
  }, BACKDROP);
  await wait(2_500);

  /**
   * Prints when the overlay is collapsed, which nothing in this run asks for.
   *
   * @param step Where the run is.
   */
  const reportCollapsed = async (step: string) => {
    const collapsed = await overlay
      .getByRole('button', { name: 'Open the overlay' })
      .count()
      .catch(() => 0);
    const menu = await overlay
      .locator('[data-menu="overlay"]')
      .count()
      .catch(() => 0);
    if (collapsed > 0 || menu > 0)
      console.info(`note  at ${step}: collapsed=${collapsed} menu=${menu}`);
  };

  /**
   * Captures a window's rectangle from the real screen.
   *
   * @param name  The file name (without .png).
   * @param which 'overlay' with a margin, or the main 'call' window.
   */
  const shot = async (name: string, which: 'overlay' | 'call' = 'overlay') => {
    if (which === 'overlay') {
      await overlay.mouse.move(30, 200);
      // Both are always on top, and the window behind can come above it when it repaints.
      await app.evaluate(() => {
        (globalThis as unknown as { rig: RigShell }).rig.find('overlay')?.moveTop();
      });
      await reportCollapsed(name);
    }
    await wait(700);
    const { bounds, scale, covered } = await app.evaluate(({ screen }, kind) => {
      const win = (globalThis as unknown as { rig: RigShell }).rig.find(kind);
      // The privacy guard: the window behind is alive, pinned and covers the whole screen.
      const cover = (globalThis as unknown as { rig: RigShell }).rig.backdrop;
      const display = screen.getPrimaryDisplay().bounds;
      const area = cover && !cover.isDestroyed() ? cover.getBounds() : null;
      return {
        bounds: win!.getBounds(),
        scale: screen.getPrimaryDisplay().scaleFactor,
        covered:
          area !== null &&
          cover!.isVisible() &&
          cover!.isAlwaysOnTop() &&
          cover!.webContents.getURL().includes('wikipedia') &&
          area.x <= display.x &&
          area.y <= display.y &&
          area.width >= display.width &&
          area.height >= display.height,
      };
    }, which);
    if (!covered)
      throw new Error(`Not capturing ${name}: the window behind is not covering the screen`);
    const margin = which === 'overlay' ? 40 : 0;
    const file = path.join(OUT, `${name}.png`);
    execFileSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(APP_DIR, 'tests', 'visual', 'capture.ps1'),
      '-X',
      String(Math.max(0, Math.round((bounds.x - margin) * scale))),
      '-Y',
      String(Math.max(0, Math.round((bounds.y - margin) * scale))),
      '-W',
      String(Math.round((bounds.width + margin * 2) * scale)),
      '-H',
      String(Math.round((bounds.height + margin * 2) * scale)),
      '-Out',
      file,
    ]);
    console.info(`shot  ${name}`);
  };

  /**
   * Feeds a line to the simulated call.
   *
   * @param speaker 'them' or 'you'.
   * @param text    The words, in the engine's capitals.
   * @param final   False for words still being heard.
   */
  const say = async (speaker: 'them' | 'you', text: string, final = true) => {
    await call.evaluate(
      ([who, words, done]) =>
        (window as unknown as RigPage).rig.say(who as string, words as string, done as boolean),
      [speaker, text, final] as const,
    );
    await wait(150);
  };

  /**
   * Captures the call window from the real screen, in front of the pinned window behind. Its URL
   * finds it while it is not pinned, so it is found first and held by the shot.
   *
   * @param name The file name (without .png).
   */
  const callShot = async (name: string) => {
    await app.evaluate(() => {
      const win = (globalThis as unknown as { rig: RigShell }).rig.find('call');
      win?.setAlwaysOnTop(true, 'floating');
      win?.moveTop();
    });
    // The lookup skips a pinned window, so the bounds come from here for this one capture.
    await wait(700);
    const { bounds, scale, covered } = await app.evaluate(({ BrowserWindow, screen }) => {
      const cover = (globalThis as unknown as { rig: RigShell }).rig.backdrop;
      const win = BrowserWindow.getAllWindows().find(
        (w) =>
          w !== cover &&
          w.isAlwaysOnTop() &&
          w.webContents.getURL().startsWith('http://localhost') &&
          !w.webContents.getURL().includes('/compact/'),
      );
      return {
        bounds: win!.getBounds(),
        scale: screen.getPrimaryDisplay().scaleFactor,
        covered: !!cover && !cover.isDestroyed() && cover.isVisible() && cover.isAlwaysOnTop(),
      };
    });
    if (!covered)
      throw new Error(`Not capturing ${name}: the window behind is not covering the screen`);
    const file = path.join(OUT, `${name}.png`);
    execFileSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(APP_DIR, 'tests', 'visual', 'capture.ps1'),
      '-X',
      String(Math.max(0, Math.round(bounds.x * scale))),
      '-Y',
      String(Math.max(0, Math.round(bounds.y * scale))),
      '-W',
      String(Math.round(bounds.width * scale)),
      '-H',
      String(Math.round(bounds.height * scale)),
      '-Out',
      file,
    ]);
    console.info(`shot  ${name}`);
    await app.evaluate(({ BrowserWindow }) => {
      const cover = (globalThis as unknown as { rig: RigShell }).rig.backdrop;
      BrowserWindow.getAllWindows()
        .find(
          (w) =>
            w !== cover &&
            w.isAlwaysOnTop() &&
            w.webContents.getURL().startsWith('http://localhost') &&
            !w.webContents.getURL().includes('/compact/'),
        )
        ?.setAlwaysOnTop(false);
    });
  };

  const liveLine = overlay.getByLabel('Current question from the other person');
  const cardQuestion = overlay.getByLabel('Question', { exact: true });
  const answerLine = overlay.getByLabel('Answer line');
  const pressAnswer = async () => {
    await overlay.getByRole('button', { name: /^Answer/ }).click();
    // It starts, then finishes: the clean question arrives last, after the answer's words.
    await until(async () => (await overlay.getByText('Answering…').count()) > 0, 3_000);
    await until(async () => (await overlay.getByText('Answering…').count()) === 0, 15_000);
    await wait(400);
  };
  const place = (text: string) => overlay.getByText(text).count();

  // ---- Item 5 and 4 at the start: saved answers, one of them repeated; never an empty state ----
  await wait(800);
  check(
    'item 5: with saved answers the card opens on the latest, not "Press Answer"',
    (await place('Press Answer when they ask something.')) === 0 &&
      (await answerLine.count()) === 1,
  );
  check(
    'item 4: an old answer shows sentence-cased raw words, cut at the question mark',
    (await cardQuestion.textContent())?.includes('Tell me about yourself?') === true &&
      (await cardQuestion.textContent())?.includes('NEXT PART') === false &&
      (await cardQuestion.textContent())?.includes('next part') === false,
    (await cardQuestion.textContent()) ?? '',
  );
  check(
    'item 1: no "Other answers, newest first" list',
    (await place('Other answers, newest first')) === 0,
  );

  // ---- Item 3: the live question, updating as it is heard ----
  await say('them', 'THANKS FOR JOINING TODAY');
  check('item 3: no live question line before one is asked', (await liveLine.count()) === 0);
  await say('you', 'THANKS FOR HAVING ME');
  await say('them', 'SO UM HOW WOULD YOU DESIGN A VOICE', false);
  check(
    'item 3: the live question appears while still being heard',
    (await liveLine.textContent()) === 'Them: How would you design a voice…',
    (await liveLine.textContent()) ?? '',
  );
  await shot('01-overlay-live-question-as-it-is-heard');
  await say('them', 'SO UM HOW WOULD YOU DESIGN A VOICE AGENT FOR A HOSPITAL');
  check(
    'item 3: it updates to the finished question',
    (await liveLine.textContent()) === 'Them: How would you design a voice agent for a hospital?',
    (await liveLine.textContent()) ?? '',
  );

  // ---- An answer: the card shows the clean question ----
  await pressAnswer();
  check(
    'item 3: the card shows the clean question of the answer',
    (await cardQuestion.textContent())?.includes(
      'How would you design a voice agent for a hospital?',
    ) === true,
    (await cardQuestion.textContent()) ?? '',
  );
  await shot('02-overlay-during-call');

  // A new question while the last answer is on the card: the live line moves on, the card does not.
  await say('you', 'I WOULD START WITH LATENCY');
  await say('them', 'THAT IS REALLY GREAT WHAT PRODUCTION GRADE APPLICATIONS HAVE YOU BUILT');
  check(
    'item 3: the live line shows the new question from the middle of a line',
    (await liveLine.textContent()) === 'Them: What production grade applications have you built?',
    (await liveLine.textContent()) ?? '',
  );
  check(
    'item 3: the card still shows the question of the answer being viewed',
    (await cardQuestion.textContent())?.includes('voice agent') === true,
  );
  check(
    'item 3: chips stay for the last spoken words',
    (await overlay.getByLabel(/^Latest words/).textContent())?.includes('built') === true,
  );
  await shot('03-overlay-new-question-while-viewing-answer');
  await pressAnswer();

  // ---- Item 4: asking again, in near-identical words, adds no entry ----
  const counter = async () => overlay.getByText(/^\d+ of \d+$/).textContent();
  const before = await counter();
  await say('you', 'SORRY COULD YOU SAY THAT AGAIN');
  await say('them', 'WHAT PRODUCTION GRADE APPLICATIONS HAVE YOU REALLY BUILT');
  await pressAnswer();
  check(
    'item 4: a near-identical question adds no entry',
    (await counter()) === before,
    `${before} → ${await counter()}`,
  );
  check(
    'item 4: the three saved and new answers are three questions',
    before === '3 of 3',
    before ?? '',
  );

  // ---- Item 5: Clear ----
  await overlay.getByRole('button', { name: 'Previous answer' }).click();
  await until(async () => (await counter()) === '2 of 3');
  check('history: Previous moves back', (await counter()) === '2 of 3');
  await overlay.getByRole('button', { name: /^Clear/ }).click();
  await until(async () => (await counter()) === '3 of 3');
  check(
    'item 5: Clear goes back to the latest answer, never "Press Answer"',
    (await counter()) === '3 of 3' &&
      (await place('Press Answer when they ask something.')) === 0 &&
      (await answerLine.count()) === 1,
  );
  check('item 5: Clear also clears the live question', (await liveLine.count()) === 0);
  await shot('04-overlay-after-clear');

  // ---- Item 6: the overlay alone is see-through ----
  const overlayAlpha = await backgroundAlpha(overlay, '.k-overlay');
  check('item 6: the overlay is see-through', overlayAlpha < 1, String(overlayAlpha));

  // ---- Item 1: ⛶ opens the full call window ----
  await overlay.getByRole('button', { name: 'Previous answer' }).click();
  await until(async () => (await counter()) === '2 of 3');
  await say('them', 'AND HOW DO YOU KEEP IT', false);
  await overlay.getByRole('button', { name: 'Open call window' }).click();
  await until(async () => (await windows(app)).overlayVisible === false);
  await wait(500);
  let state = await windows(app);
  check(
    'item 1: ⛶ brings the full call window forward and hides the overlay',
    !state.overlayVisible && !state.mainMinimized,
    JSON.stringify(state),
  );

  const cards = call.getByRole('article', { name: 'Answer' });
  const expanded = call.locator('article[aria-current="true"]');
  check(
    'item 2: every question has a card (3)',
    (await cards.count()) === 3,
    String(await cards.count()),
  );
  check(
    'item 5: on expand the selection is the latest answer',
    (await expanded.textContent())?.includes('production-grade') === true,
    (await expanded.textContent())?.slice(0, 60) ?? '',
  );
  check(
    'item 2: the newest card is on top and expanded',
    (await cards.first().getAttribute('aria-current')) === 'true',
  );
  check(
    'item 2: older cards are collapsed to the question and the answer line',
    (await cards.nth(1).getByRole('button', { expanded: false }).count()) === 1 &&
      (await cards.nth(1).textContent())?.includes('Streaming speech recognition') === false,
  );
  check(
    'item 2: the top bar has mic, Answer, Screenshot, Chat, timer, ⋮ and End',
    (await call.getByRole('toolbar', { name: 'Call controls' }).count()) === 1 &&
      (await call
        .getByRole('toolbar')
        .getByRole('button', { name: /^Answer/ })
        .count()) === 1 &&
      (await call
        .getByRole('toolbar')
        .getByRole('button', { name: /^Screenshot/ })
        .count()) === 1 &&
      (await call.getByRole('toolbar').getByRole('button', { name: /^Chat/ }).count()) === 1 &&
      (await call.getByRole('toolbar').getByRole('timer').count()) === 1 &&
      (await call.getByRole('toolbar').getByRole('button', { name: 'More' }).count()) === 1 &&
      (await call
        .getByRole('toolbar')
        .getByRole('button', { name: 'End', exact: true })
        .count()) === 1,
  );
  const bigButtons = await call
    .getByRole('button', { name: /^(Answer|Screenshot) .*Ctrl/ })
    .evaluateAll((found) => found.map((button) => button.textContent));
  check(
    'item 2: message box with mic, and big Answer and Screenshot buttons with key hints',
    (await call.getByLabel('Type a question').count()) === 1 &&
      (await call
        .getByRole('form', { name: 'Message' })
        .getByRole('button', { name: 'Speak a question' })
        .count()) === 1 &&
      bigButtons.length === 2,
    JSON.stringify(bigButtons),
  );
  const layout = await call.evaluate(() => {
    const rect = (selector: string) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? [Math.round(box.top), Math.round(box.bottom)] : null;
    };
    return {
      inner: window.innerHeight,
      doc: document.documentElement.scrollHeight,
      root: rect('.k-dark.\\@container'),
      answers: rect('section[aria-label="Answers"]'),
      form: rect('form[aria-label="Message"]'),
      main: rect('main'),
    };
  });
  console.info(`layout ${JSON.stringify(layout)}`);
  check(
    'item 2: the window itself does not scroll; the message box is in view',
    layout.doc <= layout.inner + 1 && (layout.form?.[1] ?? 9e9) <= layout.inner,
    JSON.stringify(layout),
  );
  const them = call.getByRole('listitem', { name: 'Them said' });
  check(
    'item 2: the transcript has grouped bubbles, newest first, a "?" and "Answer this"',
    (await them.first().textContent())?.includes('And how do you keep it') === true &&
      (await call.getByRole('img', { name: 'Question' }).count()) >= 1,
    (await them.first().textContent()) ?? '',
  );
  check(
    'item 2: words still being heard are grey',
    (await them.first().locator('.italic').count()) === 1,
  );
  check(
    'item 6: the call window is solid',
    (await backgroundAlpha(call, 'main .k-dark')) === 1 &&
      (await call.locator('.k-glass').count()) === 0,
    String(await backgroundAlpha(call, 'main .k-dark')),
  );
  check(
    'item 6: only the overlay window is transparent',
    (await app.evaluate(() =>
      (globalThis as unknown as { rig: RigShell }).rig
        .find('call')
        ?.getBackgroundColor()
        .toLowerCase(),
    )) !== '#00000000',
  );
  await callShot('05-full-call-window');

  // Click to expand an older card; hover keeps the raw words.
  await cards.nth(1).getByRole('button').click();
  await wait(300);
  check(
    'item 2: clicking a collapsed card expands it, and collapses the one before',
    (await cards.nth(1).getAttribute('aria-current')) === 'true' &&
      (await cards.first().getAttribute('aria-current')) === null,
  );
  check(
    'item 4: the raw words stay only on hover',
    (await cards.nth(1).getByLabel('Question', { exact: true }).getAttribute('title'))?.startsWith(
      'So um how would you design',
    ) === true,
    (await cards.nth(1).getByLabel('Question', { exact: true }).getAttribute('title')) ?? '',
  );
  check(
    'item 4: the old answer shows trimmed in the list, only once',
    (await call.getByText('Tell me about yourself?', { exact: true }).count()) === 1,
    String(await call.getByText('Tell me about yourself?', { exact: true }).count()),
  );
  await callShot('06-full-call-window-older-card-open');

  // "Answer this" on a question still being heard: a new card, on top and expanded.
  await call.getByRole('button', { name: 'Answer this' }).first().click();
  const added = await until(async () => (await cards.count()) === 4);
  await until(async () => (await call.getByText('Answering…').count()) === 0, 15_000);
  check(
    'item 2: "Answer this" on a grey question adds its answer on top of the list',
    added && (await cards.first().getAttribute('aria-current')) === 'true',
    `${await cards.count()} cards; top: ${(await cards.first().textContent())?.slice(0, 60)}`,
  );

  // Back with the button.
  await call.getByRole('button', { name: 'Back to compact' }).click();
  await until(async () => (await windows(app)).overlayVisible);
  await wait(500);
  state = await windows(app);
  check(
    'item 1: Back to compact returns to the overlay and the window steps aside',
    state.overlayVisible && state.mainMinimized,
    JSON.stringify(state),
  );
  await app.evaluate(() => {
    (globalThis as unknown as { rig: RigShell }).rig.find('overlay')?.moveTop();
  });
  await shot('07-back-to-compact');

  // ⋮ "Open call window", then Esc.
  await overlay.getByRole('button', { name: 'Overlay menu' }).click();
  await shot('08-overlay-menu');
  await overlay.getByRole('button', { name: 'Open call window' }).first().click();
  await until(async () => (await windows(app)).overlayVisible === false);
  await wait(400);
  state = await windows(app);
  check(
    'item 1: ⋮ Open call window opens it',
    !state.overlayVisible && !state.mainMinimized,
    JSON.stringify(state),
  );
  await call.keyboard.press('Escape');
  await until(async () => (await windows(app)).overlayVisible);
  await wait(400);
  state = await windows(app);
  check(
    'item 1: Esc returns to the overlay',
    state.overlayVisible && state.mainMinimized,
    JSON.stringify(state),
  );

  // The taskbar: the main window restored from outside the page, and minimised again.
  await app.evaluate(() => {
    (globalThis as unknown as { rig: RigShell }).rig.find('call')?.restore();
  });
  await until(async () => (await windows(app)).overlayVisible === false);
  state = await windows(app);
  check(
    'item 1: from the taskbar: restoring the window hides the overlay',
    !state.overlayVisible && !state.mainMinimized,
    JSON.stringify(state),
  );
  await app.evaluate(() => {
    (globalThis as unknown as { rig: RigShell }).rig.find('call')?.minimize();
  });
  await until(async () => (await windows(app)).overlayVisible);
  state = await windows(app);
  check(
    'item 1: minimising it brings the overlay back',
    state.overlayVisible && state.mainMinimized,
    JSON.stringify(state),
  );

  // Item 6: Ask Kite, and item 4: the history screen. The real pages, each in a plain window.
  const opened = async (route: string, name: string, check_: (page: Page) => Promise<void>) => {
    const pending = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow, screen }, url) => {
      const { x, y } = screen.getPrimaryDisplay().workArea;
      const win = new BrowserWindow({ x, y, width: 1100, height: 760 });
      win.setAlwaysOnTop(true, 'floating');
      void win.loadURL(url);
    }, `${RIG}${route}`);
    const page = await pending;
    await page.waitForLoadState('domcontentloaded');
    await wait(1_200);
    await check_(page);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.info(`shot  ${name}`);
    await page.close();
  };
  await opened('/ask', '09-ask-kite-solid', async (page) => {
    // The page paints on the window's own opaque background; only the glass rules could clear it.
    check('item 6: Ask Kite is solid', (await page.locator('.k-glass, .k-overlay').count()) === 0);
  });
  await opened('/history', '10-history-no-duplicates', async (page) => {
    const saved = page.getByRole('listitem', { name: 'Saved answer' });
    check(
      'item 4: history has one entry per question (2 of 4 saved)',
      (await saved.count()) === 2,
      String(await saved.count()),
    );
    check(
      'item 4: history shows the clean question, and old answers trimmed',
      (await page.getByText('How would you design a voice agent?', { exact: true }).count()) ===
        1 &&
        (await page.getByText('Tell me about yourself?', { exact: true }).count()) === 1 &&
        (await page.getByText('must not show').count()) === 0,
    );
  });

  check('no page errors', pageErrors.length === 0, pageErrors.join(', '));
  await app.close();
  console.info(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (error: unknown) => {
  console.error(error);
  await shell?.close().catch(() => undefined);
  process.exit(1);
});
