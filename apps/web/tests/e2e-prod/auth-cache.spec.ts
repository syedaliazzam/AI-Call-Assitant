/**
 * Production check of the 60-second session cookie cache (day-05-overlay-screenshots-notes.md
 * Stage 0), as the test account: signs in with Playwright's Chromium, then sends typed Chat
 * answers on an invented, document-free session straight to /api/answer from the signed-in
 * page (so the browser's cookie jar is used, as in the app). Answer 1 and answer 2 come within
 * 60 s; answer 3 comes after a 65-second wait, when the cached cookie has expired, so the
 * server reads the database and must send a fresh session cookie back; answer 4 follows at
 * once and should be cached again. Prints the server's sign-in time (serverMs.auth) and whether
 * a session cookie came back, numbers only. Manual run only (never in CI).
 */
import { chromium, expect, test } from '@playwright/test';
import { report, signIn, testAccount } from './helpers';

/** An invented, minimal session (no documents). */
const SESSION = {
  type: 'regular',
  company: 'Invented Co (auth cache check)',
  role: 'Test',
  description: '',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [],
};

/** The part of the done event read here. */
interface DoneEvent {
  /** Server timings. */
  ms: {
    /** Request received → session known, in ms. */
    auth: number;
  };
}

/** What one answer reported. */
interface AuthSample {
  /** HTTP status. */
  status: number;
  /** serverMs.auth from the done event, or -1. */
  authMs: number;
  /** 1 when the response sent a session_data cookie back, else 0. */
  cookieBack: number;
}

test('session cookie cache: answers 1, 2, 3 (after > 60 s) and 4', async () => {
  test.setTimeout(240_000);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    // Fresh: this test measures the cookie cache that sign-in sets.
    await signIn(page, testAccount(), true);

    /**
     * Sends one Chat answer from the page (the browser's own cookies) and reads its timings.
     *
     * @returns The sample.
     */
    const ask = async (): Promise<AuthSample> =>
      page.evaluate(async (session) => {
        const response = await fetch('/api/answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'chat', session, question: 'Say hello in five words.' }),
        });
        const text = await response.text();
        const done = /event: done\ndata: (.+)\n/.exec(text)?.[1];
        const authMs = done ? (JSON.parse(done) as DoneEvent).ms.auth : -1;
        // The cookies are HttpOnly, so the page cannot read them; the test reads the header
        // through Playwright below instead. Here only the status and timing.
        return { status: response.status, authMs, cookieBack: 0 };
      }, SESSION);

    /**
     * Sends one answer and also records whether the response set a session_data cookie.
     *
     * @param label Which answer, for the report.
     * @returns The sample.
     */
    const measured = async (label: string): Promise<AuthSample> => {
      const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/answer'));
      const sample = await ask();
      const response = await responsePromise;
      const setCookie = (await response.headersArray())
        .filter((h) => h.name.toLowerCase() === 'set-cookie')
        .map((h) => h.value)
        .join('\n');
      sample.cookieBack = /session_data=/.test(setCookie) ? 1 : 0;
      report(`auth cache ${label}`, sample.status === 200 && sample.authMs >= 0, { ...sample });
      return sample;
    };

    const first = await measured('answer 1');
    const second = await measured('answer 2');
    await page.waitForTimeout(65_000);
    const third = await measured('answer 3 (after 65 s)');
    const fourth = await measured('answer 4');

    for (const sample of [first, second, third, fourth]) expect(sample.status).toBe(200);
    // After the cache expired, the fresh cookie must come back, or every later answer would
    // read the database again.
    expect(third.cookieBack).toBe(1);
  } finally {
    await browser.close();
  }
});
