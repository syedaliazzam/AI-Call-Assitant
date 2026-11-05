/**
 * Manual check (ADR-0048): can the desktop shell show Brandfetch's logos and reach its search? Runs
 * the shell on a temporary profile against a blank local page, without changing the shell, and the
 * same page in plain Chromium. It covers: another site's image draws in the shell; a logo and a search
 * end the same way in the shell as in plain Chromium, so the shell adds no block of its own; the page
 * can read the search reply. With a made-up ID Brandfetch refuses the logo, and Chromium then blocks
 * the reply as not an image, in both. With a real ID in KITE_BRANDFETCH_CLIENT_ID the logo must draw.
 * Prints statuses only, never the ID. This calls real servers, so it runs by hand and never in CI. It
 * makes no Claude call.
 * Usage: pnpm --filter @kite/desktop build, then, from apps/desktop,
 * pnpm exec playwright test -c playwright.manual.config.ts logo-images.spec.ts
 */
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, chromium, expect, test, type Page } from '@playwright/test';

/** apps/desktop. */
const DESKTOP_DIR = path.resolve(__dirname, '..', '..');

/** The Electron program. */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** A real client ID, when one is given for the full answer. */
const REAL_ID = process.env.KITE_BRANDFETCH_CLIENT_ID?.trim() ?? '';

/** The ID to send: without a real one, Brandfetch's server still answers, which is what is checked. */
const CLIENT_ID = REAL_ID || 'invented-client-id';

/** A public image on another site, to show that other sites' images draw in the shell at all. */
const OTHER_SITE_IMAGE = 'https://github.githubassets.com/favicons/favicon.png';

/**
 * The shape the web app asks for (src/core/companies/brandfetch.ts brandLogoUrl()).
 */
const LOGO_URL = `https://cdn.brandfetch.io/domain/nike.com/w/48/h/48/fallback/404/type/icon?c=${encodeURIComponent(CLIENT_ID)}`;

/** How a page fared with the images and the search. */
interface Outcome {
  /** Width of another site's image, or 0 when it failed. */
  otherSite: number;
  /** Width of the logo, or 0 when it failed. */
  logo: number;
  /** Why the logo request failed, or 'none'. */
  logoFailure: string;
  /** The search reply's status as the page read it, or 0 when it could not. */
  search: number;
}

/**
 * Loads the images and runs the search in a page.
 *
 * @param page The page.
 * @returns What happened.
 */
async function measure(page: Page): Promise<Outcome> {
  const statuses = new Map<string, number>();
  const failures: string[] = [];
  page.on('response', (response) => {
    const { host } = new URL(response.url());
    if (host.endsWith('brandfetch.io')) statuses.set(host, response.status());
  });
  page.on('requestfailed', (request) => {
    const { host } = new URL(request.url());
    if (host.endsWith('brandfetch.io')) failures.push(request.failure()?.errorText ?? 'failed');
  });

  /**
   * Loads an image in the page, as a card does.
   *
   * @param src Its address.
   * @returns Its drawn width, or 0 when it failed.
   */
  const drawnWidth = (src: string): Promise<number> =>
    page.evaluate(
      (address) =>
        new Promise<number>((resolve) => {
          const image = new Image();
          image.referrerPolicy = 'strict-origin-when-cross-origin';
          image.onload = () => resolve(image.naturalWidth);
          image.onerror = () => resolve(0);
          image.src = address;
        }),
      src,
    );

  const otherSite = await drawnWidth(OTHER_SITE_IMAGE);
  const logo = await drawnWidth(LOGO_URL);
  const search = await page.evaluate(async (id) => {
    try {
      const reply = await fetch(
        `https://api.brandfetch.io/v2/search/nike?c=${encodeURIComponent(id)}`,
        { credentials: 'omit' },
      );
      return reply.status;
    } catch {
      return 0;
    }
  }, CLIENT_ID);

  return { otherSite, logo, logoFailure: failures.join(',') || 'none', search };
}

let server: Server;

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><head><title>Blank</title></head><body></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('the shell reaches Brandfetch and draws images from other sites', async () => {
  const { port } = server.address() as AddressInfo;
  // ELECTRON_RUN_AS_NODE would make it plain Node.js (some editors set it for their children).
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [`--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'kite-logo-images-'))}`, DESKTOP_DIR],
    env: {
      ...parentEnv,
      KITE_URL: `http://127.0.0.1:${port}/`,
      KITE_NO_UPDATE_CHECK: '1',
      KITE_TEST_NO_EXTERNAL_OPEN: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState();

    const shell = await measure(page);
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    let plain: Outcome;
    try {
      const other = await browser.newPage();
      await other.goto(`http://127.0.0.1:${port}/`);
      plain = await measure(other);
    } finally {
      await browser.close();
    }
    console.log(`[logos] real id: ${REAL_ID !== ''}`);
    console.log(`[logos] shell:    ${JSON.stringify(shell)}`);
    console.log(`[logos] chromium: ${JSON.stringify(plain)}`);

    expect(shell.otherSite, 'an image from another site draws in the shell').toBeGreaterThan(0);
    expect(shell.search, 'the shell page can read the search reply').toBeGreaterThan(0);
    // The shell treats Brandfetch exactly as a browser does.
    expect(shell.logo > 0).toBe(plain.logo > 0);
    expect(shell.logoFailure).toBe(plain.logoFailure);
    expect(shell.search).toBe(plain.search);
    if (REAL_ID) {
      expect(shell.logo, 'the logo draws').toBeGreaterThan(0);
      expect(shell.search).toBe(200);
    }
  } finally {
    await app.close();
  }
});
