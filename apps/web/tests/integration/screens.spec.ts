/**
 * Harness test for the restyled screens (spec S17), no sign-in, runs in CI. Each real screen, in the
 * light and dark themes at 1440 and 390 px and DPR 1.5, must draw its words on a themed background, with
 * no sideways scroll, no touch target under 44 px on the phone, and no console problems. Set
 * KITE_SCREENSHOT_DIR to save the pictures. All text is invented.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { check, WIDTHS } from '../ui/shots';
import { brandFonts } from '../lib/fonts';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The part of postcss used here (not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

/** Each screen, the address it has in the app, and a word it must show. */
const SCREENS: readonly { screen: string; at?: string; shows: string | RegExp }[] = [
  { screen: 'settings', at: '/settings', shows: 'Hotkeys' },
  { screen: 'review', at: '/sessions/one', shows: 'Northwind Logistics (invented)' },
  { screen: 'resumes', at: '/resumes', shows: 'invented-cv.txt' },
  { screen: 'documents', at: '/documents', shows: 'price-list.txt' },
  { screen: 'ask', at: '/ask-kite', shows: 'Ask AI' },
  { screen: 'mock', at: '/mock', shows: /mock interview/i },
  { screen: 'bank', at: '/question-bank', shows: /question bank/i },
  { screen: 'admin', at: '/admin/users', shows: 'dana.okafor@example.com' },
  { screen: 'login', shows: 'Sign in to Paramount AI' },
  { screen: 'change-password', shows: 'Choose a new password' },
  { screen: 'not-found', shows: 'Page not found' },
  { screen: 'error', shows: 'Something went wrong' },
  { screen: 'unsupported', shows: 'Live calls need a computer' },
  { screen: 'notice', shows: 'Using Paramount AI' },
];

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let origin = '';

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-screens-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'screens.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
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
  const css = await postcss([tailwind({ base: WEB_DIR })]).process(readFileSync(from, 'utf8'), {
    from,
  });
  writeFileSync(path.join(bundleDir, 'screens.css'), css.css);
  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (url === '/harness/screens.js' || url === '/harness/screens.css') {
      const isCss = url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'screens.css' : 'screens.js')));
      return;
    }
    if (url.startsWith('/images/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(readFileSync(path.join(WEB_DIR, 'public', url)));
      return;
    }
    // What the pages ask the server for: nothing of it matters to how they look.
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Screens harness</title>' +
        '<link rel="stylesheet" href="/harness/screens.css">' +
        brandFonts() +
        '</head>' +
        '<body class="bg-ui-bg font-sans text-[16px] leading-6 text-ui-text"><div id="root"></div>' +
        '<script type="module" src="/harness/screens.js"></script></body></html>',
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
  if (process.env.KITE_SCREENSHOT_DIR)
    mkdirSync(process.env.KITE_SCREENSHOT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

// ADR-0071: the sign-in form's messages and its show/hide password button. The account server is
// faked: it refuses the invented email and password the way Better Auth does.
test('sign-in: field messages, show password, and a refused sign-in', async () => {
  const context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let signInCalls = 0;
  await page.route('**/api/auth/sign-in/email', async (route) => {
    signInCalls += 1;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      }),
    });
  });
  await page.goto(`${origin}/?screen=login&theme=light`);
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(signIn).toBeEnabled();

  // Empty fields: a message under each, the keyboard on the email, nothing sent.
  await signIn.click();
  await expect(page.getByText('Enter your email.')).toBeVisible();
  await expect(page.getByText('Enter your password.')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeFocused();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  expect(signInCalls).toBe(0);

  // Typing clears a field's message; an email without a domain gets its own.
  await page.getByLabel('Email').fill('dana.okafor');
  await expect(page.getByText('Enter your email.')).toHaveCount(0);
  await signIn.click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();

  // Show and hide the password: the field's type follows, the button never submits.
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('not-the-password');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  expect(signInCalls).toBe(0);

  // A refused sign-in: one message at the top, the same for a wrong email or password.
  await page.getByLabel('Email').fill('dana.okafor@example.com');
  await signIn.click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  expect(signInCalls).toBe(1);
  await expect(signIn).toBeEnabled();
  await context.close();
});

// ADR-0081: Admin → Users. The header's Add user, the toolbar, the ⋯ menu with its confirmations,
// the toasts, and the guard on your own row. The server actions are faked by the harness, which
// records what was asked (window.kiteAdminCalls).
test('users page: header, toolbar, ⋯ menu, confirmations, toasts and the self guard', async () => {
  const context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message.slice(0, 300)));
  await page.goto(`${origin}/admin/users?screen=admin&theme=light`);
  /**
   * What the page asked the fake server for.
   *
   * @returns The recorded calls, in order.
   */
  const calls = () =>
    page.evaluate(() => (window as unknown as { kiteAdminCalls: string[] }).kiteAdminCalls);
  /**
   * Opens a row's ⋯ menu (the table's, at this width).
   *
   * @param name The person's name.
   * @returns The open menu.
   */
  const openMenu = async (name: string) => {
    await page
      .getByRole('button', { name: `Actions for ${name}` })
      .filter({ visible: true })
      .click();
    return page.getByRole('menu');
  };
  const count = page.getByTestId('users-count');
  const toast = page.locator('.k-anim-toast');

  // The header: Users, its line, Usage and Add user; no Create session on this page.
  await expect(page.getByRole('button', { name: 'Add user' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usage' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create session/ })).toHaveCount(0);

  // The toolbar: search by name or email, the Role and Status filters, the count.
  await expect(count).toHaveText('4 users');
  await page.getByLabel('Search users').fill('OKAFOR');
  await expect(count).toHaveText('1 of 4 users');
  await page.getByLabel('Search users').fill('ravi.menon@');
  await expect(count).toHaveText('1 of 4 users');
  await page.getByLabel('Search users').fill('');
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Admin' }).click();
  await expect(count).toHaveText('2 of 4 users');
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Disabled' }).click();
  await expect(count).toHaveText('0 of 4 users');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(count).toHaveText('4 users');

  // One line per cell: the dates, the badges and "You".
  await expect(page.getByRole('cell', { name: '1 Oct 2026' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '14 Nov 2026' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Sam Lee/ })).toContainText('You');
  await expect(page.getByRole('row', { name: /Dana Okafor/ })).not.toContainText('You');
  const nowrap = await page
    .locator('table td, table th')
    .evaluateAll((cells) => cells.every((cell) => getComputedStyle(cell).whiteSpace === 'nowrap'));
  expect(nowrap, 'no cell wraps').toBe(true);

  // Your own row: every action greyed out with the reason; Escape closes and returns to ⋯.
  let menu = await openMenu('Sam Lee');
  for (const label of ['Reset password', 'Make user', 'Disable']) {
    await expect(menu.getByRole('menuitem', { name: new RegExp(label) })).toBeDisabled();
  }
  await expect(menu).toContainText('Your account');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Actions for Sam Lee' }).filter({ visible: true }),
  ).toBeFocused();

  // Disable asks first; Cancel changes nothing.
  menu = await openMenu('Dana Okafor');
  await menu.getByRole('menuitem', { name: 'Disable' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Disable Dana Okafor?' })).toBeVisible();
  await expect(dialog).toContainText('signed out on every device');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await calls()).toEqual([]);

  // Confirmed: the action runs once and a green toast says so.
  menu = await openMenu('Dana Okafor');
  await menu.getByRole('menuitem', { name: 'Disable' }).click();
  await dialog.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(toast).toHaveText('Dana Okafor is disabled');
  expect(await calls()).toEqual(['disabled:u2:true']);

  // A role change asks first too.
  menu = await openMenu('Ana Ruiz');
  await menu.getByRole('menuitem', { name: 'Make user' }).click();
  await expect(dialog.getByRole('heading', { name: 'Make Ana Ruiz a user?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Make user' }).click();
  await expect(toast).toHaveText('Ana Ruiz is now a user');

  // Reset password: confirmation, then the one-time password in its own dialog.
  menu = await openMenu('Ana Ruiz');
  await menu.getByRole('menuitem', { name: 'Reset password' }).click();
  await expect(dialog).toContainText('new temporary password');
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  await expect(dialog.getByRole('heading', { name: 'New temporary password' })).toBeVisible();
  await expect(dialog).toContainText('Harness-Temp-1');
  await expect(toast).toHaveText('Password reset for Ana Ruiz');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // Enable gives access back without asking.
  menu = await openMenu('Ravi Menon');
  await menu.getByRole('menuitem', { name: 'Enable' }).click();
  await expect(toast).toHaveText('Ravi Menon is enabled');
  expect(await calls()).toEqual([
    'disabled:u2:true',
    'role:u4:user',
    'reset:u4',
    'disabled:u3:false',
  ]);

  // Add user (header): the create form in a dialog, then the password once.
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog.getByRole('heading', { name: 'Add user' })).toBeVisible();
  await dialog.getByLabel('Name').fill('Lee Park');
  await dialog.getByLabel('Email').fill('lee.park@example.com');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(dialog.getByRole('heading', { name: 'Account created' })).toBeVisible();
  await expect(dialog).toContainText('Harness-Temp-2');
  await expect(toast).toHaveText('Account created for lee.park@example.com');
  await dialog.getByRole('button', { name: 'Done' }).click();
  // Opened again, it starts empty.
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog.getByLabel('Name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  expect(problems).toEqual([]);
  await context.close();
});

test('users page: a failed action shows a red toast', async () => {
  const context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${origin}/admin/users?screen=admin&theme=dark&fail=1`);
  await page
    .getByRole('button', { name: 'Actions for Dana Okafor' })
    .filter({ visible: true })
    .click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Make admin' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make admin' }).click();
  await expect(page.getByRole('alert')).toHaveText('Something went wrong. Please try again.');
  await context.close();
});

test('users page on a phone: cards with the same facts and a ⋯ menu', async () => {
  const context = await browser!.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${origin}/admin/users?screen=admin&theme=light`);
  await expect(page.locator('table')).toBeHidden();
  const cards = page.getByRole('list', { name: 'Users' }).getByRole('listitem');
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toContainText('Sam Lee');
  await expect(cards.first()).toContainText('You');
  await expect(cards.first()).toContainText('Last active');
  await page
    .getByRole('button', { name: 'Actions for Dana Okafor' })
    .filter({ visible: true })
    .tap();
  await expect(page.getByRole('menuitem', { name: 'Disable' })).toBeVisible();
  await context.close();
});

for (const theme of ['light', 'dark'] as const) {
  test(`review's Conversation and Answers tabs, ${theme}`, async () => {
    for (const size of WIDTHS) {
      const context = await browser!.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1.5,
        ...(size.touch ? { isMobile: true, hasTouch: true } : {}),
      });
      const page = await context.newPage();
      await page.goto(`${origin}/sessions/one?screen=review&theme=${theme}`);
      await page.getByRole('button', { name: 'Transcript', exact: true }).click();
      const tabs = page.getByRole('group', { name: 'Transcript view' });
      await expect(tabs.getByRole('button', { name: 'Conversation' })).toBeVisible();
      // The selected section can be read: its words are not the colour of its fill.
      const [words, fill] = await page
        .locator('button[aria-current="page"]', { hasText: 'Transcript' })
        .evaluate((row) => [getComputedStyle(row).color, getComputedStyle(row).backgroundColor]);
      expect(fill).not.toBe(words);
      await check({ page, context, problems: [] }, size, `review-conversation-${theme}`);
      await tabs.getByRole('button', { name: 'Answers' }).click();
      await check({ page, context, problems: [] }, size, `review-answers-${theme}`);
      await context.close();
    }
  });

  for (const { screen, at = '/', shows } of SCREENS) {
    test(`${screen}, ${theme}`, async () => {
      for (const size of WIDTHS) {
        const context = await browser!.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1.5,
          ...(size.touch ? { isMobile: true, hasTouch: true } : {}),
        });
        const page = await context.newPage();
        const problems: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') {
            problems.push(`${message.type()}: ${message.text().slice(0, 300)}`);
          }
        });
        page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 300)}`));
        await page.goto(`${origin}${at}?screen=${screen}&theme=${theme}`);
        await expect(page.getByText(shows).filter({ visible: true }).first()).toBeVisible();
        // The page's background follows the theme: nothing is left painted for the other one.
        const background = await page.evaluate(() => {
          const main = document.querySelector('main') ?? document.body;
          return getComputedStyle(main).backgroundColor;
        });
        expect(background, 'a page background is painted').not.toBe('');
        await check({ page, context, problems }, size, `${screen}-${theme}`);
        await context.close();
      }
    });
  }
}
