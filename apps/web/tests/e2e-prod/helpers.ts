/**
 * File: apps/web/tests/e2e-prod/helpers.ts
 * Purpose: Test helper (not a test) for the production end-to-end suites: the production URL,
 *          the test account's credentials (read from apps/web/.env.local, never printed), the
 *          invented document, sign-in, session creation through the wizard, reading the token
 *          counts of a warm-up or answer from its /api/answer response, asking for an answer
 *          (Answer hotkey or a typed Chat question) and rating it (Day 4), and a step log that
 *          prints only pass/fail and numbers.
 * Used by: tests/e2e-prod/chrome.spec.ts, tests/e2e-prod/desktop.spec.ts,
 *          tests/e2e-prod/latency.spec.ts
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
import { closeUseNotice, signInOnce } from '../lib/sign-in';
import { pickOption } from '../lib/pick-option';

/**
 * The site the suites run against: production, or KITE_E2E_URL to check a preview deployment (or a
 * local `pnpm dev`) with the same steps before it is promoted (v1.0.0 release, 3 Nov 2026).
 */
export const PRODUCTION_URL = (
  process.env.KITE_E2E_URL ?? 'https://kite-call-assistant.vercel.app'
).replace(/\/+$/, '');

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
 * Reads a test account's two lines from apps/web/.env.local: KITE_E2E_EMAIL and
 * KITE_E2E_PASSWORD (role user), or with 'admin' KITE_E2E_ADMIN_EMAIL and
 * KITE_E2E_ADMIN_PASSWORD (role admin, for /dev/latency). Only those two lines are read, so no
 * other secret reaches the browser or the desktop app's environment.
 *
 * @param kind 'user' (default) or 'admin'.
 * @returns The credentials.
 * @throws Error naming the missing variable (never a value) when a line is missing.
 * Called from: chrome.spec.ts, desktop.spec.ts, latency.spec.ts
 */
export function testAccount(kind: 'user' | 'admin' = 'user'): TestAccount {
  const prefix = kind === 'admin' ? 'KITE_E2E_ADMIN' : 'KITE_E2E';
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
  return { email: read(`${prefix}_EMAIL`), password: read(`${prefix}_PASSWORD`) };
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
 * Signs in on /login and waits for the dashboard. Reuses this run's session for the account
 * (one sign-in per run, so production's sign-in rate limit cannot fail a run); a failed
 * sign-in leaves no password on the page (tests/lib/sign-in.ts).
 *
 * @param page    The page.
 * @param account The test account.
 * @param fresh   True to always sign in with the form (the sign-in cache test; the desktop app).
 * @param panel   True on the desktop app's home panel.
 * @returns Nothing.
 * Called from: the suites
 */
export async function signIn(
  page: Page,
  account: TestAccount,
  fresh = false,
  panel = false,
): Promise<void> {
  await signInOnce(page, { baseUrl: PRODUCTION_URL, ...account, fresh, panel });
  // On the panel the suite looks at the notice itself.
  if (!panel) await closeUseNotice(page);
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
 * Creates a Regular session through the Create session wizard and waits for its card.
 *
 * @param page    The page (signed in).
 * @param session What to fill in.
 * Called from: the suites
 */
export async function createSession(page: Page, session: NewSession): Promise<void> {
  await page.goto(`${PRODUCTION_URL}/sessions/new`);
  await pickOption(page, page.getByLabel('Session type'), 'Regular');
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
  return isMode(response, 'warm');
}

/**
 * Whether a response is POST /api/answer with a given mode.
 *
 * @param response A network response.
 * @param mode     'warm', 'answer' or 'chat'.
 * @returns True when it matches.
 * Called from: isWarmUp(), answerAndRate()
 */
export function isMode(response: Response, mode: string): boolean {
  if (!response.url().endsWith('/api/answer') || response.request().method() !== 'POST') {
    return false;
  }
  try {
    return (response.request().postDataJSON() as { mode?: string }).mode === mode;
  } catch {
    return false;
  }
}

/**
 * Reads the token counts from a warm-up or answer response (its server-sent `done` event).
 *
 * @param response The response.
 * @returns The usage, or null when the response held no `done` event.
 * Called from: the suites, answerAndRate()
 */
export async function warmUsage(response: Response): Promise<AnswerUsage | null> {
  const body = await response.text();
  const data = /event: done\ndata: (.+)\n/.exec(body)?.[1];
  return data ? (JSON.parse(data) as { usage: AnswerUsage }).usage : null;
}

/** What answerAndRate() measured (numbers only). */
export interface AnswerCheck {
  /** Words in the headline that streamed in. */
  headlineWords: number;
  /** Bullets shown. */
  bullets: number;
  /** Key press → first word, from the panel ("First word in X s"), in ms. */
  firstWordMs: number;
  /** Cache tokens read by the answer. */
  cacheRead: number;
  /** Cache tokens written by the answer. */
  cacheWrite: number;
}

/**
 * Asks for an answer on the live view and rates it 👍: the Answer hotkey (Ctrl+Enter, as in
 * the browser) or a typed Chat question, then waits for the headline to stream in and the
 * answer to finish, and checks the rating is shown as pressed.
 *
 * @param page  The live view.
 * @param how   'hotkey' (Answer from the transcript) or 'chat' (a typed, invented question).
 * @returns The measured numbers.
 * Called from: chrome.spec.ts, desktop.spec.ts
 */
export async function answerAndRate(page: Page, how: 'hotkey' | 'chat'): Promise<AnswerCheck> {
  const mode = how === 'hotkey' ? 'answer' : 'chat';
  const response = page.waitForResponse((r) => isMode(r, mode), { timeout: 60_000 });
  if (how === 'hotkey') {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+Enter');
  } else {
    // The browser's call view has no Chat button: its message box is always there.
    const chat = page.getByRole('button', { name: 'Chat' });
    if ((await chat.count()) > 0) await chat.click();
    const box = page.getByLabel('Type a question');
    await box.fill('How much planning time did the pilot save per dispatcher?');
    await box.press('Enter');
  }
  // The selected card: the answer just asked for (v1.0.4, ADR-0040).
  const headline = page
    .locator('article[aria-current="true"]')
    .getByRole('heading', { name: 'Answer line' });
  // The answer line shows "…" until the first words arrive.
  await expect(headline).not.toContainText('…', { timeout: 30_000 });
  const good = page.getByRole('button', { name: 'Good answer' });
  // The rating buttons appear when the answer is complete.
  await expect(good).toBeVisible({ timeout: 60_000 });
  const usage = await warmUsage(await response);
  await good.click();
  await expect(good).toHaveAttribute('aria-pressed', 'true');
  const firstWord = (await page.getByLabel('Time to first word').textContent()) ?? '';
  return {
    headlineWords: ((await headline.textContent()) ?? '').trim().split(/\s+/).length,
    bullets: await page.getByRole('list', { name: 'Answer details' }).getByRole('listitem').count(),
    firstWordMs: Math.round(Number(/([\d.]+) s/.exec(firstWord)?.[1] ?? NaN) * 1000),
    cacheRead: usage?.cache_read_input_tokens ?? -1,
    cacheWrite: usage?.cache_creation_input_tokens ?? -1,
  };
}
