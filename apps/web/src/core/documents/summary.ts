/**
 * File: apps/web/src/core/documents/summary.ts
 * Purpose: The documents summary for the smart-model routes (ADR-0067). A session may hold up to
 *          500k characters of documents; the live answers (fast model) read them all from Claude's
 *          cache, but the notes, Ask AI and the Prepare tools (smart model) get the CV in full and a
 *          short summary of the other documents instead. The summary is written once per session by
 *          the fast model (POST /api/summary), kept on the session in IndexedDB, and written again only
 *          when the documents change (their fingerprint no longer matches).
 *          ADR-0116: a failed summary is remembered on this device by the documents' fingerprint
 *          (core/storage/summaryFailures.ts), and the same documents are not asked for again until a
 *          growing wait has passed (2 minutes, 10 minutes, 1 hour, then 6 hours), so a failure that
 *          repeats is not paid for again by every open, notes, Ask AI and Prepare request.
 *          documentsSummaryStatus() tells the session page when the summary is unavailable.
 * Used by: src/core/notes/generate.ts, src/core/review/ask.ts, src/features/prepare/MockInterview.tsx,
 *          src/features/prepare/QuestionBank.tsx, src/features/live/LiveSession.tsx (written ahead
 *          when a live session opens), src/features/review/DocumentsSummaryNote.tsx (the status)
 * Depends on: @kite/shared (types), src/core/answer/warm.ts (sortDocuments, toSessionContext),
 *             src/core/storage/sessions.ts (getSession, updateSession),
 *             src/core/storage/summaryFailures.ts, the browser's fetch and crypto.subtle
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0067, ADR-0116
 *
 * Never logs document or summary text: only the session id, sizes, timings and token counts.
 */
import type {
  DocumentsSummaryRequest,
  DocumentsSummaryResponse,
  SessionContext,
} from '@kite/shared';
import { sortDocuments, toSessionContext } from '../answer/warm';
import { getSession, updateSession } from '../storage/sessions';
import {
  clearSummaryFailure,
  getSummaryFailure,
  putSummaryFailure,
} from '../storage/summaryFailures';
import type {
  Session,
  StoredDocument,
  StoredDocumentsSummary,
  StoredSummaryFailure,
} from '../storage/types';
import { requestBody } from '../answer/answerClient';

/**
 * The documents the summary covers: every document but the CV, in prompt order.
 *
 * @param documents The session's documents (any order).
 * @returns The documents other than the CV, sorted as toSessionContext() sorts them.
 * Called from: ensureDocumentsSummary(); tests
 */
export function summarisedDocuments(documents: readonly StoredDocument[]): StoredDocument[] {
  return sortDocuments(documents).filter((document) => document.kind !== 'resume');
}

/**
 * The fingerprint of a set of documents: SHA-256 (hex) of their names and texts, in order. The same
 * documents always give the same fingerprint; any change in a name or text gives another.
 *
 * @param documents The documents, in order.
 * @returns 64 hex characters.
 * Called from: ensureDocumentsSummary(); tests
 */
export async function documentsFingerprint(
  documents: readonly Pick<StoredDocument, 'name' | 'text'>[],
): Promise<string> {
  const json = JSON.stringify(documents.map((document) => [document.name, document.text]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Where failed summaries are remembered (ADR-0116; tests replace it). */
export interface SummaryFailureStore {
  /** Reads the failure remembered for a fingerprint (null: none). */
  get: (fingerprint: string) => Promise<StoredSummaryFailure | null>;
  /** Saves a failure. */
  put: (failure: StoredSummaryFailure) => Promise<void>;
  /** Forgets the failure for a fingerprint. */
  clear: (fingerprint: string) => Promise<void>;
}

/** What ensureDocumentsSummary() uses (tests replace them). */
export interface SummaryDeps {
  /** fetch (default: the browser's). */
  fetchImpl?: typeof fetch;
  /** Reads the stored session (default getSession()), for a summary another call already kept. */
  load?: (sessionId: string) => Promise<Session | null>;
  /** Keeps the summary on the session (default updateSession()). */
  save?: (sessionId: string, summary: StoredDocumentsSummary) => Promise<unknown>;
  /** The clock (default Date.now). */
  now?: () => number;
  /** Failed summaries on this device (default: the summaryFailures store, ADR-0116). */
  failures?: SummaryFailureStore;
}

/** The default SummaryFailureStore: IndexedDB (core/storage/summaryFailures.ts). */
const STORED_FAILURES: SummaryFailureStore = {
  get: getSummaryFailure,
  put: putSummaryFailure,
  clear: clearSummaryFailure,
};

/**
 * ADR-0116: how long to wait before asking again for the same documents after 1, 2, 3 and 4 or more
 * failures in a row (ms): 2 minutes, 10 minutes, 1 hour, then 6 hours. A short first wait lets a
 * passing problem (Claude overloaded, a timeout) clear quickly; the later ones stop a failure that
 * repeats from being paid for on every open, notes, Ask AI and Prepare request.
 */
export const SUMMARY_RETRY_DELAYS_MS = [
  2 * 60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;

/**
 * The wait before asking again after a number of failures in a row.
 *
 * @param failures Failures in a row (1 or more).
 * @returns Milliseconds (SUMMARY_RETRY_DELAYS_MS; the last one from the fourth failure on).
 * Called from: rememberFailure(); tests
 */
export function summaryRetryDelay(failures: number): number {
  const index = Math.min(Math.max(failures, 1), SUMMARY_RETRY_DELAYS_MS.length) - 1;
  return SUMMARY_RETRY_DELAYS_MS[index]!;
}

/**
 * Whether a failed reply is remembered (ADR-0116): the server answered with an error after it may
 * have paid Claude (5xx), or refused the documents (400, 413), which would happen again. Not a
 * sign-in problem (401, 403) or a rate limit (429), which cost nothing and clear on their own, and
 * not a network failure (offline), which never reached Claude.
 *
 * @param status The HTTP status.
 * @returns True to remember it.
 * Called from: writeSummary(); tests
 */
export function remembersSummaryFailure(status: number): boolean {
  return status >= 500 || status === 400 || status === 413;
}

/**
 * Summaries written in this page, by session id: a second request in the same page (Ask AI after
 * the notes, the next mock interview step) needs no read of IndexedDB and no request.
 */
const kept = new Map<string, StoredDocumentsSummary>();

/** Requests in progress, by session id and fingerprint, so two callers share one request. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Failures in this page, by fingerprint (ADR-0116): still honoured when IndexedDB cannot save them
 * (a private window, blocked storage).
 */
const failedHere = new Map<string, StoredSummaryFailure>();

/**
 * Forgets the summaries and failures kept in this page (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function resetSummaryMemory(): void {
  kept.clear();
  inFlight.clear();
  failedHere.clear();
}

/**
 * The failure remembered for a set of documents: this page's, else the stored one. Never throws.
 *
 * @param fingerprint The documents' fingerprint.
 * @param deps        The failure store.
 * @returns The record, or null.
 * Called from: writeSummary(), documentsSummaryStatus()
 */
async function knownFailure(
  fingerprint: string,
  deps: SummaryDeps,
): Promise<StoredSummaryFailure | null> {
  const stored = await (deps.failures ?? STORED_FAILURES).get(fingerprint).catch(() => null);
  const here = failedHere.get(fingerprint) ?? null;
  // The later of the two: another page may have failed (or retried) since this one did.
  if (!stored) return here;
  if (!here) return stored;
  return stored.failedAt >= here.failedAt ? stored : here;
}

/**
 * Remembers one more failure for a set of documents, with the next wait (summaryRetryDelay()).
 * Never throws.
 *
 * @param fingerprint The documents' fingerprint.
 * @param previous    The failure already remembered, if any.
 * @param status      This failure's HTTP status.
 * @param deps        The failure store and clock.
 * @returns The new record.
 * Called from: writeSummary()
 */
async function rememberFailure(
  fingerprint: string,
  previous: StoredSummaryFailure | null,
  status: number,
  deps: SummaryDeps,
): Promise<StoredSummaryFailure> {
  const failedAt = (deps.now ?? Date.now)();
  const failures = (previous?.failures ?? 0) + 1;
  const failure = {
    fingerprint,
    failures,
    status,
    failedAt,
    retryAt: failedAt + summaryRetryDelay(failures),
  };
  failedHere.set(fingerprint, failure);
  await (deps.failures ?? STORED_FAILURES).put(failure).catch(() => undefined);
  return failure;
}

/**
 * The summary of a session's documents other than the CV: '' when there are none; the kept one
 * when its fingerprint still matches; otherwise a new one from POST /api/summary, which is kept on
 * the session. Never throws.
 *
 * @param session   The stored session.
 * @param documents Its documents (any order).
 * @param deps      fetch, storage and clock (tests).
 * @returns The summary text, '' when there is nothing to summarise, or null when it could not be
 *          written (offline, Claude unavailable, signed out) or the same documents failed recently
 *          and their wait has not passed (ADR-0116: no request is sent then).
 * Called from: smartSessionContext(); LiveSession.tsx (ahead of the call's end)
 */
export async function ensureDocumentsSummary(
  session: Session,
  documents: readonly StoredDocument[],
  deps: SummaryDeps = {},
): Promise<string | null> {
  const others = summarisedDocuments(documents);
  if (others.length === 0) return '';
  try {
    const fingerprint = await documentsFingerprint(others);
    const matches = (summary: StoredDocumentsSummary | undefined) =>
      summary?.fingerprint === fingerprint ? summary.text : null;
    const known = matches(session.documentsSummary) ?? matches(kept.get(session.id));
    if (known !== null) return known;
    const key = `${session.id}:${fingerprint}`;
    const running = inFlight.get(key);
    if (running) return await running;
    const request = writeSummary(session.id, others, fingerprint, deps);
    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  } catch {
    // crypto.subtle missing (an insecure page) or storage failed: no summary, never an error.
    return null;
  }
}

/**
 * Looks for a summary stored by another page, or asks the server for one and keeps it.
 *
 * @param sessionId   The session id.
 * @param others      The documents to summarise, in prompt order.
 * @param fingerprint Their fingerprint.
 * @param deps        fetch, storage and clock.
 * @returns The summary, or null when it could not be written.
 * Called from: ensureDocumentsSummary()
 */
async function writeSummary(
  sessionId: string,
  others: readonly StoredDocument[],
  fingerprint: string,
  deps: SummaryDeps,
): Promise<string | null> {
  const stored = (await (deps.load ?? getSession)(sessionId).catch(() => null))?.documentsSummary;
  if (stored?.fingerprint === fingerprint) {
    kept.set(sessionId, stored);
    return stored.text;
  }
  // ADR-0116: the same documents failed recently, so asking now would most likely fail (and be paid
  // for) again. Wait until the backoff ends; the caller goes on without a summary.
  const previous = await knownFailure(fingerprint, deps);
  const now = (deps.now ?? Date.now)();
  if (previous && now < previous.retryAt) {
    console.info('summary: waiting', {
      sessionId,
      failures: previous.failures,
      status: previous.status,
      retryInMs: previous.retryAt - now,
    });
    return null;
  }
  const body: DocumentsSummaryRequest = {
    documents: others.map((document) => ({ name: document.name, text: document.text })),
  };
  const startedAt = performance.now();
  let reply: DocumentsSummaryResponse;
  try {
    // 1.5.1 (ADR-0069): gzipped when large (the documents are about 0.5–1.9 MB as JSON).
    const sent = await requestBody(JSON.stringify(body));
    const response = await (deps.fetchImpl ?? fetch)('/api/summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sent.gzip ? { 'content-encoding': 'gzip' } : {}),
      },
      body: sent.data,
    });
    if (!response.ok) {
      const failure = remembersSummaryFailure(response.status)
        ? await rememberFailure(fingerprint, previous, response.status, deps)
        : null;
      console.warn('summary: failed', {
        sessionId,
        status: response.status,
        ...(failure
          ? { failures: failure.failures, retryInMs: failure.retryAt - failure.failedAt }
          : {}),
      });
      return null;
    }
    reply = (await response.json()) as DocumentsSummaryResponse;
  } catch {
    console.warn('summary: failed', { sessionId, status: 'network' });
    return null;
  }
  const summary: StoredDocumentsSummary = {
    fingerprint,
    text: reply.summary,
    createdAt: (deps.now ?? Date.now)(),
  };
  kept.set(sessionId, summary);
  // Kept on the session even if saving fails (the page still has it in `kept`).
  await (deps.save ?? ((id, value) => updateSession(id, { documentsSummary: value })))(
    sessionId,
    summary,
  ).catch(() => undefined);
  // ADR-0116: these documents have a summary now, so any failure remembered for them is over.
  if (previous) {
    failedHere.delete(fingerprint);
    await (deps.failures ?? STORED_FAILURES).clear(fingerprint).catch(() => undefined);
  }
  console.info('summary: written', {
    sessionId,
    documents: others.length,
    msTotal: Math.round(performance.now() - startedAt),
    serverMs: reply.ms,
    input: reply.usage.input_tokens,
    output: reply.usage.output_tokens,
    cutOff: reply.cutOff === true,
  });
  return reply.summary;
}

/** A documents summary that is not unavailable (ADR-0116). */
export interface SummaryStatusPlain {
  /**
   * 'none': no documents other than the CV, nothing to summarise; 'ready': a summary of the current
   * documents is kept; 'pending': not written yet, it is written the next time it is needed.
   */
  state: 'none' | 'ready' | 'pending';
}

/** A documents summary whose last request failed (ADR-0116). */
export interface SummaryStatusUnavailable {
  /** The last request for these documents failed. */
  state: 'unavailable';
  /** The earliest time it is asked for again (Unix ms). */
  retryAt: number;
  /** Failures in a row for these documents. */
  failures: number;
}

/** Where a session's documents summary stands (ADR-0116), for the session page. */
export type DocumentsSummaryStatus = SummaryStatusPlain | SummaryStatusUnavailable;

/**
 * Where a session's documents summary stands, without asking the server. Never throws.
 *
 * @param session   The stored session.
 * @param documents Its documents (any order).
 * @param deps      Failure store (tests).
 * @returns The status. 'unavailable' while a remembered failure for the current documents is newer
 *          than any kept summary; 'pending' when the fingerprint cannot be worked out.
 * Called from: src/features/review/DocumentsSummaryNote.tsx; tests
 */
export async function documentsSummaryStatus(
  session: Session,
  documents: readonly StoredDocument[],
  deps: Pick<SummaryDeps, 'failures'> = {},
): Promise<DocumentsSummaryStatus> {
  const others = summarisedDocuments(documents);
  if (others.length === 0) return { state: 'none' };
  try {
    const fingerprint = await documentsFingerprint(others);
    const summary =
      session.documentsSummary?.fingerprint === fingerprint
        ? session.documentsSummary
        : kept.get(session.id)?.fingerprint === fingerprint
          ? kept.get(session.id)
          : undefined;
    if (summary) return { state: 'ready' };
    const failure = await knownFailure(fingerprint, deps);
    if (failure) {
      return { state: 'unavailable', retryAt: failure.retryAt, failures: failure.failures };
    }
    return { state: 'pending' };
  } catch {
    return { state: 'pending' };
  }
}

/**
 * The session details for a smart-model route (notes, Ask AI, Prepare; ADR-0067): the same details
 * as the live answers, but with only the CV in `documents` and the summary of the other documents in
 * `documentsSummary` ('' when there are none or no summary could be written).
 *
 * @param session   The stored session.
 * @param documents Its documents (any order).
 * @param summary   From ensureDocumentsSummary() (null: none could be written).
 * @returns The session details.
 * Called from: smartSessionContext(); core/notes/generate.ts (notesRequest()); tests
 */
export function withDocumentsSummary(
  session: Session,
  documents: readonly StoredDocument[],
  summary: string | null,
): SessionContext {
  const context = toSessionContext(session, documents);
  return {
    ...context,
    documents: context.documents.filter((document) => document.kind === 'resume'),
    documentsSummary: summary ?? '',
  };
}

/**
 * Writes (or reuses) the documents summary, then builds the smart-model session details.
 *
 * @param session   The stored session.
 * @param documents Its documents (any order).
 * @param deps      fetch, storage and clock (tests).
 * @returns The session details for a smart-model route. Never throws.
 * Called from: core/notes/generate.ts, core/review/ask.ts, MockInterview.tsx, QuestionBank.tsx
 */
export async function smartSessionContext(
  session: Session,
  documents: readonly StoredDocument[],
  deps: SummaryDeps = {},
): Promise<SessionContext> {
  return withDocumentsSummary(
    session,
    documents,
    await ensureDocumentsSummary(session, documents, deps),
  );
}
