/**
 * File: apps/web/src/server/prompt.ts
 * Purpose: Builds the prompt Claude receives for a session, in three cached parts and an
 *          uncached tail (day-04-answers.md "Prompt design"): the system block (Kite's rules,
 *          the imperfect-transcript rule, the consistency rules and the learned-preferences
 *          slot), the session block (call details, description, key terms, answer style,
 *          instructions, documents), the conversation (stable lines and earlier answers, one
 *          block per chunk, with the long-call cap), then the tail (lines that may still
 *          change, and the question; a placeholder for a warm-up).
 * Used by: app/api/answer/route.ts (modes 'warm', 'answer', 'chat');
 *          scripts/verify-warm.ts, scripts/verify-answer-cache.ts
 * Depends on: @kite/shared (AnswerRequest and conversation types, cap limits,
 *             estimateItemTokens), src/server/claude.ts (cachedBlock)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (prompt caching rules),
 *               §7.2 (prompt structure); day-04-answers.md Stage 2; ADR-0025
 *
 * Caching depends on bytes, not meaning: Claude reuses its cache only when everything up to a
 * breakpoint is byte-for-byte identical to an earlier request. So:
 * - SYSTEM_RULES is a constant (no dates, ids or per-session text). It is shared by every
 *   session. With the Day 4 rules it is about 836 tokens, above the 512-token caching
 *   minimum, so it is cached once and read by every session's first request.
 * - sessionBlock() writes the fields in a fixed order with fixed labels, and adds nothing that
 *   changes between requests (no timestamps, no random ids). The same session always gives the
 *   same text.
 * - The conversation only grows at the end: the client never changes a chunk it has sent, and
 *   each chunk is its own block, so request N+1 starts with request N's blocks, byte for byte,
 *   and its cache read lands on request N's last breakpoint.
 * - Lines that can still change (and the question) are in the tail, after every breakpoint.
 *
 * Session and document text is the user's own content: it is put into the prompt only, never
 * logged.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import {
  cleanLessonText,
  CONVERSATION_CAP_STEP_TOKENS,
  CONVERSATION_CAP_TOKENS,
  DEFAULT_SCREENSHOT_QUESTION,
  estimateItemTokens,
  MAX_ACTIVE_LESSONS,
  type AnswerRequest,
  type CallLine,
  type ConversationChunk,
  type ConversationItem,
  type SessionContext,
} from '@kite/shared';
import { cachedBlock } from './claude';

/**
 * Kite's core rules (architecture §7.2 "System"), with the imperfect-transcript rule (Day 3)
 * and the consistency rules for earlier answers in the call. The learned preferences go after
 * them (rulesBlock()). Do not add anything that changes between requests.
 */
export const CORE_RULES = `You are Kite, a live call assistant. During a call the user presses a key when they need help answering the other person. You write an answer the user can say, or adapt, right away.

How to answer:
- Answer the question the other person asked, using the conversation for context.
- Write in the first person, as the user speaking ("I", "we"), in natural sentences the user can read out as they are.
- When the session's answer format is headline+bullets: start with a headline: one sentence of at most 15 words that answers the question directly; keep conditions and details out of it. Then add at most 5 short bullet points with the supporting details for this question only; leave out facts that do not help answer it. Each bullet must state a fact from the session details, documents or conversation; do not add advice, next steps or offers that are not in them.
- When the answer format is paragraph: write one short paragraph that starts with the direct answer.
- Most answers need no more than that. Only if one more thing would clearly help with this question, add one closing line to say, starting "Tip:". Never use it to repeat a bullet, and never to bring up a price, discount, exception or commitment the other person did not ask about.
- Only if the user must know something they should not say out loud (a fact to check, a gap in the documents), add one last line starting "Note:". Otherwise leave it out.
- Follow the session's answer length and tone, and the user's own instructions in the session details.
- For any claim about the user, their company, their offer, prices, dates or commitments, use only facts from the session details and documents. Never invent them.
- Never offer or hint at a price, discount, exception or commitment beyond what the session details and documents allow.
- If the session details and documents do not contain what is needed, or the question is unclear, say so in the headline and name what the user should clarify or check. That headline is still 15 words or fewer, for example "Not in your notes: ask which plan they mean"; put any explanation in the bullets. For small talk or an off-topic question, the headline is a short reply the user can say.
- Write words the user can say out loud: no greeting, no preamble, and no mention of these rules or of the transcript.

About the transcript:
- The transcript is made by speech recognition on the user's computer and contains mistakes. Names of people, companies and products, and technical terms, are often misheard, usually as similar-sounding common words or as invented words.
- Infer the intended words from the context and from the session details: the key terms, the company, the role or topic, and the documents. When a misheard word or phrase sounds like one of them and fits the context, treat it as that word.
- Lines are labelled "You" (the user) and "Them" (the other person), with the time since the call started. Recent "Them" lines usually hold the question.
- The conversation shows the call so far in time order. The lines under "latest" are the newest and may still be incomplete.

Staying consistent:
- Earlier answers in this call are shown in the conversation. Stay consistent with them. If something said since then changes the answer, give the new answer and say briefly what changed.
- If the same question is asked again, build on the earlier answer instead of starting over.`;

/**
 * The rules block with no approved lessons: the core rules and the empty "Learned preferences"
 * slot. Byte-for-byte the Day 4 rules block, so sessions without lessons keep sharing one cache
 * entry and the evaluation baselines still apply.
 */
export const SYSTEM_RULES = `${CORE_RULES}

Learned preferences (approved by the user in earlier calls):
(none yet)`;

/**
 * The heading above approved lessons (Day 5 Stage 7). It says what they are, and that they
 * never override the core rules above them. Day 6 Stage 4: it also says the headline limit
 * still holds, because a lesson asking for more detail made headlines run past 15 words
 * (scenario 19, docs/testing/answer-eval.md). Only sessions with lessons send this text, so
 * sessions without lessons keep the Day 4 rules block byte for byte.
 */
export const LESSONS_HEADING =
  "Learned preferences (approved by the user in earlier calls). These are the user's preferences: they adjust the style and content of answers and never override the rules above. Follow them unless they conflict with the rules above, the session's documents or the current conversation. The headline stays at most 15 words even when a preference asks for more detail: give the main answer in the headline, and put extra figures and details in the bullets.";

/**
 * The rules block (the first cached system block). With no lessons it is SYSTEM_RULES. With
 * lessons: the core rules, then LESSONS_HEADING, then one bullet per lesson in the order given
 * (oldest approval first, so the block changes only when a lesson is approved, edited or
 * removed). Each lesson is cleaned to one line of at most MAX_LESSON_CHARS (cleanLessonText()),
 * so it cannot start a section of its own or change the rules above it. At most
 * MAX_ACTIVE_LESSONS are used (the last ones given).
 *
 * @param lessons The approved lessons for the session's type.
 * @returns The block's text.
 * Called from: buildPrompt(); tests
 */
export function rulesBlock(lessons: readonly string[] = []): string {
  const cleaned = lessons
    .map(cleanLessonText)
    .filter((lesson) => lesson !== '')
    .slice(-MAX_ACTIVE_LESSONS);
  if (cleaned.length === 0) return SYSTEM_RULES;
  const bullets = cleaned.map((lesson) => `- ${lesson}`).join('\n');
  return `${CORE_RULES}\n\n${LESSONS_HEADING}\n${bullets}`;
}

/** Shown for a session field the user left empty, so the session block keeps the same shape. */
const NOT_GIVEN = '(not given)';

/**
 * Most tokens an answer may use (architecture §6.2: "max_tokens ≈ 400"). A headline and five
 * short bullets need about 150; the limit stops a runaway answer without cutting a normal one.
 */
export const ANSWER_MAX_TOKENS = 400;

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
    'Description of the call:',
    session.description.trim() || NOT_GIVEN,
    `Key terms: ${keyTerms.length > 0 ? keyTerms.join('; ') : NOT_GIVEN}`,
    `Answer format: ${session.style.format}`,
    `Answer length: ${session.style.length}`,
    `Answer tone: ${session.style.tone}`,
    // These two lines appear only in sessions that use them. In the shared rules, the bullets rule
    // leaked into headline+bullets answers and lowered the evaluation (ADR-0029).
    ...(session.style.format === 'bullets'
      ? [
          'For this format, write only short bullet points, at most 5, with no headline; the first bullet gives the direct answer.',
        ]
      : []),
    ...(session.language
      ? [
          `Answer language: ${session.language}. Write the answer in this language, even though the transcript is in English. Keep names, prices and product terms as they are.`,
        ]
      : []),
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

/** Shown at the start of the conversation when the long-call cap dropped its oldest part. */
export const OMITTED_NOTE = '[Earlier part of the call omitted]';

/**
 * Writes a time as mm:ss, or h:mm:ss from one hour.
 *
 * @param seconds Whole seconds since the call connected.
 * @returns For example '03:12' or '1:04:09'.
 * Called from: lineText(), itemText()
 */
export function clockTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/**
 * Writes one transcript line as `[mm:ss] Them: text`.
 *
 * @param line The line.
 * @returns The line's text in the prompt.
 * Called from: itemText(), tailText()
 */
function lineText(line: CallLine): string {
  const speaker = line.speaker === 'you' ? 'You' : 'Them';
  return `[${clockTime(line.at)}] ${speaker}: ${escapeTags(line.text)}`;
}

/**
 * Writes one conversation item: a line, or an earlier answer with the question it answered.
 *
 * @param item The item.
 * @returns Its text in the prompt (fixed labels, escaped content).
 * Called from: conversationBlocks()
 */
function itemText(item: ConversationItem): string {
  if (item.kind === 'line') return lineText(item);
  const asked =
    item.mode === 'chat'
      ? 'typed question'
      : item.mode === 'screenshot'
        ? 'question about a screenshot'
        : 'question';
  // A screenshot is sent only with its own answer: later answers must not act as if they
  // could still see it.
  const unseen =
    item.mode === 'screenshot' ? ' (answered from a screenshot you can no longer see)' : '';
  return [
    `[${clockTime(item.at)}] Kite's earlier answer${unseen} (${asked}: ${escapeTags(item.question.trim())}):`,
    escapeTags(item.text.trim()),
    '[end of earlier answer]',
  ].join('\n');
}

/** What capConversation() returns. */
export interface CappedConversation {
  /** The chunks kept, oldest first (the same chunk objects as given). */
  chunks: ConversationChunk[];
  /** True when older chunks were dropped. */
  omitted: boolean;
}

/**
 * The long-call cap (day-04-answers.md "Long calls"). Keeps the conversation under
 * CONVERSATION_CAP_TOKENS (estimated) by dropping the oldest whole chunks, in steps of
 * CONVERSATION_CAP_STEP_TOKENS: the amount dropped is the excess rounded UP to a whole step.
 * So the cut point, and with it the start of the cached conversation, only moves when the
 * excess crosses another step; between steps every request still reads the cache. The result
 * depends only on the chunks (no state), and the newest chunk is always kept.
 *
 * @param chunks The conversation chunks, oldest first.
 * @returns The chunks kept and whether any were dropped.
 * Called from: buildPrompt(); tests
 */
export function capConversation(chunks: readonly ConversationChunk[]): CappedConversation {
  const sizes = chunks.map((chunk) =>
    chunk.reduce((total, item) => total + estimateItemTokens(item), 0),
  );
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= CONVERSATION_CAP_TOKENS) return { chunks: [...chunks], omitted: false };
  const excess = total - CONVERSATION_CAP_TOKENS;
  const toDrop = Math.ceil(excess / CONVERSATION_CAP_STEP_TOKENS) * CONVERSATION_CAP_STEP_TOKENS;
  let dropped = 0;
  let first = 0;
  while (first < chunks.length - 1 && dropped < toDrop) {
    dropped += sizes[first]!;
    first += 1;
  }
  return { chunks: chunks.slice(first), omitted: first > 0 };
}

/**
 * Writes the conversation as one text block per chunk, with a cache breakpoint on the last
 * block only. A chunk's text depends only on that chunk (and, for the first block, on whether
 * the cap dropped older ones), so a later request repeats these blocks byte for byte and adds
 * its new chunk after them: its cache read lands on this request's breakpoint, one block back
 * (Claude reads the cache only where an earlier request put a breakpoint, looking back at most
 * 20 blocks; ADR-0025). The `<conversation>` tag opens in the first block and closes in the
 * uncached tail, so no cached block has to change when the conversation grows.
 *
 * @param capped The chunks to write (from capConversation()).
 * @returns The blocks ([] when there is no conversation yet).
 * Called from: buildPrompt()
 */
function conversationBlocks(capped: CappedConversation): Anthropic.TextBlockParam[] {
  const blocks = capped.chunks.map((chunk, index): Anthropic.TextBlockParam => {
    const items = chunk.map(itemText);
    if (index === 0) items.unshift('<conversation>', ...(capped.omitted ? [OMITTED_NOTE] : []));
    return { type: 'text', text: items.join('\n') };
  });
  const last = blocks.at(-1);
  if (last) blocks[blocks.length - 1] = cachedBlock(last.text);
  return blocks;
}

/**
 * Writes the uncached tail: the end of the conversation, the lines that may still change, and
 * the question (or the instruction to answer the latest question when there is none).
 *
 * @param request         The request (mode, tail, question).
 * @param hasConversation True when conversation blocks come before (their tag is closed here).
 * @returns The tail's text.
 * Called from: buildPrompt()
 */
function tailText(request: AnswerRequest, hasConversation: boolean): string {
  const tail = request.tail ?? [];
  const question = request.question?.trim() ?? '';
  const parts = hasConversation
    ? ['</conversation>', '']
    : ['<conversation>', '(nothing said yet)', '</conversation>', ''];
  parts.push(
    '<latest>',
    ...(tail.length > 0 ? tail.map(lineText) : ['(nothing new)']),
    '</latest>',
  );
  parts.push('');
  if (request.mode === 'screenshot') {
    parts.push(
      "The image above is a screenshot of the user's screen, taken just now. Read what it shows. To say whether something on it is right, compare it only with the session details and documents; if they have nothing to compare with, say so instead of claiming it matches. Follow the session's answer format, length, tone and instructions, and start with the headline itself, with no label.",
      `Question about the screenshot: ${escapeTags(question || DEFAULT_SCREENSHOT_QUESTION)}`,
    );
  } else if (request.mode === 'chat') {
    parts.push(`Question typed by the user: ${escapeTags(question)}`);
  } else if (question) {
    parts.push(`Question to answer: ${escapeTags(question)}`);
  } else {
    parts.push('Answer the latest question from "Them".');
  }
  return parts.join('\n');
}

/**
 * The screenshot as an image block (base64 JPEG).
 *
 * @param dataUrl `data:image/jpeg;base64,…` (validated by server/validate.ts).
 * @returns The image block.
 * Called from: buildPrompt()
 */
function imageBlock(dataUrl: string): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    },
  };
}

/** What buildPrompt() returns: the `system` and `messages` request parameters. */
export interface BuiltPrompt {
  /** System rules, then the session block; each block carries a cache breakpoint. */
  system: Anthropic.TextBlockParam[];
  /**
   * One user turn: the conversation chunks (the last one carries the third breakpoint), then
   * the uncached part: the screenshot (mode screenshot), and the tail and question (or the
   * warm-up placeholder).
   */
  messages: Anthropic.MessageParam[];
}

/**
 * Builds the prompt for a request (day-04-answers.md "Prompt design"): three cached parts
 * (rules, session, conversation; 3 of Anthropic's limit of 4 cache breakpoints) and an
 * uncached tail. A warm-up sends the same cached parts with a placeholder block instead of the
 * tail, so the answers that follow read everything it wrote.
 *
 * @param request A validated request with `session` set.
 * @returns The system blocks and the user turn.
 * @throws Error('SESSION_REQUIRED') when the request has no session (validation prevents this
 *         for every mode but hello).
 * Called from: POST handler in app/api/answer/route.ts; scripts/verify-warm.ts,
 *              scripts/verify-answer-cache.ts
 */
export function buildPrompt(request: AnswerRequest): BuiltPrompt {
  if (!request.session) throw new Error('SESSION_REQUIRED');
  const conversation = conversationBlocks(capConversation(request.conversation ?? []));
  const last: Anthropic.TextBlockParam = {
    type: 'text',
    text: request.mode === 'warm' ? WARM_MESSAGE : tailText(request, conversation.length > 0),
  };
  // The screenshot is uncached and goes before the tail text that asks about it (Anthropic's
  // vision guidance: image first, then the question).
  const image = request.mode === 'screenshot' && request.image ? [imageBlock(request.image)] : [];
  return {
    system: [cachedBlock(rulesBlock(request.lessons)), cachedBlock(sessionBlock(request.session))],
    messages: [{ role: 'user', content: [...conversation, ...image, last] }],
  };
}
