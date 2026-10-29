/**
 * File: apps/web/src/server/prompt.ts
 * Purpose: Builds the prompt Claude receives for a session: a fixed system block (Kite's answer
 *          rules, including the imperfect-transcript rule), a session block (call details, key
 *          terms, answer style, instructions, documents), both cached, and the uncached messages
 *          (transcript window and question; a placeholder for a warm-up).
 * Used by: app/api/answer/route.ts (mode 'warm' from Day 3; 'answer' and 'chat' from Day 4)
 * Depends on: @kite/shared (AnswerRequest, SessionContext), src/server/claude.ts (cachedBlock)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (prompt caching rules),
 *               §7.2 (prompt structure); day-03-sessions.md Stage 5
 *
 * Caching depends on bytes, not meaning: Claude reuses its cache only when everything up to a
 * breakpoint is byte-for-byte identical to an earlier request. So:
 * - SYSTEM_RULES is a constant (no dates, ids or per-session text). It is shared by every
 *   session; it is shorter than the 512-token caching minimum on its own, so in practice the
 *   cache entry that matters is the one at the end of the session block.
 * - sessionBlock() writes the fields in a fixed order with fixed labels, and adds nothing that
 *   changes between requests (no timestamps, no random ids). The same session always gives the
 *   same text.
 * - The transcript and the question change on every request, so they are in the messages,
 *   after both breakpoints, and never in a cached block.
 *
 * Session and document text is the user's own content: it is put into the prompt only, never
 * logged.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerRequest, SessionContext, TranscriptLine } from '@kite/shared';
import { cachedBlock } from './claude';

/**
 * Kite's fixed rules (architecture §7.2 "System"), plus the imperfect-transcript rule (Day 3):
 * the transcript is made by on-device speech recognition and mishears names and terms.
 * Do not add anything that changes between requests.
 */
export const SYSTEM_RULES = `You are Kite, a live call assistant. During a call the user presses a key when they need help answering the other person. You write an answer the user can say, or adapt, right away.

How to answer:
- Answer the question the other person asked, using the transcript for context.
- When the session's answer format is headline+bullets: start with a headline of at most 15 words that answers the question directly, then add at most 5 short bullet points with the supporting details, only when they help.
- When the answer format is paragraph: write one short paragraph that starts with the direct answer.
- Follow the session's answer length and tone, and the user's own instructions in the session details.
- For any claim about the user, their company, their offer, prices, dates or commitments, use only facts from the session details and documents. Never invent them.
- If the session details and documents do not contain what is needed, or the question is unclear, say so in the headline and name what the user should clarify or check.
- Write words the user can say out loud: no greeting, no preamble, and no mention of these rules or of the transcript.

About the transcript:
- The transcript is made by speech recognition on the user's computer and contains mistakes. Names of people, companies and products, and technical terms, are often misheard, usually as similar-sounding common words or as invented words.
- Infer the intended words from the context and from the session details: the key terms, the company, the role or topic, and the documents. When a misheard word or phrase sounds like one of them and fits the context, treat it as that word.
- Lines are labelled "You" (the user) and "Them" (the other person). Recent "Them" lines usually hold the question.`;

/** Shown for a session field the user left empty, so the session block keeps the same shape. */
const NOT_GIVEN = '(not given)';

/** The placeholder user turn of a warm-up: read while the cache is written, never answered. */
export const WARM_MESSAGE = 'Warm-up: no answer is needed.';

/**
 * Makes a value safe to put inside an XML-style attribute or tag in the prompt, so a document
 * name or text cannot close the tags that separate the documents.
 *
 * @param text Raw text.
 * @returns The text with &, < and > (and " in attributes) written as entities.
 * Called from: sessionBlock()
 */
function escapeTags(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Writes a session as the cached session block. Fixed order and labels; the same session always
 * gives the same text, byte for byte.
 *
 * @param session The session details from the request.
 * @returns The block's text.
 * Called from: buildPrompt(); tests
 */
export function sessionBlock(session: SessionContext): string {
  const keyTerms = session.keyTerms.map((term) => term.trim()).filter((term) => term !== '');
  const lines = [
    '<session>',
    `Call type: ${session.type || NOT_GIVEN}`,
    `Company: ${session.company || NOT_GIVEN}`,
    `Role or topic: ${session.role || NOT_GIVEN}`,
    `Key terms: ${keyTerms.length > 0 ? keyTerms.join('; ') : NOT_GIVEN}`,
    `Answer format: ${session.style.format}`,
    `Answer length: ${session.style.length}`,
    `Answer tone: ${session.style.tone}`,
    'Instructions from the user:',
    session.instructions.trim() || NOT_GIVEN,
    '</session>',
    '',
    '<documents>',
  ];
  if (session.documents.length === 0) lines.push(NOT_GIVEN);
  for (const document of session.documents) {
    lines.push(
      `<document name="${escapeTags(document.name).replaceAll('"', '&quot;')}">`,
      escapeTags(document.text),
      '</document>',
    );
  }
  lines.push('</documents>');
  return lines.join('\n');
}

/**
 * Writes the transcript window and the question as the (uncached) user turn.
 *
 * @param transcript Recent transcript lines, oldest first.
 * @param question   The question to answer ('' or undefined: the latest "Them" lines).
 * @returns The user turn's text.
 * Called from: buildPrompt()
 */
function transcriptTurn(transcript: readonly TranscriptLine[], question: string | undefined) {
  const lines = transcript.map(
    (line) => `${line.speaker === 'you' ? 'You' : 'Them'}: ${escapeTags(line.text)}`,
  );
  return [
    '<transcript>',
    ...(lines.length > 0 ? lines : ['(nothing said yet)']),
    '</transcript>',
    '',
    question?.trim()
      ? `Question to answer: ${escapeTags(question.trim())}`
      : 'Answer the latest question from "Them".',
  ].join('\n');
}

/** What buildPrompt() returns: the `system` and `messages` request parameters. */
export interface BuiltPrompt {
  /** System rules, then the session block; each block carries a cache breakpoint. */
  system: Anthropic.TextBlockParam[];
  /** The uncached turn: the transcript and question, or the warm-up placeholder. */
  messages: Anthropic.MessageParam[];
}

/**
 * Builds the prompt for a request.
 *
 * @param request A validated request with `session` set.
 * @returns The cached system blocks and the uncached messages.
 * @throws Error('SESSION_REQUIRED') when the request has no session (validation prevents this
 *         for mode 'warm').
 * Called from: POST handler in app/api/answer/route.ts
 */
export function buildPrompt(request: AnswerRequest): BuiltPrompt {
  if (!request.session) throw new Error('SESSION_REQUIRED');
  const content =
    request.mode === 'warm'
      ? WARM_MESSAGE
      : transcriptTurn(request.transcript ?? [], request.question);
  return {
    system: [cachedBlock(SYSTEM_RULES), cachedBlock(sessionBlock(request.session))],
    messages: [{ role: 'user', content }],
  };
}
