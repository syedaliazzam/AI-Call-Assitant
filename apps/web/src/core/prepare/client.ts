/**
 * File: apps/web/src/core/prepare/client.ts
 * Purpose: Asks the server for a Prepare tool's reply (POST /api/prepare). Never throws: a failure
 *          comes back as a message for the user.
 * Used by: src/features/prepare/MockInterview.tsx, src/features/prepare/QuestionBank.tsx
 * Depends on: @kite/shared (types), src/core/answer/unavailable.ts, the browser's fetch
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 *
 * Questions and answers are the user's content and are never logged.
 */
import type {
  AnswerErrorCode,
  MockFeedbackRequest,
  MockFeedbackResponse,
  MockQuestionsRequest,
  MockQuestionsResponse,
  MockSummaryRequest,
  MockSummaryResponse,
  PrepareRequest,
  QuestionBankRequest,
  QuestionBankResponse,
} from '@kite/shared';
import { unavailableReason } from '../answer/unavailable';

/** What a Prepare request gave. */
export type PrepareResult<T> =
  | {
      /** It worked. */
      ok: true;
      /** The reply. */
      data: T;
    }
  | {
      /** It did not. */
      ok: false;
      /** What to tell the user. */
      message: string;
    };

/** The reply each kind of request gets. */
interface PrepareOverloads {
  /** Questions for a mock interview. */
  (
    request: MockQuestionsRequest,
    fetchImpl?: typeof fetch,
  ): Promise<PrepareResult<MockQuestionsResponse>>;
  /** Feedback on one answer. */
  (
    request: MockFeedbackRequest,
    fetchImpl?: typeof fetch,
  ): Promise<PrepareResult<MockFeedbackResponse>>;
  /** A summary of the interview. */
  (
    request: MockSummaryRequest,
    fetchImpl?: typeof fetch,
  ): Promise<PrepareResult<MockSummaryResponse>>;
  /** A question bank. */
  (
    request: QuestionBankRequest,
    fetchImpl?: typeof fetch,
  ): Promise<PrepareResult<QuestionBankResponse>>;
}

/**
 * Sends one Prepare request.
 *
 * @param request   The request.
 * @param fetchImpl fetch (tests replace it).
 * @returns The reply, or a message.
 * Called from: `prepare`
 */
async function send(
  request: PrepareRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PrepareResult<unknown>> {
  try {
    const response = await fetchImpl('/api/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        /** Why it failed. */
        code?: AnswerErrorCode;
        /** The server's words. */
        message?: string;
      } | null;
      if (failure?.code === 'unauthorized') {
        return { ok: false, message: 'You have been signed out. Sign in again, then try.' };
      }
      if (failure?.code && unavailableReason(failure.code, failure.message ?? '')) {
        return { ok: false, message: failure.message ?? 'Claude is unavailable right now.' };
      }
      return { ok: false, message: 'Kite could not do that just now. Try again.' };
    }
    return { ok: true, data: (await response.json()) as unknown };
  } catch {
    return { ok: false, message: 'Kite could not do that: check your connection and try again.' };
  }
}

/**
 * Sends one Prepare request, typed by its kind.
 *
 * @param request   The request.
 * @param fetchImpl fetch (tests replace it).
 * @returns The reply, or a message.
 * Called from: MockInterview.tsx, QuestionBank.tsx; tests
 */
export const prepare = send as PrepareOverloads;
