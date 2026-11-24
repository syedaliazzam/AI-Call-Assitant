/**
 * Tests for apps/web/src/core/documents/summary.ts (ADR-0067), with fetch and storage faked:
 * - the summary covers every document but the CV, in prompt order; the fingerprint changes when a
 *   name or text changes;
 * - no other documents: '' and no request; a kept summary with a matching fingerprint is reused (on
 *   the session, in this page, or stored by another page) and a changed set is summarised again;
 * - a new summary is asked for once (two callers share the request), sent without the CV, kept on
 *   the session, and logged without text; a failure gives null, never an error;
 * - the smart session details hold only the CV and the summary ('' when none);
 * - ADR-0116: a server failure is remembered by fingerprint and the same documents are not asked for
 *   again until a growing wait ends (2 min, 10 min, 1 h, 6 h); a success forgets it; sign-in and
 *   network failures are not remembered; documentsSummaryStatus() reports 'unavailable' with the
 *   retry time.
 * All text is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUMMARY_RETRY_DELAYS_MS,
  documentsFingerprint,
  documentsSummaryStatus,
  ensureDocumentsSummary,
  remembersSummaryFailure,
  resetSummaryMemory,
  smartSessionContext,
  summarisedDocuments,
  summaryRetryDelay,
  withDocumentsSummary,
  type SummaryFailureStore,
} from '@/core/documents/summary';
import type {
  Session,
  StoredDocument,
  StoredDocumentsSummary,
  StoredSummaryFailure,
} from '@/core/storage/types';

/** An invented session. */
const SESSION: Session = {
  id: 's1',
  type: 'interview',
  company: 'Northwind Atlas',
  role: 'Operations Analyst',
  description: 'Job description text.',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: '',
  },
  instructions: 'Keep it short.',
  saveTranscript: true,
  autoAnswer: false,
  createdAt: 1,
  status: 'not-started',
  lastActiveAt: null,
};

/**
 * An invented document.
 *
 * @param id      Its id (and name).
 * @param addedAt When it was added.
 * @param kind    'resume' for the CV.
 * @returns The document.
 */
function doc(id: string, addedAt: number, kind?: 'resume'): StoredDocument {
  return {
    id,
    sessionId: 's1',
    name: `${id}.txt`,
    text: `SECRET ${id}`,
    chars: 9,
    addedAt,
    ...(kind ? { kind } : {}),
  };
}

const CV = doc('cv', 5, 'resume');
const DOCS = [doc('b', 2), CV, doc('a', 1)];

/**
 * A fake fetch that answers /api/summary with a summary.
 *
 * @param summary The summary to return.
 * @returns The fake, a vi.fn spy.
 */
function fakeFetch(summary = '## a.txt\n- Short.') {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          summary,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          ms: 3,
        }),
        { status: 200 },
      ),
  );
}

beforeEach(() => {
  resetSummaryMemory();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('summarisedDocuments and documentsFingerprint', () => {
  it('covers every document but the CV, oldest first', () => {
    expect(summarisedDocuments(DOCS).map((document) => document.id)).toEqual(['a', 'b']);
  });

  it('gives the same fingerprint for the same documents and another for any change', async () => {
    const one = await documentsFingerprint([doc('a', 1)]);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(await documentsFingerprint([doc('a', 9)])).toBe(one);
    expect(await documentsFingerprint([{ ...doc('a', 1), text: 'other' }])).not.toBe(one);
    expect(await documentsFingerprint([{ ...doc('a', 1), name: 'other' }])).not.toBe(one);
  });
});

describe('ensureDocumentsSummary', () => {
  it('needs no request when the session has only a CV', async () => {
    const fetchImpl = fakeFetch();
    expect(await ensureDocumentsSummary(SESSION, [CV], { fetchImpl })).toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('asks once without the CV, keeps it on the session, and logs no text', async () => {
    const fetchImpl = fakeFetch();
    const save = vi.fn(async (_id: string, _summary: StoredDocumentsSummary) => undefined);
    const deps = { fetchImpl, save, load: async () => null, now: () => 42 };
    const [first, second] = await Promise.all([
      ensureDocumentsSummary(SESSION, DOCS, deps),
      ensureDocumentsSummary(SESSION, DOCS, deps),
    ]);
    expect(first).toBe('## a.txt\n- Short.');
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/summary');
    const body = JSON.parse(String(init?.body)) as { documents: { name: string }[] };
    expect(body.documents.map((document) => document.name)).toEqual(['a.txt', 'b.txt']);
    expect(save).toHaveBeenCalledWith('s1', {
      fingerprint: await documentsFingerprint(summarisedDocuments(DOCS)),
      text: '## a.txt\n- Short.',
      createdAt: 42,
    });
    // A later call in the same page reuses it.
    expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logged).toContain('summary: written');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('Short.');
  });

  it('reuses a summary kept on the session or stored by another page', async () => {
    const fingerprint = await documentsFingerprint(summarisedDocuments(DOCS));
    const fetchImpl = fakeFetch();
    const kept = { fingerprint, text: 'kept summary', createdAt: 1 };
    expect(
      await ensureDocumentsSummary({ ...SESSION, documentsSummary: kept }, DOCS, { fetchImpl }),
    ).toBe('kept summary');
    const load = vi.fn(async () => ({ ...SESSION, documentsSummary: kept }));
    expect(await ensureDocumentsSummary(SESSION, DOCS, { fetchImpl, load })).toBe('kept summary');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('summarises again when the documents changed', async () => {
    const fetchImpl = fakeFetch('new summary');
    const stale = { fingerprint: 'old', text: 'old summary', createdAt: 1 };
    const result = await ensureDocumentsSummary({ ...SESSION, documentsSummary: stale }, DOCS, {
      fetchImpl,
      load: async () => null,
      save: async () => undefined,
    });
    expect(result).toBe('new summary');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives null, never an error, when the server or the network fails', async () => {
    const failing = vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 }));
    expect(
      await ensureDocumentsSummary(SESSION, DOCS, { fetchImpl: failing, load: async () => null }),
    ).toBeNull();
    // ADR-0116: the 503 is remembered in this page; forget it so the offline case sends again.
    resetSummaryMemory();
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('offline');
    });
    expect(
      await ensureDocumentsSummary(SESSION, DOCS, { fetchImpl: offline, load: async () => null }),
    ).toBeNull();
    expect(offline).toHaveBeenCalledTimes(1);
  });
});

/**
 * An in-memory SummaryFailureStore.
 *
 * @returns The store and its records.
 */
function memoryFailures() {
  const records = new Map<string, StoredSummaryFailure>();
  const store: SummaryFailureStore = {
    get: vi.fn(async (fingerprint: string) => records.get(fingerprint) ?? null),
    put: vi.fn(async (failure: StoredSummaryFailure) => {
      records.set(failure.fingerprint, failure);
    }),
    clear: vi.fn(async (fingerprint: string) => {
      records.delete(fingerprint);
    }),
  };
  return { store, records };
}

/**
 * A fake fetch that answers /api/summary with an error status.
 *
 * @param status The HTTP status.
 * @returns The fake, a vi.fn spy.
 */
function failingFetch(status: number) {
  return vi.fn<typeof fetch>(async () => new Response('{"code":"internal"}', { status }));
}

describe('failed summaries (ADR-0116)', () => {
  const MINUTE = 60_000;

  it('waits 2 minutes, 10 minutes, 1 hour, then 6 hours after failures in a row', () => {
    expect([1, 2, 3, 4, 9].map(summaryRetryDelay)).toEqual([
      2 * MINUTE,
      10 * MINUTE,
      60 * MINUTE,
      360 * MINUTE,
      360 * MINUTE,
    ]);
    expect(SUMMARY_RETRY_DELAYS_MS).toHaveLength(4);
  });

  it('remembers server errors and refused documents, not sign-in, rate limits or the network', () => {
    expect([500, 502, 503, 504, 400, 413].every(remembersSummaryFailure)).toBe(true);
    expect([401, 403, 429].some(remembersSummaryFailure)).toBe(false);
  });

  it('remembers a 502 by fingerprint and sends nothing for the same documents until the wait ends', async () => {
    const { store, records } = memoryFailures();
    let now = 1_000_000;
    const fetchImpl = failingFetch(502);
    const deps = { fetchImpl, load: async () => null, failures: store, now: () => now };
    expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBeNull();
    const fingerprint = await documentsFingerprint(summarisedDocuments(DOCS));
    expect(records.get(fingerprint)).toEqual({
      fingerprint,
      failures: 1,
      status: 502,
      failedAt: 1_000_000,
      retryAt: 1_000_000 + 2 * MINUTE,
    });
    // Opening, notes, Ask AI and Prepare inside the wait: no request, no cost.
    now += MINUTE;
    for (let i = 0; i < 4; i += 1) {
      expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBeNull();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // After the wait it asks again; a second failure waits longer.
    now += 2 * MINUTE;
    expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(records.get(fingerprint)).toMatchObject({ failures: 2, retryAt: now + 10 * MINUTE });
  });

  it('honours a failure another page stored, and logs no text', async () => {
    const { store, records } = memoryFailures();
    const fingerprint = await documentsFingerprint(summarisedDocuments(DOCS));
    records.set(fingerprint, {
      fingerprint,
      failures: 3,
      status: 504,
      failedAt: 10,
      retryAt: 5_000,
    });
    const fetchImpl = fakeFetch();
    const deps = { fetchImpl, load: async () => null, failures: store, now: () => 100 };
    expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logged).toContain('summary: waiting');
    expect(logged).not.toContain('SECRET');
  });

  it('forgets the failure once the summary is written', async () => {
    const { store, records } = memoryFailures();
    const fingerprint = await documentsFingerprint(summarisedDocuments(DOCS));
    records.set(fingerprint, { fingerprint, failures: 2, status: 502, failedAt: 1, retryAt: 50 });
    const deps = {
      fetchImpl: fakeFetch('## a.txt\n- Back.'),
      load: async () => null,
      save: async () => undefined,
      failures: store,
      now: () => 100,
    };
    expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBe('## a.txt\n- Back.');
    expect(records.has(fingerprint)).toBe(false);
  });

  it('does not remember a sign-in failure or an offline network', async () => {
    const { store } = memoryFailures();
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('offline');
    });
    for (const fetchImpl of [failingFetch(401), offline]) {
      expect(
        await ensureDocumentsSummary(SESSION, DOCS, {
          fetchImpl,
          load: async () => null,
          failures: store,
        }),
      ).toBeNull();
    }
    expect(store.put).not.toHaveBeenCalled();
  });

  it('still waits in this page when the failure cannot be saved', async () => {
    const store: SummaryFailureStore = {
      get: async () => null,
      put: async () => {
        throw new Error('blocked');
      },
      clear: async () => undefined,
    };
    const fetchImpl = failingFetch(503);
    const deps = { fetchImpl, load: async () => null, failures: store, now: () => 7 };
    expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBeNull();
    expect(await ensureDocumentsSummary(SESSION, DOCS, deps)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('documentsSummaryStatus (ADR-0116)', () => {
  it("is 'none' with only a CV, 'ready' with a matching summary, 'pending' before any request", async () => {
    const { store } = memoryFailures();
    expect(await documentsSummaryStatus(SESSION, [CV], { failures: store })).toEqual({
      state: 'none',
    });
    const fingerprint = await documentsFingerprint(summarisedDocuments(DOCS));
    const summary = { fingerprint, text: 'kept', createdAt: 1 };
    expect(
      await documentsSummaryStatus({ ...SESSION, documentsSummary: summary }, DOCS, {
        failures: store,
      }),
    ).toEqual({ state: 'ready' });
    expect(await documentsSummaryStatus(SESSION, DOCS, { failures: store })).toEqual({
      state: 'pending',
    });
  });

  it("is 'unavailable', with the retry time, after a remembered failure for these documents", async () => {
    const { store, records } = memoryFailures();
    const fingerprint = await documentsFingerprint(summarisedDocuments(DOCS));
    records.set(fingerprint, { fingerprint, failures: 2, status: 502, failedAt: 1, retryAt: 999 });
    expect(await documentsSummaryStatus(SESSION, DOCS, { failures: store })).toEqual({
      state: 'unavailable',
      retryAt: 999,
      failures: 2,
    });
    // A failure for other documents says nothing about these.
    expect(await documentsSummaryStatus(SESSION, [doc('c', 3)], { failures: store })).toEqual({
      state: 'pending',
    });
  });
});

describe('the smart session details', () => {
  it('hold only the CV and the summary', async () => {
    const context = await smartSessionContext(SESSION, DOCS, {
      fetchImpl: fakeFetch('the summary'),
      load: async () => null,
      save: async () => undefined,
    });
    expect(context.documents).toEqual([{ name: 'cv.txt', text: 'SECRET cv', kind: 'resume' }]);
    expect(context.documentsSummary).toBe('the summary');
    expect(context.description).toBe('Job description text.');
    expect(context.instructions).toBe('Keep it short.');
  });

  it("send '' when no summary could be written", () => {
    expect(withDocumentsSummary(SESSION, DOCS, null).documentsSummary).toBe('');
  });
});
