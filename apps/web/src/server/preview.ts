/**
 * File: apps/web/src/server/preview.ts
 * Purpose: Writes the Answer preview shown in the Answer preferences window: one invented interview
 *          question answered with the real answer rules and the chosen format, length, tone and
 *          language, so the preview shows what those settings really do.
 * Used by: app/api/preview/route.ts
 * Depends on: src/server/claude.ts (jsonReply), src/server/prompt.ts (rulesBlock, sessionBlock),
 *             @kite/shared (request types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 *
 * Everything in the request is a setting; the session and questions here are invented. It holds
 * none of the user's content.
 */
import 'server-only';
import {
  splitMetaLine,
  type AnswerPreviewRequest,
  type AnswerUsage,
  type PreviewQuestionType,
} from '@kite/shared';
import { jsonReply } from './claude';
import { rulesBlock, sessionBlock } from './prompt';

/** Most tokens a preview may write: enough for a "Detailed" answer. */
const PREVIEW_MAX_TOKENS = 800;

/** The invented question for each kind of preview. */
export const PREVIEW_QUESTIONS: Record<PreviewQuestionType, string> = {
  behavioural: 'Tell me about a time you disagreed with a teammate. How did you handle it?',
  technical: 'How would you find out why a database query has become slow?',
  general: 'Why are you interested in this role?',
};

/** The invented background the preview answers from. */
const PREVIEW_BACKGROUND = `Priya Rao, backend engineer, 6 years of experience. At Lantern Freight she cut report load time from 40 seconds to 3 by adding an index and rewriting a query, found using EXPLAIN plans. She disagreed with a teammate about a rewrite of the billing service, proposed a two-week trial on one endpoint, and the data settled it. She wants to work on larger systems and mentor junior engineers.`;

/**
 * Writes one preview.
 *
 * @param request The settings and which kind of question.
 * @param model   The fast model's name.
 * @returns The answer text and the token usage.
 * @throws What jsonReply() throws.
 * Called from: app/api/preview/route.ts; tests
 */
export async function generatePreview(
  request: AnswerPreviewRequest,
  model: string,
): Promise<{ text: string; usage: AnswerUsage }> {
  const session = sessionBlock({
    type: 'interview',
    company: 'Northwind Systems',
    role: 'Senior Backend Engineer',
    description: '',
    instructions: '',
    keyTerms: [],
    style: request.style,
    ...(request.language ? { language: request.language } : {}),
    documents: [{ name: 'resume.txt', text: PREVIEW_BACKGROUND }],
  });
  const { value, usage } = await jsonReply({
    model,
    tier: 'fast',
    system: rulesBlock([]),
    prompt: `${session}\n\nThe other person just asked: ${PREVIEW_QUESTIONS[request.question]}\n\nWrite the answer exactly as you would during the call, line by line, and put it in the "answer" field.`,
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
    maxTokens: PREVIEW_MAX_TOKENS,
  });
  // The answer rules open every reply with a hidden line (ADR-0030); the preview shows the answer.
  const answer = (value as { answer: string }).answer.trim();
  const split = splitMetaLine(answer);
  return { text: split.state === 'found' ? split.rest : answer, usage };
}
