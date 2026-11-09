/**
 * Production check of the speech model shipped in the desktop installer (v1.3.1, ADR-0059): the real
 * packaged program (KITE_SHELL_EXE: Paramount AI.exe from release/win-unpacked, or extracted from the
 * installer; never installed on this computer), a fresh temporary profile, and Hugging Face made
 * unreachable for the whole run (Chromium's host-resolver rules), so the model cannot be downloaded.
 * Signed in as the end-to-end TEST account (listed in KITE_SYNC_USERS). No Claude request.
 * 1. Every file the web app's engine fetches, fetched at its usual address from the page, comes back
 *    from the bundle with the pinned SHA-256 (and a plain Hugging Face address fails: it really is
 *    unreachable).
 * 2. An invented session (through the sync API) → Start free → Connect: never a "Speech model needed"
 *    dialog; the call bars appear; Exit ends the call. The session is deleted at the end.
 * Prints step names and numbers only. "Them" is this computer's real sound; no screenshots.
 * Run: KITE_SHELL_EXE=<…\Paramount AI.exe> pnpm --filter web exec playwright test
 *      -c tests/e2e-prod/playwright.config.ts bundled-model.spec.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { speechModelFiles } from '@/core/stt/modelCache';
import { pickModelSource } from '@/core/stt/models';
import { PRODUCTION_URL, report, signIn, testAccount } from './helpers';

/** A fresh desktop profile for this run. */
const PROFILE_DIR = mkdtempSync(path.join(tmpdir(), 'kite-e2e-bundle-'));

/** This run's invented session. */
const SESSION = { id: randomUUID(), company: `E2E Bundle ${Date.now().toString(36)}` };

/** Hugging Face's hosts, unreachable for the run: a download attempt fails instead of succeeding. */
const BLOCK_HF =
  '--host-resolver-rules=MAP huggingface.co ~NOTFOUND, MAP *.huggingface.co ~NOTFOUND, MAP *.hf.co ~NOTFOUND';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let panel: Page;

/**
 * Sends sync operations from the signed-in panel.
 *
 * @param ops The operations.
 * @returns The HTTP status.
 */
function push(ops: unknown[]): Promise<number> {
  return panel.evaluate(async (body) => {
    const response = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: body }),
    });
    return response.status;
  }, ops);
}

test.beforeAll(async () => {
  const exe = process.env.KITE_SHELL_EXE;
  test.skip(!exe, 'KITE_SHELL_EXE must name the packaged 1.3.1 program');
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  app = await electron.launch({
    executablePath: exe!,
    args: [`--user-data-dir=${PROFILE_DIR}`, BLOCK_HF],
    // It opens this run's production address and must not update itself here.
    env: { ...env, KITE_URL: `${PRODUCTION_URL}/`, KITE_NO_UPDATE_CHECK: '1' },
  });
  panel = await app.firstWindow();
  await signIn(panel, testAccount(), true, true);
  await panel
    .getByRole('dialog', { name: 'Using Paramount AI' })
    .getByRole('button', { name: 'Got it' })
    .click({ timeout: 10_000 })
    .catch(() => undefined);
});

test.afterAll(async () => {
  if (panel) {
    await push([{ op: 'delete', kind: 'session', id: SESSION.id }]).catch(() => undefined);
  }
  await app?.close().catch(() => undefined);
  rmSync(PROFILE_DIR, { recursive: true, force: true });
});

test('1. every model file comes from the bundle, with its pinned SHA-256, with Hugging Face unreachable', async () => {
  const files = speechModelFiles(PRODUCTION_URL, pickModelSource(undefined, 'production'));
  const started = Date.now();
  const results = await panel.evaluate(async (list) => {
    const hex = (buffer: ArrayBuffer) =>
      [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const out: { ok: boolean; bytes: number }[] = [];
    for (const file of list) {
      const response = await fetch(file.url);
      const body = await response.arrayBuffer();
      out.push({
        ok: response.ok && hex(await crypto.subtle.digest('SHA-256', body)) === file.sha256,
        bytes: body.byteLength,
      });
    }
    let blocked = false;
    try {
      await fetch('https://huggingface.co/robots.txt');
    } catch {
      blocked = true;
    }
    return { out, blocked };
  }, files);
  expect(results.blocked).toBe(true);
  expect(results.out.every((file) => file.ok)).toBe(true);
  report('bundle: every file matches its SHA-256 with Hugging Face unreachable', true, {
    files: results.out.length,
    megabytes: Math.round(results.out.reduce((sum, file) => sum + file.bytes, 0) / 1e6),
    seconds: Math.round((Date.now() - started) / 1000),
  });
});

test('2. first Connect on a fresh profile: no download dialog, the call starts, Exit ends it', async () => {
  const now = Date.now();
  expect(
    await push([
      {
        op: 'put',
        kind: 'session',
        id: SESSION.id,
        baseRev: null,
        record: {
          id: SESSION.id,
          type: 'regular',
          company: SESSION.company,
          role: 'Bundle check',
          description: 'Invented session for the bundled model check.',
          preferences: {
            language: 'en',
            model: 'fast',
            style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
            keyTerms: '',
          },
          instructions: '',
          saveTranscript: false,
          autoAnswer: false,
          createdAt: now,
          status: 'not-started',
          lastActiveAt: null,
        },
      },
    ]),
  ).toBe(200);
  await expect
    .poll(
      async () => {
        await panel.evaluate(() => window.dispatchEvent(new Event('focus')));
        await panel.waitForTimeout(1_500);
        return (await panel.getByRole('list', { name: 'Sessions' }).allTextContents()).join(' ');
      },
      { timeout: 60_000 },
    )
    .toContain(SESSION.company);
  await panel
    .getByRole('list', { name: 'Sessions' })
    .getByRole('button', { name: new RegExp(SESSION.company) })
    .click();
  await panel.getByRole('button', { name: 'Start free' }).click();
  await expect(panel.getByRole('heading', { name: 'Connect Call Session' })).toBeVisible();

  const findOverlay = () => app.windows().find((window) => window.url().includes('/compact/'));
  const started = Date.now();
  await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  let sawDialog = false;
  await expect
    .poll(
      async () => {
        if ((await panel.getByText('Speech model needed').count()) > 0) sawDialog = true;
        return findOverlay() !== undefined;
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  expect(sawDialog).toBe(false);
  const overlay = findOverlay()!;
  await overlay.waitForLoadState();
  await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  report('first connect: no dialog, call bars shown, Hugging Face unreachable', true, {
    seconds: Math.round((Date.now() - started) / 1000),
  });

  const closed = overlay.waitForEvent('close', { timeout: 15_000 });
  await overlay.getByRole('button', { name: /end call/i }).click();
  await closed;
  report('exit: the call ended', true);
});
