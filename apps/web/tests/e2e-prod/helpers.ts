/**
 * File: apps/web/tests/e2e-prod/helpers.ts
 * Purpose: Test helper (not a test) for the production end-to-end suites: the production URL,
 *          the test account's credentials (read from apps/web/.env.local, never printed), the
 *          invented document, sign-in, session creation through the wizard, reading the
 *          warm-up's token counts from the /api/answer response, and a step log that prints
 *          only pass/fail and numbers.
 * Used by: tests/e2e-prod/chrome.spec.ts, tests/e2e-prod/desktop.spec.ts
 * Depends on: @playwright/test
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing); README "Production
 *               end-to-end suites"
 *
 * Nothing here logs session, document or transcript text, or the password.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Response } from '@playwright/test';
import type { AnswerUsage } from '@kite/shared';

/** The production site the suites run against. */
export const PRODUCTION_URL = 'https://kite-call-assistant.vercel.app';

/** apps/web (this file is in apps/web/tests/e2e-prod; the package is an ES module). */
export const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The official LibriSpeech test recordings (tests/fixtures/audio/SOURCES.md). */
export const RECORDINGS = {
  /** Played as the fake microphone ("You"). */
  you: path.join(WEB_DIR, 'tests', 'fixtures', 'audio', '0.wav'),
  /** Played in the fake shared tab ("Them"). */
  them: path.join(WEB_DIR, 'tests', 'fixtures', 'audio', '1.wav'),
};

/** The test account (see scripts/create-e2e-user.ts). */
export interface TestAccount {
  /** Its email. */
  email: string;
  /** Its password (never printed). */
  password: string;
}

/**
 * Reads KITE_E2E_EMAIL and KITE_E2E_PASSWORD from apps/web/.env.local. Only these two lines
 * are read, so no other secret reaches the browser or the desktop app's environment.
 *
 * @returns The credentials.
 * @throws Error naming the missing variable (never a value) when a line is missing.
 * Called from: chrome.spec.ts, desktop.spec.ts (beforeAll)
 */
export function testAccount(): TestAccount {
  const text = readFileSync(path.join(WEB_DIR, '.env.local'), 'utf8');
  /**
   * One value from the file.
   *
   * @param name Variable name.
   * @returns Its value.
   */
  const read = (name: string): string => {
    const value = new RegExp(`^${name}=(.+)$`, 'm').exec(text)?.[1]?.trim();
    if (!value) throw new Error(`${name} is missing from apps/web/.env.local (create-e2e-user)`);
    return value;
  };
  return { email: read('KITE_E2E_EMAIL'), password: read('KITE_E2E_PASSWORD') };
}

/**
 * Prints one step result: its name, PASS or FAIL, and numbers only.
 *
 * @param step    Step name.
 * @param pass    Whether it passed.
 * @param numbers Counts or timings to show (no text from the session).
 * Called from: the suites
 */
export function report(step: string, pass: boolean, numbers: Record<string, number> = {}) {
  const detail = Object.entries(numbers)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ');
  console.log(`[e2e] ${pass ? 'PASS' : 'FAIL'} ${step}${detail ? ` (${detail})` : ''}`);
}

/** A file to attach in the wizard (the shape setInputFiles() takes). */
export interface TextFile {
  /** File name shown in the wizard. */
  name: string;
  /** Media type, for example 'text/plain'. */
  mimeType: string;
  /** File contents. */
  buffer: Buffer;
}

/**
 * An invented, roughly one-page plain-text document (about 450 words), large enough that the
 * session prompt passes the 512-token caching minimum.
 *
 * @returns The file for setInputFiles().
 * Called from: chrome.spec.ts
 */
export function inventedDocument(): TextFile {
  const paragraph = [
    'This invented pilot summary describes a twelve-week trial of route planning software at four depots.',
    'Dispatchers planned routes each morning and adjusted them twice a day when traffic changed.',
    'Average planning time fell from forty minutes to eighteen minutes per dispatcher per day.',
    'Late deliveries dropped by about a third after live re-routing was switched on.',
    'The operations team asked for single sign-on before a wider rollout could begin.',
    'Training ran in small groups with one practice day before each depot went live.',
    'The finance lead preferred yearly billing and a fixed price for a two-year term.',
  ].join(' ');
  const text = Array.from({ length: 5 }, (_, i) => `Part ${i + 1}. ${paragraph}`).join('\n\n');
  return { name: 'pilot-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') };
}

/**
 * Signs in on /login and waits for the dashboard.
 *
 * @param page    The page.
 * @param account The test account.
 * Called from: the suites
 */
export async function signIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto(`${PRODUCTION_URL}/login`);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible({
    timeout: 30_000,
  });
}

/** Details of a session created through the wizard. */
export interface NewSession {
  /** Company (unique per run, so the card can be found). */
  company: string;
  /** Key terms, one per entry. */
  keyTerms: string[];
  /** Document to attach, or none. */
  document?: TextFile;
}

/**
 * Creates a Sales session through the Create session wizard and waits for its card.
 *
 * @param page    The page (signed in).
 * @param session What to fill in.
 * Called from: the suites
 */
export async function createSession(page: Page, session: NewSession): Promise<void> {
  await page.goto(`${PRODUCTION_URL}/sessions/new`);
  await page.getByLabel('Session type').selectOption('sales');
  await page.getByLabel('Company').fill(session.company);
  await page.getByLabel('Topic').fill('Pilot review');
  if (session.document) {
    await page.locator('input[type="file"]').setInputFiles(session.document);
    await expect(page.getByText(session.document.name)).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Key terms (optional)').fill(session.keyTerms.join('\n'));
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(sessionCard(page, session.company)).toBeVisible({ timeout: 30_000 });
}

/**
 * The dashboard card of a session.
 *
 * @param page    The page.
 * @param company The session's company.
 * @returns The card locator.
 * Called from: createSession(), the suites
 */
export function sessionCard(page: Page, company: string) {
  return page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: company }) });
}

/**
 * Whether a response is the live page's warm-up (POST /api/answer with mode 'warm').
 *
 * @param response A network response.
 * @returns True for a warm-up response.
 * Called from: the suites (page.waitForResponse)
 */
export function isWarmUp(response: Response): boolean {
  if (!response.url().endsWith('/api/answer') || response.request().method() !== 'POST') {
    return false;
  }
  try {
    return (response.request().postDataJSON() as { mode?: string }).mode === 'warm';
  } catch {
    return false;
  }
}

/**
 * Reads the token counts from a warm-up response (its server-sent `done` event).
 *
 * @param response The warm-up response.
 * @returns The usage, or null when the response held no `done` event.
 * Called from: the suites
 */
export async function warmUsage(response: Response): Promise<AnswerUsage | null> {
  const body = await response.text();
  const data = /event: done\ndata: (.+)\n/.exec(body)?.[1];
  return data ? (JSON.parse(data) as { usage: AnswerUsage }).usage : null;
}
