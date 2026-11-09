/**
 * Harness test for the shared UI pieces of the v1.2.0 foundation (spec §1, §3), no sign-in, runs in CI.
 * In a real browser it covers: Select (search, check mark, keys, wrapped long names, footer action, a
 * list inside a modal that sits above it and whose Escape does not close the modal), MultiSelect (ticks,
 * Select all, Clear, the empty field), SplitButton, Menu (keys, "Soon", sub-list), SegmentedControl and
 * RadioCards (arrow keys), Stepper, Toggle, the panel menu's rows, KeyCap (Windows and macOS keys), Modal
 * (one pane, rail, aside, full screen on a phone) and the measured sizes and colours of spec §1, in light
 * and dark. Set KITE_SCREENSHOT_DIR to also save screenshots.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { pickOption } from '../lib/pick-option';
import { brandFonts } from '../lib/fonts';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where to save screenshots, or '' for none. */
const SHOT_DIR = process.env.KITE_SCREENSHOT_DIR ?? '';

/** The part of postcss used here (not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let origin = '';
let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-ui-kit-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'ui-kit.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
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
  writeFileSync(path.join(bundleDir, 'ui-kit.css'), css.css);
  server = createServer((req, res) => {
    if (req.url === '/harness/ui-kit.js' || req.url === '/harness/ui-kit.css') {
      const isCss = req.url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'ui-kit.css' : 'ui-kit.js')));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UI kit harness</title>' +
        '<link rel="stylesheet" href="/harness/ui-kit.css">' +
        brandFonts() +
        '</head>' +
        '<body class="bg-ui-bg font-sans text-[16px] leading-6 text-ui-text"><div id="root"></div>' +
        '<script type="module" src="/harness/ui-kit.js"></script></body></html>',
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  context = await browser!.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1.5,
  });
  page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => 'uiKitReady' in window);
});

test.afterEach(async () => {
  await context.close();
});

/**
 * What the harness has logged.
 *
 * @returns The log.
 */
const logged = () => page.evaluate(() => (window as unknown as { uiKitLog: string[] }).uiKitLog);

/**
 * Saves a screenshot when asked to.
 *
 * @param name The file's name.
 */
async function shot(name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

test('sizes and colours follow the spec, in light and in dark', async () => {
  const measure = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          height: box.height,
          radius: style.borderTopLeftRadius,
          size: style.fontSize,
          weight: style.fontWeight,
          background: style.backgroundColor,
          color: style.color,
        };
      });

  const primary = await measure('button:has-text("Primary")');
  // v1.3.0 (ADR-0057): 36 tall, 14/500 (Inter Tight), with a subtle shadow.
  expect(primary).toMatchObject({
    height: 36,
    radius: '10px',
    size: '14px',
    weight: '500',
    background: 'rgb(24, 24, 27)',
    color: 'rgb(255, 255, 255)',
  });
  expect(await measure('button:has-text("Large accent")')).toMatchObject({
    height: 52,
    background: 'rgb(37, 99, 235)',
  });
  expect(await measure('button:has-text("Ghost")')).toMatchObject({
    background: 'rgb(244, 244, 245)',
  });
  expect(await measure('button:has-text("Danger")')).toMatchObject({
    background: 'rgb(220, 38, 38)',
    color: 'rgb(255, 255, 255)',
  });
  expect(await measure('input[placeholder="Company name"]')).toMatchObject({
    height: 40,
    radius: '10px',
  });
  expect(await measure('label:has-text("Company")')).toMatchObject({
    size: '14px',
    weight: '500',
  });
  expect(await measure('span.rounded-full:has-text("Soon")')).toMatchObject({
    height: 24,
    size: '12px',
    weight: '500',
  });
  const page_ = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(page_).toBe('rgb(255, 255, 255)');
  await shot('ui-kit-light');

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(15, 15, 17)',
  );
  // Buttons animate their colours over 150 ms.
  await expect
    .poll(() => measure('button:has-text("Primary")'))
    .toMatchObject({ background: 'rgb(244, 244, 245)', color: 'rgb(24, 24, 27)' });
  await shot('ui-kit-dark');
});

test('Select: search, check mark, keys, the footer action and long names', async () => {
  const language = page.getByRole('combobox', { name: 'Language', exact: true });
  await language.click();
  const search = page.getByRole('textbox', { name: 'Search language' });
  await expect(search).toBeFocused();
  await expect(page.getByRole('option')).toHaveCount(8);
  await expect(page.getByRole('option', { name: 'English' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shot('select-open');
  await search.fill('sp');
  await expect(page.getByRole('option')).toHaveCount(1);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(language).toHaveText('Spanish');
  await expect(language).toBeFocused();

  await language.click();
  await search.fill('zzz');
  await expect(page.getByText('No matches')).toBeVisible();
  await search.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(language).toHaveText('Spanish');

  // Without a search box: keys and type-ahead, a tag, a disabled option.
  const model = page.getByRole('combobox', { name: 'Model' });
  await model.focus();
  await model.press('ArrowDown');
  await expect(page.getByRole('option', { name: /Sonnet/ })).toContainText('Deeper, slower');
  await page.getByRole('option', { name: 'Turned off' }).click({ force: true });
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  expect(await logged()).toContain('model:smart');

  // A long name wraps inside the list, and the footer action runs.
  await pickOption(
    page,
    page.getByRole('combobox', { name: 'CV / Resume' }),
    'A resume with a very long file name that has to wrap (1) (1).pdf',
  );
  const resume = page.getByRole('combobox', { name: 'CV / Resume' });
  await expect(resume).toContainText('A resume with');
  await resume.click();
  await page.getByRole('button', { name: 'Upload a resume' }).click();
  expect(await logged()).toContain('upload');
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('a list inside a modal sits above it, and Escape closes only the list', async () => {
  await page.getByRole('button', { name: 'Open modal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plain modal' });
  await expect(dialog).toBeVisible();
  // It follows its content; it must not stretch to the window's height.
  expect((await dialog.boundingBox())!.height).toBeLessThan(400);
  const field = dialog.getByRole('combobox', { name: 'Language in the modal' });
  await field.click();
  const option = page.getByRole('option', { name: 'Croatian' });
  await expect(option).toBeVisible();
  // The list reaches below the modal's own bottom edge, and still takes the click.
  await shot('select-in-modal');
  const modalBottom = (await dialog.boundingBox())!;
  const optionBox = (await page.getByRole('option', { name: 'Spanish' }).boundingBox())!;
  expect(optionBox.y).toBeGreaterThan(modalBottom.y + modalBottom.height);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('MultiSelect: ticks, Select all, Clear and the empty field', async () => {
  await expect(page.getByRole('combobox', { name: 'Empty documents' })).toHaveText(
    'No documents yet',
  );
  const docs = page.getByRole('combobox', { name: 'Documents', exact: true });
  await docs.click();
  await page.getByRole('option', { name: 'Runbook' }).click();
  await expect(docs).toHaveText('Runbook');
  await expect(page.getByRole('option', { name: 'Runbook' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(docs).toHaveText('2 selected');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(docs).toHaveText('None selected');
  await page.getByRole('button', { name: 'Add a document' }).click();
  expect(await logged()).toContain('add-doc');
});

test('SplitButton: the main part and the ▾ menu', async () => {
  await page.getByRole('button', { name: 'Create session' }).click();
  expect(await logged()).toContain('split-main');
  const more = page.getByRole('button', { name: 'More session types' });
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Interview call' })).toBeFocused();
  await shot('split-menu');
  await page.getByRole('menuitem', { name: 'Mock interview' }).click();
  expect(await logged()).toContain('mock');
  await more.click();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('Menu: keys, a "Soon" row that does nothing, a sub-list and a click elsewhere', async () => {
  const open = page.getByRole('button', { name: 'Open menu' });
  await open.click();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Duplicate/ })).toBeFocused();
  await expect(page.getByRole('menuitem', { name: /Tutorials/ })).toBeDisabled();
  await page.getByRole('menuitem', { name: /Tutorials/ }).hover({ force: true });
  await expect(page.getByRole('tooltip')).toHaveText('Coming soon');
  await page.getByRole('menuitem', { name: /Theme/ }).click();
  await page.getByRole('menuitem', { name: 'Dark' }).click();
  expect(await logged()).toContain('theme:dark');
  await open.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('SegmentedControl, RadioCards, Stepper and Toggle', async () => {
  const interview = page.getByRole('radio', { name: 'Interview' });
  await interview.focus();
  // One focus ring, not two: the fallback outline must lose to the component's own.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Regular' })).toHaveCSS('outline-style', 'none');
  await expect(page.getByRole('radio', { name: 'Regular' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Regular' })).toBeFocused();

  const balanced = page.getByRole('radio', { name: /Balanced/ });
  await expect(balanced).toBeChecked();
  await balanced.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /Detailed/ })).toBeChecked();

  // The stepper's circle: 28 px, and pending until its step is reached.
  const two = page.getByText('2', { exact: true }).first();
  await expect(two).toHaveCSS('width', '28px');
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(two).toHaveCSS('background-color', 'rgb(37, 99, 235)');

  const save = page.getByRole('switch', { name: 'Save transcript' });
  await save.click();
  await expect(save).toHaveAttribute('aria-checked', 'true');
  await expect(save.locator('span').first()).toHaveCSS('background-color', 'rgb(37, 99, 235)');
});

test('the panel menu: rows 40 tall, steppers, "Soon" rows and the theme group', async () => {
  const dashboard = page.getByRole('button', { name: 'Dashboard' });
  expect((await dashboard.boundingBox())!.height).toBe(40);
  await dashboard.click();
  await page.getByRole('button', { name: 'Zoom: more' }).click();
  await page.getByRole('button', { name: 'Zoom: less' }).click();
  await page.getByRole('button', { name: 'Zoom: reset' }).click();
  expect(await logged()).toEqual(expect.arrayContaining(['dashboard', 'more', 'less', 'reset']));
  await expect(page.getByRole('button', { name: /Voice profile/ })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Meeting detect' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Dark theme' }).click();
  await expect(page.getByRole('radio', { name: 'Dark theme' })).toBeChecked();
});

test('KeyCap reads the hotkey map: Ctrl on Windows, ⌘ on macOS', async () => {
  await expect(page.locator('kbd').nth(0)).toHaveText('Ctrl↵');
  await expect(page.locator('kbd').nth(1)).toHaveText('Ctrl⇧↵');
  await expect(page.locator('kbd').nth(2)).toHaveText('Ctrl⇧⌫');
  await expect(page.locator('kbd').nth(3)).toHaveText('Ctrl←');

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  });
  await page.reload();
  await page.waitForFunction(() => 'uiKitReady' in window);
  await expect(page.locator('kbd').nth(0)).toHaveText('⌘↵');
  await expect(page.locator('kbd').nth(1)).toHaveText('⌘⇧↵');
});

test('Modal: rail and aside panes, sizes, Escape, and full screen on a phone', async () => {
  await page.getByRole('button', { name: 'Open rail modal' }).click();
  const rail = page.getByRole('dialog', { name: 'Create session' });
  await expect(rail).toBeVisible();
  const box = (await rail.boundingBox())!;
  expect(box.width).toBeCloseTo(760, 0);
  expect(box.height).toBeCloseTo(600, 0);
  await expect(rail).toHaveCSS('border-top-left-radius', '20px');
  await expect(rail.getByRole('heading', { name: 'Create session' })).toHaveCSS(
    'font-size',
    '24px',
  );
  await expect(rail.getByRole('button', { name: 'Next' })).toHaveCSS('height', '52px');
  await shot('modal-rail');
  // The main pane scrolls by itself; the footer stays visible.
  await rail.getByText('A tall block').hover();
  await page.mouse.wheel(0, 800);
  await expect(rail.getByRole('button', { name: 'Next' })).toBeInViewport();
  // A click on the backdrop does not lose typed work here.
  await page.mouse.click(5, 5);
  await expect(rail).toBeVisible();
  await rail.getByRole('button', { name: 'Close' }).click();
  await expect(rail).toBeHidden();

  await page.getByRole('button', { name: 'Open aside modal' }).click();
  const aside = page.getByRole('dialog', { name: 'Answer preferences' });
  await expect(aside.getByText('The preview goes here.')).toBeVisible();
  await shot('modal-aside');
  await page.keyboard.press('Escape');
  await expect(aside).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open rail modal' }).click();
  const phone = (await rail.boundingBox())!;
  expect(phone.width).toBeCloseTo(390, 0);
  expect(phone.height).toBeCloseTo(844, 0);
  await shot('modal-phone');
});
