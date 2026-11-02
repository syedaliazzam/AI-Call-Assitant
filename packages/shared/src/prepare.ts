/**
 * File: packages/shared/src/prepare.ts
 * Purpose: Request and response types for POST /api/prepare, the Prepare tools (parity Phase 4):
 *          Mock Interview (questions, feedback on one answer, a summary) and Question Bank.
 * Used by: apps/web/src/server/prepare.ts, apps/web/src/server/validate.ts,
 *          apps/web/app/api/prepare/route.ts, apps/web/src/core/prepare/client.ts
 * Depends on: ./api.ts (SessionContext)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 */
import type { SessionContext } from './api';

/** Fewest questions in a mock interview. */
export const MIN_MOCK_QUESTIONS = 1;

/** Most questions in a mock interview. */
export const MAX_MOCK_QUESTIONS = 10;

/** Longest question or answer sent to the server, in characters. */
export const MAX_MOCK_TEXT_CHARS = 8_000;

/** Longest feedback sent back with a summary request, in characters. */
export const MAX_MOCK_FEEDBACK_CHARS = 2_000;

/** One answered question in a mock interview. */
export interface MockItem {
  /** What Kite asked. */
  question: string;
  /** What the user said. Never logged. */
  answer: string;
  /** Kite's feedback on it. */
  feedback: string;
}

/** Writes the interview's questions from the job description and resume. */
export interface MockQuestionsRequest {
  /** What is being asked for. */
  kind: 'mock-questions';
  /** The session: its role, company, job description and documents. */
  session: SessionContext;
  /** How many questions. */
  count: number;
}

/** Gives brief feedback on one answer. */
export interface MockFeedbackRequest {
  /** What is being asked for. */
  kind: 'mock-feedback';
  /** The session. */
  session: SessionContext;
  /** The question asked. */
  question: string;
  /** What the user answered. */
  answer: string;
}

/** Sums up the whole interview. */
export interface MockSummaryRequest {
  /** What is being asked for. */
  kind: 'mock-summary';
  /** The session. */
  session: SessionContext;
  /** The answered questions, in order. */
  items: MockItem[];
}

/** Writes likely questions with suggested answers. */
export interface QuestionBankRequest {
  /** What is being asked for. */
  kind: 'question-bank';
  /** The session. */
  session: SessionContext;
}

/** Body of POST /api/prepare. */
export type PrepareRequest =
  MockQuestionsRequest | MockFeedbackRequest | MockSummaryRequest | QuestionBankRequest;

/** Reply to 'mock-questions'. */
export interface MockQuestionsResponse {
  /** The questions, in the order to ask them. */
  questions: string[];
}

/** Reply to 'mock-feedback'. */
export interface MockFeedbackResponse {
  /** Brief feedback for the user. */
  feedback: string;
}

/** Reply to 'mock-summary'. */
export interface MockSummaryResponse {
  /** What went well and what to work on, as short points. */
  summary: string[];
  /** What to practise next, as short points. */
  nextSteps: string[];
}

/** The kinds of question in a question bank. */
export type BankQuestionType = 'behavioural' | 'technical' | 'role' | 'company';

/** One likely question. */
export interface BankQuestion {
  /** The question. */
  question: string;
  /** A suggested answer, in the same lines as a live answer and the session's format. */
  answer: string;
}

/** Likely questions of one kind. */
export interface BankGroup {
  /** The kind of question. */
  type: BankQuestionType;
  /** The questions. */
  questions: BankQuestion[];
}

/** Reply to 'question-bank'. */
export interface QuestionBankResponse {
  /** The questions, by kind. */
  groups: BankGroup[];
}
