/**
 * File: apps/web/src/core/answer/warm.ts
 * Purpose: Pre-warms Claude's prompt cache for a session (architecture §6.3): turns the stored
 *          session and its documents into the request's session details and sends mode 'warm',
 *          so the first real answer of the call reads the cache instead of writing it.
 * Used by: src/features/live/LiveSession.tsx (when a live session opens),
 *          src/features/live/LivePage.tsx (again on Connect, Day 4),
 *          src/features/dev/ClaudeTest.tsx ("Warm with session")
 * Depends on: src/core/answer/answerClient.ts, src/core/storage/types.ts, @kite/shared
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (Pre-warm), §7.2;
 *               day-03-sessions.md Stage 5
 *
 * The session details built here must be the same, byte for byte, as the ones the Day 4 answers
 * send, or the answers miss the cache: both use toLiveSessionContext() (Batch C, P2-1: the CV in full and
 * the documents summary; the other documents' matching parts go with each question instead).
 *
 * Logs only the session id, timings and token counts; never session or document text.
 */
import {
  DEFAULT_CODING_LANGUAGE,
  cleanPersonName,
  parseKeyTerms,
  providerOf,
  type AnswerModel,
  type ConversationChunk,
  type SessionContext,
} from '@kite/shared';
import {
  getAnswerStyleVersion,
  getCodingLanguage,
  getMissingInfoMode,
} from '@/core/storage/answerPrefs';
import { answerLanguageName, type Session, type StoredDocument } from '@/core/storage/types';
import { streamAnswer, type AnswerDone } from './answerClient';
import { pinFor } from './instructionsPin';

/**
 * Puts a session's documents in the order the prompt uses: the CV first (ADR-0067), then the rest
 * oldest first; ties by id, so the order never depends on how they were read.
 *
 * @param documents The documents (any order).
 * @returns A new, sorted array.
 * Called from: toSessionContext(); core/documents/summary.ts
 */
export function sortDocuments<T extends Pick<StoredDocument, 'id' | 'addedAt' | 'kind'>>(
  documents: readonly T[],
): T[] {
  const rank = (document: T) => (document.kind === 'resume' ? 0 : 1);
  return [...documents].sort((a, b) =>
    rank(a) !== rank(b)
      ? rank(a) - rank(b)
      : a.addedAt !== b.addedAt
        ? a.addedAt - b.addedAt
        : a.id < b.id
          ? -1
          : 1,
  );
}

/**
 * Builds the request's session details from what is stored on this computer. The job description
 * and the user's instructions are part of the details; the documents follow, the CV first
 * (sortDocuments()). The CV carries kind 'resume', which is never written into the prompt. ADR-0093:
 * the session's contactName, when it has one, goes as themName (the other person's speaker label); a
 * caller with a call whose own name wins passes the session with that name (withTheirName()).
 *
 * @param session   The stored session.
 * @param documents Its documents (any order).
 * @returns The session details for /api/answer.
 * Called from: warmSession(); the live answer panel (Day 4); core/documents/summary.ts
 *              (smartSessionContext())
 */
export function toSessionContext(
  session: Session,
  documents: readonly StoredDocument[],
): SessionContext {
  const sorted = sortDocuments(documents);
  const language = answerLanguageName(session.preferences.language);
  // Settings → Answers (ADR-0030). The defaults send nothing, so a session on them keeps its bytes.
  const codingLanguage = getCodingLanguage();
  const missingInfo = getMissingInfoMode();
  return {
    type: session.type,
    company: session.company,
    role: session.role,
    description: session.description,
    instructions: session.instructions,
    // Commas, semicolons and new lines all separate terms (shared rule, v1.0.1).
    keyTerms: parseKeyTerms(session.preferences.keyTerms),
    // Copied field by field so the order is fixed (JSON follows insertion order).
    style: {
      format: session.preferences.style.format,
      length: session.preferences.style.length,
      tone: session.preferences.style.tone,
      // Absent when off, so the prompt and its cache stay exactly as they were.
      ...(session.preferences.style.star ? { star: true } : {}),
    },
    ...(language ? { language } : {}),
    ...(codingLanguage !== DEFAULT_CODING_LANGUAGE ? { codingLanguage } : {}),
    ...(missingInfo === 'story' ? { missingInfo } : {}),
    // ADR-0093: only with a real name, so a session without one keeps its bytes.
    ...(cleanPersonName(session.contactName)
      ? { themName: cleanPersonName(session.contactName) }
      : {}),
    documents: sorted.map((document) => ({
      name: document.name,
      text: document.text,
      ...(document.kind === 'resume' ? { kind: 'resume' as const } : {}),
    })),
  };
}

/**
 * The session details of the live answers and their warm-ups (Batch C, P2-1; investigation D3): the CV in
 * full and the documents summary (ADR-0067) in the cached prefix, instead of every document in full. The
 * other documents' parts that match each question go in the uncached tail (core/documents/chunks.ts), so a
 * request stays about the size of a CV-only one, whatever the documents' size. The summary is the one kept
 * on the session (LiveSession.tsx writes it when the session opens); '' when there is none yet.
 *
 * @param session   The stored session.
 * @param documents Its documents (any order).
 * @returns The session details for /api/answer.
 * Called from: sendWarmUp(); core/answer/context.ts buildAnswerRequest()
 */
export function toLiveSessionContext(
  session: Session,
  documents: readonly StoredDocument[],
): SessionContext {
  const context = toSessionContext(session, documents);
  const others = context.documents.some((document) => document.kind !== 'resume');
  return {
    ...context,
    documents: context.documents.filter((document) => document.kind === 'resume'),
    documentsSummary: others ? (session.documentsSummary?.text ?? '') : '',
  };
}

/**
 * 1.5.1 (ADR-0069): a warm-up for the same session, documents and lessons started this recently (ms) is
 * reused instead of sent again. Opening a session and pressing Connect a few seconds later sent two
 * (measured 11 Nov 2026), and with large documents each one uploads about 0.5–1.9 MB.
 */
export const WARM_REUSE_MS = 60_000;

/** Warm-ups started recently, by what they warm (dropped when one fails). */
const recentWarmUps = new Map<string, { at: number; result: Promise<AnswerDone | null> }>();

/**
 * What a warm-up warms, as a key: the session, its model, its documents (ids and sizes) and lessons.
 *
 * @param session   The session.
 * @param documents Its documents.
 * @param lessons   The lessons sent.
 * @param instructions The company instructions version the call pinned (ADR-0083), if any.
 * @param callId    ADR-0099: the call's id, when the warm-up belongs to a call.
 * @returns The key.
 */
function warmKey(
  session: Session,
  documents: readonly StoredDocument[],
  lessons: readonly string[] | undefined,
  instructions: string | undefined,
  callId: string | undefined,
): string {
  const docs = documents.map((document) => `${document.id}:${document.chars}`).join(',');
  // Batch C (P2-1): the summary is part of the warmed prefix, so a new one is a new warm-up.
  const summary = session.documentsSummary?.createdAt ?? 0;
  // ADR-0083: the company instructions version is part of the warmed rules block too.
  // ADR-0099: for a GPT session the call's id is OpenAI's cache key, so the call's own warm-up is not the
  // page-open one.
  const key = providerOf(session.preferences.model) === 'openai' ? (callId ?? '') : '';
  return `${session.id}|${session.preferences.model}|${docs}|${lessons?.length ?? 0}|${summary}|${instructions ?? ''}|${key}`;
}

/**
 * ADR-0094 and ADR-0099: which prompt cache a model's answers read, so a switch during a call warms only when the
 * cache changes. Fast and Groq share Claude Haiku's (ADR-0095: a Groq session's screenshots and fallback use
 * Haiku); Smart has its own; each Gemini and GPT model has its own (with Claude Haiku as its fallback).
 *
 * @param model The session's model.
 * @returns 'fast', 'smart', or the Gemini or GPT model itself.
 * Called from: useLiveAnswers.ts (the model switch's warm-up); tests
 */
export function warmGroup(model: AnswerModel): AnswerModel {
  const provider = providerOf(model);
  if (provider === 'gemini' || provider === 'openai') return model;
  return model === 'smart' ? 'smart' : 'fast';
}

/**
 * Forgets the recent warm-ups, so the next one is sent (tests).
 *
 * Called from: tests
 */
export function forgetRecentWarmUps(): void {
  recentWarmUps.clear();
}

/** Options for warmSession() (tests replace the request). */
export interface WarmOptions {
  /** Sends the request. Default streamAnswer() from answerClient.ts. */
  send?: typeof streamAnswer;
  /**
   * The conversation chunks already sent in this call (the idle re-warm, keepWarm.ts), so the
   * warm-up refreshes their cache entry too. Omitted: the session's cached parts only.
   */
  conversation?: ConversationChunk[];
  /**
   * The approved lessons for this session (Day 5 Stage 7): the same list the answers send, so
   * the warm-up writes the rules block the answers read.
   */
  lessons?: readonly string[];
  /**
   * The call's start (Unix ms) when the warm-up belongs to a call (ADR-0083): it then sends the
   * company instructions version the call pinned, so it writes the rules block the answers read.
   * Omitted (the page-open warm-up, before any call): the version in force.
   */
  callStartedAt?: number;
  /**
   * ADR-0099: the call's record id, when the warm-up belongs to a call: sent as the request's callId (OpenAI's
   * prompt_cache_key), the same key the call's answers send.
   */
  callId?: string | undefined;
  /** ADR-0099 measurement only: OpenAI priority processing (/dev/latency, admins). */
  serviceTier?: 'priority' | undefined;
}

/**
 * Warms the prompt cache for a session. Never throws and never blocks: the caller does not wait
 * for it, and a failure only means the first answer is a little slower.
 *
 * @param session   The stored session.
 * @param documents Its documents.
 * @param options   The conversation so far (idle re-warm), and a request override (tests).
 * @returns The warm-up's usage and timings, or null when it failed.
 * Called from: LiveSession.tsx (on open); LivePage.tsx (on Connect, and the idle re-warm);
 *              ClaudeTest.tsx
 */
export function warmSession(
  session: Session,
  documents: readonly StoredDocument[],
  options: WarmOptions = {},
): Promise<AnswerDone | null> {
  // 1.5.1 (ADR-0069): the page-open and Connect warm-ups are one. The idle re-warm (with the
  // conversation) always runs: it comes minutes later, to keep the cache alive.
  const instructions = pinFor(options.callStartedAt)?.live;
  const key = options.conversation?.length
    ? null
    : warmKey(session, documents, options.lessons, instructions, options.callId);
  const now = Date.now();
  if (key) {
    const recent = recentWarmUps.get(key);
    if (recent && now - recent.at < WARM_REUSE_MS) return recent.result;
  }
  const result = sendWarmUp(session, documents, options);
  if (key) {
    recentWarmUps.set(key, { at: now, result });
    void result.then((done) => {
      if (!done && recentWarmUps.get(key)?.result === result) recentWarmUps.delete(key);
    });
  }
  return result;
}

/**
 * Sends one warm-up request.
 *
 * @param session   The stored session.
 * @param documents Its documents.
 * @param options   See WarmOptions.
 * @returns The warm-up's usage and timings, or null when it failed.
 * Called from: warmSession()
 */
function sendWarmUp(
  session: Session,
  documents: readonly StoredDocument[],
  options: WarmOptions,
): Promise<AnswerDone | null> {
  const send = options.send ?? streamAnswer;
  return new Promise((resolve) => {
    try {
      send(
        {
          mode: 'warm',
          model: session.preferences.model,
          // ADR-0099: OpenAI's prompt_cache_key, as the call's answers send it.
          ...(options.callId ? { callId: options.callId } : {}),
          ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
          session: toLiveSessionContext(session, documents),
          ...(options.conversation?.length ? { conversation: options.conversation } : {}),
          ...(options.lessons?.length ? { lessons: [...options.lessons] } : {}),
          // The same rules version the answers send, so the warm-up writes what they read (ADR-0032).
          ...(getAnswerStyleVersion() === 'previous' ? { styleVersion: 'previous' as const } : {}),
          // ADR-0083: the call's company instructions version, as its answers send it.
          ...(pinFor(options.callStartedAt)
            ? { instructionsVersion: pinFor(options.callStartedAt)!.live }
            : {}),
        },
        {
          // A warm-up produces no text.
          onDelta: () => undefined,
          onDone: (done) => {
            console.info('warm: done', {
              sessionId: session.id,
              chunks: options.conversation?.length ?? 0,
              msTotal: done.msTotal,
              cacheWrite: done.usage.cache_creation_input_tokens,
              cacheRead: done.usage.cache_read_input_tokens,
              input: done.usage.input_tokens,
            });
            resolve(done);
          },
          onError: (failure) => {
            // The code only; the message is shown nowhere and holds no content anyway.
            console.warn('warm: failed', { sessionId: session.id, code: failure.code });
            resolve(null);
          },
        },
      );
    } catch {
      resolve(null);
    }
  });
}
