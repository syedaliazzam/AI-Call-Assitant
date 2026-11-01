/**
 * Screenshots of the light pages (UI theme stage U2) at 1440, 900 and 390 px (the 390 px run as
 * a touch phone): sign-in, change password, the empty dashboard, the wizard (Details with a
 * document attached, then Preferences), the dashboard with a session, the Choose platform
 * dialog, the session review (an invented ended session seeded into this browser's IndexedDB),
 * Settings and Users. Each page is checked (shots.ts): no sideways scroll, touch targets
 * ≥ 44 px on the phone, no console errors. Signed in as the admin test account, enabled only
 * for the run. Never opens /live, so no Claude call is made (the live page would warm up).
 * All session content is invented.
 */
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { BASE_URL, WIDTHS, check, openAt, signIn } from './shots';

let browser: Browser | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
});

/** The invented session created through the wizard. */
const COMPANY = 'Northwind Logistics (invented)';

/**
 * Seeds an invented ended call into a session, straight into this browser's IndexedDB (the
 * app's "kite" database): status ended, six transcript lines, two rated answers, notes with a
 * proposed lesson.
 *
 * @param page      The page (on the app's origin, after the database exists).
 * @param sessionId The session.
 */
async function seedEndedCall(page: Page, sessionId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const start = new Date(2026, 9, 28, 14, 0, 0).getTime();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kite');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['sessions', 'utterances', 'answers', 'notes'], 'readwrite');
    const sessions = tx.objectStore('sessions');
    const session = await new Promise<Record<string, unknown>>((resolve) => {
      const get = sessions.get(id);
      get.onsuccess = () => resolve(get.result as Record<string, unknown>);
    });
    sessions.put({ ...session, status: 'ended', lastActiveAt: start + 200_000 });
    const lines: ['you' | 'them', string, number][] = [
      ['you', 'THANKS FOR JOINING LET US TALK ABOUT THE RENEWAL', 5],
      ['them', 'WE WANT TO MOVE ABOUT FORTY SEATS TO PROFESSIONAL', 12],
      ['them', 'WHAT WOULD THAT COST', 24],
      ['you', 'FIFTY TWO DOLLARS PER SEAT PER MONTH BILLED YEARLY', 40],
      ['them', 'OKAY SEND ME A PROPOSAL AND I WILL TAKE IT TO FINANCE', 95],
      ['you', 'I WILL SEND THE PROPOSAL BY MONDAY', 103],
    ];
    lines.forEach(([speaker, text, at], i) =>
      tx.objectStore('utterances').put({
        id: `${id}-l${i}`,
        sessionId: id,
        speaker,
        text,
        tStart: start + at * 1_000,
        tEnd: start + at * 1_000 + 2_000,
      }),
    );
    const answer = (
      n: number,
      mode: string,
      question: string,
      text: string,
      at: number,
      rating: string,
      note: string,
    ) =>
      tx.objectStore('answers').put({
        id: `${id}-a${n}`,
        sessionId: id,
        mode,
        question,
        text,
        model: 'fast',
        msFirstToken: 700,
        msTotal: 1_400,
        createdAt: start + at * 1_000,
        rating,
        note,
      });
    answer(
      1,
      'answer',
      'What would forty seats on Professional cost?',
      '52 dollars per seat per month.\n- Billed yearly',
      26,
      'down',
      'Give the monthly and yearly totals for 40 seats.',
    );
    answer(
      2,
      'chat',
      'When does onboarding start?',
      'Onboarding starts the week after signing.\n- Two sessions',
      60,
      'up',
      '',
    );
    tx.objectStore('notes').put({
      sessionId: id,
      callStartedAt: start,
      createdAt: start + 200_000,
      fromAnswersOnly: false,
      notes: {
        summary: [
          'Northwind wants to move about 40 seats to the Professional plan.',
          'Price given: 52 dollars per seat per month, billed yearly.',
        ],
        questions: [
          { question: 'What would 40 seats cost?', at: 24, answered: 'partly', rating: 'down' },
        ],
        nextSteps: [
          { step: 'Send the proposal by Monday', owner: 'You' },
          { step: 'Take the proposal to finance', owner: 'Them' },
        ],
        unclear: [{ from: 60, to: 84, reason: 'Garbled audio' }],
        lessons: [
          {
            text: 'Give monthly and yearly totals for the seat count they mention.',
            evidence: 'The 40-seat price answer was rated down with that note.',
          },
        ],
      },
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, sessionId);
}

for (const size of WIDTHS) {
  test(`light pages at ${size.width} px`, async () => {
    const watched = await openAt(browser!, size);
    const { page } = watched;

    // Sign-in (signed out).
    await page.goto(`${BASE_URL}/login`);
    await expect(page.getByRole('heading', { name: 'Sign in to Kite' })).toBeVisible();
    await check(watched, size, 'sign-in');

    await signIn(page);
    // Empty dashboard (this browser context has no sessions yet).
    await expect(page.getByText('No sessions yet')).toBeVisible();
    await check(watched, size, 'dashboard-empty');

    // Change password (also reachable when signed in); nothing is submitted.
    await page.goto(`${BASE_URL}/change-password`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check(watched, size, 'change-password');

    // The wizard, with an invented document attached.
    await page.goto(`${BASE_URL}/sessions/new`);
    await page.getByLabel('Session type').selectOption('sales');
    await page.getByLabel('Company').fill(COMPANY);
    await page.getByLabel('Topic').fill('Renewal call');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'price-list.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'Professional plan: 52 dollars per seat per month, billed yearly (invented).',
      ),
    });
    await expect(page.getByText('price-list.txt')).toBeVisible();
    await check(watched, size, 'wizard-details');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByLabel('Key terms (optional)')).toBeVisible();
    await check(watched, size, 'wizard-preferences');
    await page.getByRole('button', { name: 'Create session' }).click();

    // Dashboard with the session, and the Choose platform dialog (never opened further).
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: COMPANY }) });
    await expect(card).toBeVisible();
    await check(watched, size, 'dashboard');
    await card.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await check(watched, size, 'choose-platform');
    await page.keyboard.press('Escape');

    // The session review, on an invented ended call.
    const href = await card.getByRole('link', { name: 'Edit' }).getAttribute('href');
    const sessionId = href!.split('/')[2]!;
    await seedEndedCall(page, sessionId);
    await page.goto(`${BASE_URL}/sessions/${sessionId}`);
    await expect(page.getByRole('heading', { name: COMPANY })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Saved answer' })).toHaveCount(2);
    await check(watched, size, 'review');

    await page.goto(`${BASE_URL}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('No lessons yet.')).toBeVisible();
    await check(watched, size, 'settings');

    await page.goto(`${BASE_URL}/admin/users`);
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    // Real accounts never go in a screenshot: every row's name and email is replaced, in this
    // test browser only, with invented sample users (nothing changes in the database). Only
    // after React has hydrated the table, or React would report the edit as a mismatch.
    await page.waitForFunction(() => {
      const tbody = document.querySelector('tbody');
      return !!tbody && Object.keys(tbody).some((key) => key.startsWith('__reactFiber'));
    });
    const rows = await page.evaluate(() => {
      const samples: [string, string][] = [
        ['Sample Admin', 'sample.admin@example.com'],
        ['Sample User', 'sample.user@example.com'],
        ['Sample Analyst', 'sample.analyst@example.com'],
      ];
      const trs = [...document.querySelectorAll('tbody tr')];
      trs.forEach((tr, i) => {
        const [name, email] = samples[i % samples.length]!;
        const cells = tr.querySelectorAll('td');
        const nameText = [...cells[0]!.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
        if (nameText) nameText.textContent = `${name} `;
        cells[1]!.textContent = email;
      });
      return trs.length;
    });
    expect(rows).toBeGreaterThan(0);
    await expect(page.locator('tbody')).not.toContainText('@gmail.com');
    await check(watched, size, 'admin-users');

    await watched.context.close();
  });
}
