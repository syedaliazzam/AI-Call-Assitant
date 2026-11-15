/**
 * File: apps/web/tests/eval/groups/types.ts
 * Purpose: The shape of an evaluation scenario, shared by the JSON files in tests/eval/scenarios and
 *          the scenario groups written in TypeScript here (which share invented sessions), and a
 *          helper that builds an invented session.
 * Used by: scripts/eval-answers.ts, tests/eval/groups/*.ts
 * Depends on: @kite/shared (types)
 * Architecture: docs/testing/answer-eval.md
 */
import type {
  AnswerTarget,
  AnswerType,
  CallLine,
  ConversationChunk,
  KiteTurn,
  SessionContext,
  SessionDocument,
} from '@kite/shared';

/** One evaluation scenario. */
export interface Scenario {
  /** Its id (a JSON scenario's file name without .json). */
  id: string;
  /** What it tests. */
  covers: string;
  /** Its evaluation group, when it is not worked out from the rest. */
  group?: string;
  /** The session details (for a page scenario, only what the grader should read). */
  session: SessionContext;
  /** The call so far. */
  conversation: ConversationChunk[];
  /** Lines not yet stable. */
  tail: CallLine[];
  /** 'answer', 'chat', 'screenshot' or 'kite' (the Ask Kite page). */
  mode: 'answer' | 'chat' | 'screenshot' | 'kite';
  /** Screenshot scenarios: the invented image, relative to tests/eval. */
  image?: string;
  /** Screenshot scenarios: what the image shows, in words, for the grader. */
  imageDescription?: string;
  /**
   * Company AI instructions for the live answers (Admin → AI settings, ADR-0083), sent after the
   * locked rules as the page would; absent for none.
   */
  company?: string;
  /** Lesson scenarios: the approved lessons sent with the answer. */
  lessons?: string[];
  /** The question. */
  question: string;
  /** What a good answer must contain. */
  mustInclude: string[];
  /** What it must not contain. */
  mustNotInclude: string[];
  /** The question type the hidden line should name (any of them, when several are fair). */
  expectType?: AnswerType | AnswerType[];
  /** Who the answer should be for. */
  expectTarget?: AnswerTarget;
  /** The chat switch's choice, when the scenario fixes it. */
  target?: AnswerTarget;
  /** True when the answer must have code that runs in the sandbox. */
  expectCode?: boolean;
  /** Consistency scenarios: asked after the first answer, which goes in the conversation. */
  repeat?: string;
  /** Page scenarios: the chat so far. */
  history?: KiteTurn[];
  /** Page scenarios: what is attached to the chat. */
  attachments?: SessionDocument[];
}

/**
 * An invented session: the fields a scenario does not care about have plain defaults.
 *
 * @param fields The session's type, company, role, description and documents.
 * @returns The session details.
 * Called from: tests/eval/groups/*.ts
 */
export function inventedSession(
  fields: Pick<SessionContext, 'type' | 'company' | 'role' | 'description' | 'documents'> &
    Partial<SessionContext>,
): SessionContext {
  return {
    instructions: '',
    keyTerms: [],
    style: { format: 'headline+bullets', length: 'short', tone: 'professional' },
    ...fields,
  };
}
