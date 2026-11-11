/**
 * File: apps/web/src/core/documents/summary.ts
 * Purpose: The documents summary for the smart-model routes (ADR-0067). A session may hold up to
 *          500k characters of documents; the live answers (fast model) read them all from Claude's
 *          cache, but the notes, Ask AI and the Prepare tools (smart model) get the CV in full and a
 *          short summary of the other documents instead. The summary is written once per session by
 *          the fast model (POST /api/summary), kept on the session in IndexedDB, and written again only
 *          when the documents change (their fingerprint no longer matches).
 * Used by: src/core/notes/generate.ts, src/core/review/ask.ts, src/features/prepare/MockInterview.tsx,
 *          src/features/prepare/QuestionBank.tsx, src/features/live/LiveSession.tsx (written ahead
 *          when a live session opens)
 * Depends on: @kite/shared (types), src/core/answer/warm.ts (sortDocuments, toSessionContext),
 *             src/core/storage/sessions.ts (getSession, updateSession), the browser's fetch and
 *             crypto.subtle
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0067
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
import type { Session, StoredDocument, StoredDocumentsSummary } from '../storage/types';
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
}

/**
 * Summaries written in this page, by session id: a second request in the same page (Ask AI after
 * the notes, the next mock interview step) needs no read of IndexedDB and no request.
 */
const kept = new Map<string, StoredDocumentsSummary>();

/** Requests in progress, by session id and fingerprint, so two callers share one request. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Forgets the summaries kept in this page (tests).
 *
 * @returns Nothing.
 * Called from: tests
 */
export function resetSummaryMemory(): void {
  kept.clear();
  inFlight.clear();
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
 *          written (offline, Claude unavailable, signed out).
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
      console.warn('summary: failed', { sessionId, status: response.status });
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
  console.info('summary: written', {
    sessionId,
    documents: others.length,
    msTotal: Math.round(performance.now() - startedAt),
    serverMs: reply.ms,
    input: reply.usage.input_tokens,
    output: reply.usage.output_tokens,
  });
  return reply.summary;
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
