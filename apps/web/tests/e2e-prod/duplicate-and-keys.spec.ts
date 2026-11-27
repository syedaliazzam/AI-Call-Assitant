/**
 * Production check of ADR-0128 (hotkeys for the computer you are on, one source) and ADR-0129 (Duplicate copies the
 * setup only, as "Copy of <name>"), as the disposable end-to-end TEST account. No Claude request: no live page is
 * opened and no call is connected. Three "devices": two Chrome profiles and the desktop shell (apps/desktop as built
 * from this checkout) with a fresh temporary profile. Covers:
 *   keys: Settings → Hotkeys opens on this computer's set (Windows here) and its Mac / Windows switch shows the
 *         Mac's ⌃ keys; Help shows the same list; in the desktop app Settings shows the keys the app holds;
 *   duplicate: the dashboard's Duplicate makes "Copy of <topic>" with the document; the copy reaches the other
 *         profile and the desktop app, whose Start opens Connect; the desktop menu's and the session page's
 *         Duplicate work; deleting the original leaves the copy's document in the account.
 * Invented data under a unique company per run; everything with that company is deleted at the end through the sync
 * API. Prints step names and counts only.
 * Run: pnpm --filter @kite/desktop build, then
 *      pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts duplicate-and-keys.spec.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  PRODUCTION_URL,
  WEB_DIR,
  createSession,
  inventedDocument,
  report,
  signIn,
  testAccount,
} from './helpers';

/** apps/desktop (built before this run). */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop. */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** A unique company for this run. */
const COMPANY = `E2E Dup Co ${Date.now().toString(36)}`;

/** The topic helpers.createSession() gives a regular session (its card's title). */
const TOPIC = 'Pilot review';

/** The copy's card title. */
const COPY = `Copy of ${TOPIC}`;

/** A fresh desktop profile for this run. */
const PROFILE_DIR = mkdtempSync(path.join(tmpdir(), 'kite-e2e-dup-'));

test.describe.configure({ mode: 'serial' });

let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;
let app: ElectronApplication | undefined;
let panel: Page;

/** One synced record, as /api/sync/pull returns it (only the fields read here). */
interface PulledRecord {
  /** The record's kind ('session', 'document', …). */
  kind: string;
  /** Its id. */
  id: string;
  /** Its session, for a session's children. */
  sessionId: string | null;
  /** True for a tombstone. */
  deleted: boolean;
  /** The record, or null for a tombstone. */
  record: {
    /** A session's company. */
    company?: string;
    /** A session's own name (ADR-0129). */
    name?: string;
  } | null;
}

/**
 * Every record of the account, through the sync API (as the signed-in page).
 *
 * @param page A signed-in page.
 * @returns The records (every page of the pull).
 */
async function pullAll(page: Page): Promise<PulledRecord[]> {
  return page.evaluate(async () => {
    const all: unknown[] = [];
    let after: string | null = null;
    for (let round = 0; round < 50; round += 1) {
      const query: string = after === null ? '' : `&after=${encodeURIComponent(after)}`;
      const response = await fetch(`/api/sync/pull?since=0${query}`);
      if (!response.ok) break;
      const body = (await response.json()) as {
        /** The page's records. */
        records: unknown[];
        /** The next page's token; null on the last page. */
        next: string | null;
      };
      all.push(...body.records);
      if (body.next === null) break;
      after = body.next;
    }
    return all;
  }) as Promise<PulledRecord[]>;
}

/**
 * This run's live sessions in the account.
 *
 * @param page A signed-in page.
 * @returns Their ids and names (no other text).
 */
async function runSessions(page: Page): Promise<{ id: string; name: string | undefined }[]> {
  return (await pullAll(page))
    .filter((r) => r.kind === 'session' && !r.deleted && r.record?.company === COMPANY)
    .map((r) => ({ id: r.id, name: r.record?.name }));
}

/**
 * A dashboard card of this run, by its heading.
 *
 * @param page  The page.
 * @param title The card's title.
 * @returns The card.
 */
function card(page: Page, title: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .filter({ hasText: COMPANY });
}

/**
 * Reloads a dashboard until a card shows.
 *
 * @param page  The page.
 * @param title The card's title.
 */
async function waitForCard(page: Page, title: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(PRODUCTION_URL);
        await page.waitForTimeout(3_000);
        return card(page, title).count();
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBeGreaterThan(0);
}

test.beforeAll(async ({ browser }) => {
  contextA = await browser.newContext();
  contextB = await browser.newContext();
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  await signIn(pageA, testAccount());
  await signIn(pageB, testAccount(), true);
});

test.afterAll(async () => {
  // Clean up only what this run made: sessions with this run's company (their children go with them).
  if (pageA) {
    const ids = await runSessions(pageA).catch(() => []);
    if (ids.length > 0) {
      await pageA
        .evaluate(
          async (ops) => {
            await fetch('/api/sync/push', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ops }),
            });
          },
          ids.map(({ id }) => ({ op: 'delete', kind: 'session', id })),
        )
        .catch(() => undefined);
    }
    report('cleanup: sessions deleted', true, { sessions: ids.length });
  }
  await app?.close().catch(() => undefined);
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  await contextA?.close();
  await contextB?.close();
});

test('1. keys: Settings opens on Windows, the switch shows the Mac’s ⌃ keys, Help shows the same list', async () => {
  await pageA.goto(`${PRODUCTION_URL}/settings`);
  const keySet = pageA.getByRole('radiogroup', { name: 'Keys for' });
  await expect(keySet).toBeVisible({ timeout: 30_000 });
  await expect(keySet.getByRole('radio', { name: 'Windows' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const answerRow = pageA.getByRole('row', { name: /^Answer \(on a call/ });
  await expect(answerRow.locator('kbd')).toContainText('Ctrl');
  await keySet.getByRole('radio', { name: 'Mac' }).click();
  await expect(answerRow.locator('kbd')).toContainText('⌃');
  await expect(answerRow.locator('kbd')).not.toContainText('Ctrl');
  await expect(pageA.getByText('These are the keys on a Mac')).toBeVisible();
  report('keys: Settings Windows → Mac switch', true);

  await pageA.goto(`${PRODUCTION_URL}/help`);
  const help = pageA.locator('[data-help-hotkeys]');
  await expect(help.getByRole('radiogroup', { name: 'Keys for' })).toBeVisible({ timeout: 30_000 });
  await expect(help.getByRole('row', { name: /^Answer \(on a call/ }).locator('kbd')).toContainText(
    'Ctrl',
  );
  // The old hand-written table is gone (it showed as one paragraph of "|").
  await expect(pageA.getByText('| Action |')).toHaveCount(0);
  report('keys: Help shows the Settings list', true);
});

test('2. duplicate on the dashboard: "Copy of <topic>" with the document, not started', async () => {
  await createSession(pageA, {
    company: COMPANY,
    keyTerms: ['Northwind'],
    document: inventedDocument(),
  });
  await card(pageA, TOPIC)
    .getByRole('button', { name: /^More for / })
    .click();
  await pageA.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(card(pageA, COPY)).toBeVisible({ timeout: 30_000 });
  await expect(card(pageA, COPY)).toContainText('Ready to start');
  // The copy's document, as the Edit wizard lists it.
  await card(pageA, COPY)
    .getByRole('button', { name: /^More for / })
    .click();
  await pageA.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(pageA.getByRole('combobox', { name: 'Documents' })).toHaveText(
    inventedDocument().name,
    { timeout: 30_000 },
  );
  await pageA.goto(PRODUCTION_URL);
  report('duplicate: dashboard copy with its document', true);
});

test('3. the copy reaches the other Chrome profile and the account', async () => {
  await waitForCard(pageB, COPY);
  await expect
    .poll(async () => (await runSessions(pageA)).filter((s) => s.name === COPY).length, {
      timeout: 60_000,
    })
    .toBe(1);
  report('duplicate: copy in profile B and in the account', true);
});

test('4. desktop app: the copy is listed and opens Connect; its menu duplicates; Settings shows held keys', async () => {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [`--user-data-dir=${PROFILE_DIR}`, DESKTOP_DIR],
    env: { ...env, KITE_URL: `${PRODUCTION_URL}/` },
  });
  panel = await app.firstWindow();
  await signIn(panel, testAccount(), true, true);
  await panel
    .getByRole('dialog', { name: 'Using Paramount AI' })
    .getByRole('button', { name: 'Got it' })
    .click({ timeout: 10_000 })
    .catch(() => undefined);
  const list = panel.getByRole('list', { name: 'Sessions' });
  await expect(list).toContainText(COPY, { timeout: 60_000 });
  const copyCard = list
    .getByRole('listitem')
    .filter({ hasText: COPY })
    .filter({ hasText: COMPANY });
  await copyCard.getByRole('button', { name: new RegExp(`^Start session: ${COPY}`) }).click();
  await expect(panel.getByText('Connect Call Session')).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Back', exact: true }).first().click();
  report('desktop: copy listed, Start opens Connect', true);

  await expect(list).toContainText(COPY, { timeout: 30_000 });
  await copyCard
    .first()
    .getByRole('button', { name: /^More for / })
    .click();
  await panel.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(list).toContainText(`Copy of ${COPY}`, { timeout: 30_000 });
  report('desktop: menu Duplicate', true);

  // ADR-0128: in the desktop app the list shows what the app holds (this checkout's shell: the table's keys).
  await panel.goto(`${PRODUCTION_URL}/settings`);
  const keySet = panel.getByRole('radiogroup', { name: 'Keys for' });
  await expect(keySet).toBeVisible({ timeout: 30_000 });
  await expect(keySet.getByRole('radio', { name: 'Windows' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    panel.getByRole('row', { name: /^Show or hide overlay/ }).locator('kbd'),
  ).toContainText('Y');
  // The shell's own report (the list above reads it through getPlatform()); a test reads it directly.
  const held = await panel.evaluate(async () => {
    const bridge = (
      window as unknown as {
        /** The desktop bridge (only the method read here). */
        kiteDesktop?: {
          /** Which global shortcuts the shell holds. */
          checkHotkeys?: () => Promise<unknown[]>;
        };
      }
    ).kiteDesktop;
    return (await bridge?.checkHotkeys?.())?.length ?? 0;
  });
  expect(held).toBeGreaterThan(10);
  report('desktop: Settings shows the held keys', true, { reported: held });
});

test('5. the session page’s Duplicate opens the copy’s page', async () => {
  const original = (await runSessions(pageA)).find((s) => s.name === undefined);
  expect(original).toBeTruthy();
  await pageA.goto(`${PRODUCTION_URL}/sessions/${original!.id}`);
  await pageA.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(pageA).not.toHaveURL(new RegExp(`/sessions/${original!.id}$`), { timeout: 30_000 });
  await expect(pageA.getByRole('heading', { name: COPY, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  report('duplicate: session page', true);
});

test('6. deleting the original leaves every copy’s document in the account', async () => {
  const sessions = await runSessions(pageA);
  const original = sessions.find((s) => s.name === undefined)!;
  const copies = sessions.filter((s) => s.name !== undefined);
  expect(copies.length).toBe(3);
  await pageA.goto(PRODUCTION_URL);
  await card(pageA, TOPIC)
    .getByRole('button', { name: /^More for / })
    .click();
  await pageA.getByRole('menuitem', { name: 'Delete' }).click();
  await pageA.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card(pageA, TOPIC)).toHaveCount(0);
  await expect
    .poll(async () => (await runSessions(pageA)).some((s) => s.id === original.id), {
      timeout: 60_000,
    })
    .toBe(false);
  const records = await pullAll(pageA);
  for (const copy of copies) {
    const documents = records.filter(
      (r) => r.kind === 'document' && !r.deleted && r.sessionId === copy.id,
    );
    expect(documents.length).toBeGreaterThan(0);
  }
  const originalDocuments = records.filter(
    (r) => r.kind === 'document' && !r.deleted && r.sessionId === original.id,
  );
  expect(originalDocuments.length).toBe(0);
  report('duplicate: original deleted, copies keep their documents', true, {
    copies: copies.length,
  });
});
