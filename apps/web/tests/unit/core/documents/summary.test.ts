/**
 * Tests for apps/web/src/core/documents/summary.ts (ADR-0067), with fetch and storage faked:
 * - the summary covers every document but the CV, in prompt order; the fingerprint changes when a
 *   name or text changes;
 * - no other documents: '' and no request; a kept summary with a matching fingerprint is reused (on
 *   the session, in this page, or stored by another page) and a changed set is summarised again;
 * - a new summary is asked for once (two callers share the request), sent without the CV, kept on
 *   the session, and logged without text; a failure gives null, never an error;
 * - the smart session details hold only the CV and the summary ('' when none).
 * All text is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  documentsFingerprint,
  ensureDocumentsSummary,
  resetSummaryMemory,
  smartSessionContext,
  summarisedDocuments,
  withDocumentsSummary,
} from '@/core/documents/summary';
import type { Session, StoredDocument, StoredDocumentsSummary } from '@/core/storage/types';

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
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('offline');
    });
    expect(
      await ensureDocumentsSummary(SESSION, DOCS, { fetchImpl: offline, load: async () => null }),
    ).toBeNull();
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
