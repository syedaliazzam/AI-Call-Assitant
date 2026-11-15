/**
 * File: apps/web/tests/lib/sign-in.ts
 * Purpose: The one sign-in used by the browser test suites that run against a real Kite
 *          (production e2e, UI screenshot checks):
 *          - signs in once per account per test run and reuses the session cookies (kept in
 *            memory only, never written to disk), so production's sign-in rate limit cannot
 *            fail a run that opens several pages;
 *          - never leaves a password where Playwright records it: when a sign-in fails, the
 *            password field is cleared before the error, so the failure's page snapshot
 *            (error-context.md) cannot contain it, and the error names only the email.
 * Used by: tests/e2e-prod/helpers.ts (signIn), tests/ui/shots.ts (signIn),
 *          tests/ui/keyboard.spec.ts (clearPasswordOnFailure)
 * Depends on: @playwright/test
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing)
 */
import { expect, type Cookie, type Page } from '@playwright/test';

/** Who to sign in as, and where. */
export interface SignInOptions {
  /** The Kite address, without a trailing slash. */
  baseUrl: string;
  /** The account's email. */
  email: string;
  /** The account's password (never logged, never left in a field after a failure). */
  password: string;
  /** True to always sign in with the form (tests of sign-in itself, or a separate app). */
  fresh?: boolean;
  /** How long to wait for the dashboard, ms (default 30 s). */
  timeout?: number;
  /** True on the desktop app's home panel, which comes back to itself instead of the dashboard. */
  panel?: boolean;
}

/** Session cookies by "address|email", for this test run only (in memory). */
const sessions = new Map<string, Cookie[]>();

/**
 * Runs a sign-in step; when it fails, empties the password field before rethrowing, so the
 * failure snapshot shows no password.
 *
 * @param page  The page with the sign-in form.
 * @param email The account's email (the only account detail an error may name).
 * @param step  The sign-in step (typing, submitting and waiting for the dashboard).
 * @returns Nothing.
 * @throws Error('Sign-in failed for <email>…') naming only what went wrong, never the password.
 * Called from: signInOnce(), tests/ui/keyboard.spec.ts
 */
export async function clearPasswordOnFailure(
  page: Page,
  email: string,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    // Best effort: the page may have moved on or closed.
    await page
      .getByLabel('Password', { exact: true })
      .fill('', { timeout: 2_000 })
      .catch(() => undefined);
    const alert = await page
      .getByRole('alert')
      .filter({ hasText: /\S/ })
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    const reason = error instanceof Error ? error.message.split('\n')[0] : 'unknown';
    throw new Error(
      `Sign-in failed for ${email} at ${new URL(page.url()).pathname}${alert ? ` ("${alert.trim()}")` : ''}: ${reason}`,
    );
  }
}

/**
 * Closes the one-time acceptable-use notice (v1.1.0), which covers the page on a new device. A site from
 * before 1.1.0 has none, and this returns after a moment.
 *
 * @param page The signed-in page.
 * @returns True when the notice was showing.
 * Called from: tests/e2e-prod/helpers.ts signIn(), tests/ui/shots.ts signIn()
 */
export async function closeUseNotice(page: Page): Promise<boolean> {
  const button = page.getByRole('dialog', { name: 'Using Paramount AI' }).getByRole('button', {
    name: 'Got it',
  });
  return button.click({ timeout: 4_000 }).then(
    () => true,
    () => false,
  );
}

/**
 * Signs in and waits for the dashboard, reusing this run's session for the account when
 * there is one (unless `fresh`).
 *
 * @param page    The page (its browser context receives the session cookies).
 * @param options See SignInOptions.
 * @returns Nothing.
 * @throws Error('Sign-in failed for <email>…') when the dashboard does not appear.
 * Called from: tests/e2e-prod/helpers.ts signIn(), tests/ui/shots.ts signIn()
 */
export async function signInOnce(page: Page, options: SignInOptions): Promise<void> {
  const { baseUrl, email, password, fresh = false, timeout = 30_000, panel = false } = options;
  const key = `${baseUrl}|${email}`;
  // The panel is ready when it shows its search box, or, as the launcher of an account with account
  // sync (ADR-0051), its Open dashboard button.
  const dashboard = panel
    ? page.getByLabel('Search sessions').or(page.getByRole('button', { name: /Open dashboard/ }))
    : page.getByRole('heading', { name: 'Call Sessions' });

  const saved = sessions.get(key);
  if (!fresh && saved) {
    await page.context().addCookies(saved);
    await page.goto(`${baseUrl}/`);
    const reused = await dashboard.waitFor({ state: 'visible', timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    if (reused) return;
    // The session ended (for example the account was disabled): sign in again below.
  }

  // The panel has already gone to the sign-in page by itself.
  if (!panel) await page.goto(`${baseUrl}/login`);
  await clearPasswordOnFailure(page, email, async () => {
    await page.getByLabel('Email').fill(email);
    // Exact: the show/hide button beside the field is labelled "Show password", which a loose
    // match also finds, and Playwright then refuses to fill two elements.
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(dashboard).toBeVisible({ timeout });
  });
  sessions.set(key, await page.context().cookies());
}
