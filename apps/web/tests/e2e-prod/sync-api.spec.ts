/**
 * Production check of the call-data sync routes (ADR-0049), signed in as the end-to-end TEST
 * account (every account has account sync, ADR-0092). No Claude request. It writes invented records
 * only, under fresh random ids, and deletes every one of them at the end (deleted records keep a
 * content-free tombstone). Covers: the old status route is gone; an encrypted write and read round trip
 * (which also proves the production data key decodes to 32 bytes: otherwise every call answers 503);
 * a pull lists the change; a stale write is a conflict; Save transcript off refuses lines; deleting
 * the session takes its document and line. Prints step names and counts only, never ids or text.
 * Run: pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts sync-api.spec.ts
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PRODUCTION_URL, report, signIn, testAccount } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;

/** The session's revision after step 2 (the copy step 4 makes stale). */
let sessionRev = 0;

/** Invented ids, fresh for each run. */
const SESSION = randomUUID();
const QUIET_SESSION = randomUUID();
const DOCUMENT = randomUUID();
const LINE = `${SESSION}:e2e-call:line-1`;

/**
 * Calls a sync route from the signed-in page (its cookies), and returns status and JSON.
 *
 * @param path   The route with its query.
 * @param body   The JSON body for a POST; none for a GET.
 * @returns The status and the parsed body.
 */
function call(path: string, body?: unknown) {
  return page.evaluate(
    async ([url, data]) => {
      const response = await fetch(url as string, {
        method: data === null ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(data === null ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    },
    [path, body ?? null] as const,
  );
}

/**
 * Pushes operations.
 *
 * @param ops The operations.
 * @returns The results.
 */
async function push(ops: unknown[]) {
  const response = await call('/api/sync/push', { ops });
  expect(response.status).toBe(200);
  return response.json.results as { status: string; rev?: number; reason?: string }[];
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signIn(page, testAccount());
  await page.goto(PRODUCTION_URL);
});

test.afterAll(async () => {
  // Clean up whatever this run created, even after a failure.
  await call('/api/sync/push', {
    ops: [
      { op: 'delete', kind: 'session', id: SESSION },
      { op: 'delete', kind: 'session', id: QUIET_SESSION },
    ],
  }).catch(() => undefined);
  await page?.close();
});

test('1. no accountSync switch: GET /api/sync/status is gone (ADR-0092)', async () => {
  const status = await page.evaluate(async () => (await fetch('/api/sync/status')).status);
  expect(status).toBe(404);
  report('sync status route removed', true);
});

test('2. an encrypted write and read round trip (the data key works)', async () => {
  const results = await push([
    {
      op: 'put',
      kind: 'session',
      id: SESSION,
      baseRev: null,
      record: { id: SESSION, company: 'E2E sync check (invented)', saveTranscript: true },
    },
    {
      op: 'put',
      kind: 'document',
      id: DOCUMENT,
      sessionId: SESSION,
      baseRev: null,
      record: { id: DOCUMENT, sessionId: SESSION, name: 'invented.txt', text: 'Invented text.' },
    },
    {
      op: 'put',
      kind: 'utterance',
      id: LINE,
      sessionId: SESSION,
      baseRev: null,
      record: { id: LINE, sessionId: SESSION, speaker: 'them', text: 'Invented line.' },
    },
  ]);
  expect(results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok']);
  sessionRev = results[0]!.rev!;
  const read = await call(`/api/sync/record?kind=session&id=${SESSION}`);
  expect(read.status).toBe(200);
  expect((read.json.record as Record<string, unknown>).company).toBe('E2E sync check (invented)');
  report('encrypted round trip', true);
});

test('3. a pull lists the change', async () => {
  const since = Date.now() - 10 * 60_000;
  let after: string | null = null;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const query: string = `/api/sync/pull?since=${since}${after ? `&after=${after}` : ''}`;
    const response = await call(query);
    expect(response.status).toBe(200);
    for (const record of response.json.records as { kind: string; id: string }[]) {
      seen.add(`${record.kind}/${record.id}`);
    }
    after = response.json.next as string | null;
    if (!after) break;
  }
  expect(seen.has(`session/${SESSION}`)).toBe(true);
  expect(seen.has(`document/${DOCUMENT}`)).toBe(true);
  report('pull lists the change', true, { records: seen.size });
});

test('4. a stale write is a conflict, and Save transcript off refuses lines', async () => {
  // A write from the current revision is accepted; the same write from that old revision again
  // is stale (another device got there first), so it is a conflict.
  const record = { id: SESSION, company: 'E2E sync check (invented)', saveTranscript: true };
  const [fresh] = await push([
    { op: 'put', kind: 'session', id: SESSION, baseRev: sessionRev, record },
  ]);
  expect(fresh?.status).toBe('ok');
  const [stale] = await push([
    { op: 'put', kind: 'session', id: SESSION, baseRev: sessionRev, record },
  ]);
  expect(stale?.status).toBe('conflict');
  const [quiet, line] = await push([
    {
      op: 'put',
      kind: 'session',
      id: QUIET_SESSION,
      baseRev: null,
      record: { id: QUIET_SESSION, company: 'E2E sync check (invented)', saveTranscript: false },
    },
    {
      op: 'put',
      kind: 'utterance',
      id: `${QUIET_SESSION}:e2e-call:line-1`,
      sessionId: QUIET_SESSION,
      baseRev: null,
      record: { text: 'Invented line.' },
    },
  ]);
  expect(quiet?.status).toBe('ok');
  expect(line).toEqual({ status: 'refused', reason: 'transcript_off' });
  report('conflict and transcript-off refusal', true);
});

test('5. deleting the session takes its document and line', async () => {
  await push([{ op: 'delete', kind: 'session', id: SESSION }]);
  for (const [kind, id] of [
    ['session', SESSION],
    ['document', DOCUMENT],
    ['utterance', LINE],
  ]) {
    expect((await call(`/api/sync/record?kind=${kind}&id=${encodeURIComponent(id!)}`)).status).toBe(
      404,
    );
  }
  report('session delete cascades', true);
});
