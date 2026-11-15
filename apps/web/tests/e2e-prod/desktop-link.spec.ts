/**
 * Production check of the one-time desktop sign-in codes (ADR-0052), as the end-to-end TEST account
 * (listed in KITE_SYNC_USERS). No Claude request. An invented session is put into the account; then:
 * - web: a code for it signs a fresh, signed-out browser in (a session of its own); the same code a
 *   second time, a code shown with another session, and a code after 60 seconds are all refused;
 * - desktop: this checkout's 1.3.0 shell, with a fresh temporary profile (never signed in), receives
 *   paramountai://session/<id>/<code> as a second launch would pass it, opens the link page, signs in
 *   with the code and shows the sessions card with that session first, "From your browser" (ADR-0055);
 *   a click opens its Connect card (ADR-0082: no Start card any more), and the panel is signed in.
 * Every session this run signs in with is signed out again, and the invented session is deleted. Codes
 * are never printed. Prints step names only.
 * Run: pnpm --filter @kite/desktop build, then
 *      pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts desktop-link.spec.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { desktopSessionLink } from '@kite/shared';
import {
  _electron as electron,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { PRODUCTION_URL, WEB_DIR, report, signIn, testAccount } from './helpers';

/** apps/desktop (built before this run). */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop. */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** This run's invented session. */
const SESSION = randomUUID();
const COMPANY = `E2E Link ${Date.now().toString(36)}`;

test.describe.configure({ mode: 'serial' });

let owner: BrowserContext;
let page: Page;

/**
 * A fresh code for this run's session, from the signed-in browser.
 *
 * @returns The code (kept in memory, never printed).
 */
function newCode(): Promise<string> {
  return page.evaluate(async (sessionId) => {
    const response = await fetch('/api/desktop/link-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    return ((await response.json()) as { code: string }).code;
  }, SESSION);
}

/**
 * Posts to a desktop-link endpoint from a page.
 *
 * @param from The page (its cookies).
 * @param path The endpoint under /api/auth.
 * @param body The body.
 * @returns The HTTP status.
 */
function post(from: Page, path: string, body: object): Promise<number> {
  return from.evaluate(
    async ([url, data]) =>
      (
        await fetch(url as string, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        })
      ).status,
    [`/api/auth${path}`, body] as const,
  );
}

/**
 * Whether a page is signed in as the test account, and signs it out (cleanup).
 *
 * @param from The page.
 * @returns True when it was signed in.
 */
async function signedInThenOut(from: Page): Promise<boolean> {
  return from.evaluate(async () => {
    const session = (await (await fetch('/api/auth/get-session')).json()) as {
      /** The signed-in account, when there is one. */
      user?: {
        /** Its id (only checked, never printed). */
        id: string;
      };
    } | null;
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return Boolean(session?.user?.id);
  });
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext();
  page = await owner.newPage();
  await signIn(page, testAccount());
  const status = await page.evaluate(
    async ([sessionId, company]) =>
      (
        await fetch('/api/sync/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ops: [
              {
                op: 'put',
                kind: 'session',
                id: sessionId,
                baseRev: null,
                record: {
                  id: sessionId,
                  type: 'regular',
                  company,
                  role: 'Pilot review',
                  description: '',
                  preferences: {
                    language: 'en',
                    model: 'fast',
                    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
                    keyTerms: '',
                  },
                  instructions: '',
                  saveTranscript: false,
                  autoAnswer: false,
                  createdAt: Date.now(),
                  status: 'not-started',
                  lastActiveAt: null,
                },
              },
            ],
          }),
        })
      ).status,
    [SESSION, COMPANY] as const,
  );
  expect(status).toBe(200);
});

test.afterAll(async () => {
  await page
    ?.evaluate(async (sessionId) => {
      await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops: [{ op: 'delete', kind: 'session', id: sessionId }] }),
      });
    }, SESSION)
    .catch(() => undefined);
  await owner?.close();
});

test('1. web: a code signs a fresh browser in once; reuse, another session and 60 s are refused', async ({
  browser,
}) => {
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto(`${PRODUCTION_URL}/login`);
  const code = await newCode();
  expect(await post(other, '/desktop-link/peek', { code })).toBe(200);
  expect(await post(other, '/desktop-link/redeem', { code, sessionId: SESSION })).toBe(200);
  expect(await post(other, '/desktop-link/redeem', { code, sessionId: SESSION })).toBe(400);
  expect(await signedInThenOut(other)).toBe(true);
  report('link code: signs in once, reuse refused', true);

  const wrong = await newCode();
  expect(await post(other, '/desktop-link/redeem', { code: wrong, sessionId: randomUUID() })).toBe(
    400,
  );
  // That try used the code up: it is refused for its own session too.
  expect(await post(other, '/desktop-link/redeem', { code: wrong, sessionId: SESSION })).toBe(400);
  report('link code: bound to its session', true);

  const late = await newCode();
  await other.waitForTimeout(61_000);
  expect(await post(other, '/desktop-link/redeem', { code: late, sessionId: SESSION })).toBe(400);
  report('link code: expires after 60 s', true);
  await fresh.close();
});

test('2. desktop 1.3.0: a link with a code opens the Connect card, signed in', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'kite-e2e-link-'));
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [`--user-data-dir=${profile}`, DESKTOP_DIR],
    // This checkout's shell opens production's address, as the desktop suite does.
    env: { ...env, KITE_URL: `${PRODUCTION_URL}/` },
  });
  try {
    const panel = await app.firstWindow();
    // A fresh profile: the panel shows the sign-in page.
    await expect(panel.getByLabel('Password')).toBeVisible({ timeout: 30_000 });
    const code = await newCode();
    // As a second launch from the browser's link would (Windows passes the link as an argument).
    await app.evaluate(
      ({ app: electronApp }, link) =>
        electronApp.emit('second-instance', {}, ['app.exe', link], ''),
      desktopSessionLink(SESSION, code),
    );
    // A fresh profile shows the acceptable-use notice once, over the card.
    await panel
      .getByRole('dialog', { name: 'Using Paramount AI' })
      .getByRole('button', { name: 'Got it' })
      .click({ timeout: 60_000 })
      .catch(() => undefined);
    // ADR-0055: the sessions card, with the link's session first and highlighted; a click opens its
    // Connect card (ADR-0082), signed in (signedInThenOut() checks the sign-in below).
    const fromBrowser = panel
      .getByRole('list', { name: 'Sessions' })
      .getByRole('button', { name: /from your browser/ });
    await expect(fromBrowser).toContainText(COMPANY, { timeout: 60_000 });
    await fromBrowser.click();
    await expect(panel.getByRole('heading', { name: 'Connect Call Session' })).toBeVisible();
    // The code never reached an address.
    expect(panel.url()).not.toContain(code);
    report('desktop link: connect card, signed in', true);
    expect(await signedInThenOut(panel)).toBe(true);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});
