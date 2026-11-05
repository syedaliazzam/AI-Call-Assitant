/**
 * Production check of the routes added for ADR-0029, from a signed-in browser, because Vercel's
 * network and runtime differ from a laptop: /api/job-import reads a real public job page and refuses
 * private addresses; /api/ask answers about a call; /api/prepare writes
 * a question bank. Prints numbers only. Manual run only (never in CI): 2 Claude requests with the
 * fast model and 2 with the smart model (about $0.05). Pass the page with KITE_E2E_JOB_URL, or it finds a current one on a public
 * job board.
 */
import { expect, test, type Page } from '@playwright/test';
import { PRODUCTION_URL, report, signIn, testAccount } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;

/**
 * Posts JSON from the signed-in page, so the session cookie goes with it.
 *
 * @param path The route.
 * @param body The body.
 * @returns The status and JSON reply.
 */
function post(path: string, body: unknown) {
  return page.evaluate(
    async ([url, data]) => {
      const response = await fetch(url as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    },
    [path, body] as const,
  );
}

/**
 * A current job page on a public board, so this check does not depend on one page staying up.
 *
 * @returns The page's address.
 */
async function jobUrl(): Promise<string> {
  if (process.env.KITE_E2E_JOB_URL) return process.env.KITE_E2E_JOB_URL;
  const reply = await fetch('https://boards-api.greenhouse.io/v1/boards/anthropic/jobs');
  const { jobs } = (await reply.json()) as {
    /** The board's open jobs. */
    jobs: {
      /** The job's public page. */
      absolute_url: string;
    }[];
  };
  return jobs[0]!.absolute_url;
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signIn(page, testAccount());
  await page.goto(PRODUCTION_URL);
});

test.afterAll(async () => {
  await page?.close();
});

test('job link: private addresses are refused on the server, with no Claude request', async () => {
  for (const url of [
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/',
    'https://localhost/',
    'https://[::1]/',
    'https://10.0.0.1/',
    // https only, and no other scheme.
    'http://jobs.example.com/',
    'file:///etc/passwd',
  ]) {
    const { status } = await post('/api/job-import', { url });
    expect(status, 'a refused address').toBe(422);
  }
  report('job link refuses private addresses', true);
});

test('job link: reads a real public job page', async () => {
  const { status, json } = await post('/api/job-import', { url: await jobUrl() });
  expect(status).toBe(200);
  const fields = json.fields as Record<string, string>;
  report('job link reads a public page', true, {
    company: fields.company!.length,
    role: fields.role!.length,
    description: fields.description!.length,
  });
  expect(fields.company!.length).toBeGreaterThan(0);
  expect(fields.role!.length).toBeGreaterThan(0);
  expect(fields.description!.length).toBeGreaterThan(200);
});

test('Ask AI: answers from the call', async () => {
  const request = {
    session: {
      type: 'regular',
      company: 'Alder Foods (invented)',
      role: 'Renewal',
      description: '',
      instructions: '',
      keyTerms: [],
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      documents: [],
    },
    lines: [
      { speaker: 'them', text: 'we want forty seats starting in March', at: 5 },
      { speaker: 'you', text: 'I will send the proposal by Monday', at: 12 },
    ],
    answers: [],
    notes: '',
    history: [],
  };
  const first = await post('/api/ask', { ...request, question: 'How many seats do they want?' });
  expect(first.status).toBe(200);
  const reply = String(first.json.text);
  report('Ask AI answers', true, { characters: reply.length });
  expect(reply.toLowerCase()).toMatch(/40|forty/);
});

test('Question Bank: writes grouped questions from the job description and resume', async () => {
  const { status, json } = await post('/api/prepare', {
    kind: 'question-bank',
    session: {
      type: 'interview',
      company: 'Lantern Freight (invented)',
      role: 'Data Analyst',
      description: 'Build weekly reports with SQL and explain them to the operations team.',
      instructions: '',
      keyTerms: [],
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      documents: [
        {
          name: 'resume.txt',
          text: 'Priya Rao. Data analyst, 4 years at Alder Foods. Built the weekly sales report in SQL, used by 60 people.',
        },
      ],
    },
  });
  expect(status).toBe(200);
  const groups = json.groups as {
    /** The kind of question. */
    type: string;
    /** The questions. */
    questions: {
      /** The question. */
      question: string;
      /** The suggested answer. */
      answer: string;
    }[];
  }[];
  const questions = groups.flatMap((group) => group.questions);
  report('question bank written', true, { groups: groups.length, questions: questions.length });
  expect(questions.length).toBeGreaterThan(2);
  expect(questions.length).toBeLessThanOrEqual(12);
  expect(questions.every((item) => item.answer.trim() !== '')).toBe(true);
});
