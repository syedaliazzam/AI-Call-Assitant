/**
 * File: apps/web/src/server/prompt.ts
 * Purpose: Builds the prompt Claude receives for a live answer, in three cached parts and an uncached
 *          tail (day-04-answers.md "Prompt design"; ADR-0089 order): the rules block (the locked app
 *          contract, then the admin's global prompt for live answers), the session block (call details,
 *          then the user's preferences under a heading that says they override the general rules, with
 *          the approved lessons and the user's instructions, then the documents), the conversation
 *          (stable lines and earlier answers, one block per chunk, with the long-call cap), then the tail
 *          (lines that may still change, the question, and the automatic end reminder; a placeholder for
 *          a warm-up).
 * Used by: app/api/answer/route.ts (modes 'warm', 'answer', 'chat', 'screenshot');
 *          scripts/verify-warm.ts, scripts/verify-answer-cache.ts,
 *          scripts/eval-answers.ts
 * Depends on: @kite/shared (AnswerRequest and conversation types, cap limits, estimateItemTokens),
 *             src/server/claude.ts (cachedBlock), src/server/budget.ts, src/server/prompts/contract.ts
 *             (contract, end reminder), src/server/prompts/defaults.ts, src/server/prompts/preferences.ts,
 *             src/server/prompts/rules-previous.ts (the rollback rules, ADR-0032)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (prompt caching rules),
 *               §7.2 (prompt structure); day-04-answers.md Stage 2; ADR-0025; ADR-0089
 *
 * Caching depends on bytes, not meaning: Claude reuses its cache only when everything up to a
 * breakpoint is byte-for-byte identical to an earlier request. So:
 * - The rules block depends only on the global prompt version the call pinned when it started
 *   (ADR-0083, ADR-0089), so it is the same for every request of a call, and shared by every session.
 * - sessionBlock() writes the fields in a fixed order with fixed labels, and adds nothing that
 *   changes between requests (no timestamps, no random ids). The same session (and lessons) always
 *   gives the same text.
 * - The conversation only grows at the end: the client never changes a chunk it has sent, and
 *   each chunk is its own block, so request N+1 starts with request N's blocks, byte for byte,
 *   and its cache read lands on request N's last breakpoint.
 * - Lines that can still change, the question and the end reminder are in the tail, after every
 *   breakpoint.
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
  type AnswerStyleVersion,
  type CallLine,
  type ConversationChunk,
  type ConversationItem,
  type SessionContext,
} from '@kite/shared';
import { capSessionDocuments, fitToBudget } from './budget';
import { cachedBlock } from './claude';
import {
  LIVE_CONTRACT,
  liveEndReminder,
  SCREEN_ONLY_QUESTION,
  SCREEN_ONLY_TAIL,
  SCREENSHOT_TAIL,
  withGlobalPrompt,
} from './prompts/contract';
import { DEFAULT_LIVE_PROMPT } from './prompts/defaults';
import { noCvMatchLines, type PromptOptions } from './prompts/experience';
import {
  DEFAULT_CODING_LANGUAGE,
  formatPreference,
  lengthPreference,
  PREFERENCES_HEADING,
} from './prompts/preferences';
import { CALL_REMINDER_PREVIOUS, CORE_RULES_PREVIOUS } from './prompts/rules-previous';

/**
 * The rules block of v-previous with no approved lessons (ADR-0032), byte for byte the block the
 * earlier baselines were measured on, so a rollback still sends it.
 */
export const SYSTEM_RULES_PREVIOUS = `${CORE_RULES_PREVIOUS}

Learned preferences (approved by the user in earlier calls):
(none yet)`;

/**
 * The heading above approved lessons in a rollback (v-previous) rules block (Day 5 Stage 7, Day 6
 * Stage 4). Kept word for word for the rollback; current rules put lessons in the user's preferences
 * under LEARNED_HEADING.
 */
export const LESSONS_HEADING =
  "Learned preferences (approved by the user in earlier calls). These are the user's preferences: they adjust the style and content of answers and never override the rules above. Follow them unless they conflict with the rules above, the session's documents or the current conversation. The headline stays at most 12 words even when a preference asks for more detail: give the main answer in the headline, and put extra figures and details in the bullets.";

/**
 * ADR-0089: the heading above approved lessons inside the user's preferences (current rules). They are
 * the user's own choices, so they win over the general rules like the other preferences, but they
 * change style and content only: never the facts, and never the answer line's length (Day 6 Stage 4:
 * a lesson asking for more detail made answer lines run long).
 */
export const LEARNED_HEADING =
  'Learned preferences (approved by the user in earlier calls): they adjust the style and content of answers, never the facts, and the answer line stays at most 12 words even when one asks for more detail: give the main answer there, and put extra figures and details in the lines after it.';

/** The empty "Learned preferences" slot that ends SYSTEM_RULES_PREVIOUS (sessions with no lessons). */
const NO_LESSONS = 'Learned preferences (approved by the user in earlier calls):\n(none yet)';

/**
 * The approved lessons, cleaned to one line each (cleanLessonText(), so a lesson cannot start a section
 * of its own), at most MAX_ACTIVE_LESSONS (the last ones given, oldest approval first, so the text
 * changes only when a lesson is approved, edited or removed).
 *
 * @param lessons The approved lessons for the session's type.
 * @returns The cleaned lessons.
 * Called from: rulesBlock(), sessionLines()
 */
function cleanLessons(lessons: readonly string[]): string[] {
  return lessons
    .map(cleanLessonText)
    .filter((lesson) => lesson !== '')
    .slice(-MAX_ACTIVE_LESSONS);
}

/**
 * The rules block (the first cached system block). Current rules (ADR-0089): the locked app contract,
 * then the admin's global prompt for live answers under its heading; it holds nothing per session, so
 * every session of a version shares one cache entry. Rollback (v-previous, ADR-0032): the old core rules
 * with the lessons, byte for byte as before.
 *
 * @param globalPrompt The global prompt the call pinned (DEFAULT_LIVE_PROMPT when none was saved; '' sends
 *                     the contract alone).
 * @param version      'previous' uses the v-previous rules kept for the rollback switch (ADR-0032).
 * @param lessons      Rollback only: the approved lessons (current rules put them in the session block).
 * @returns The block's text.
 * Called from: buildPromptParts(); tests
 */
export function rulesBlock(
  globalPrompt: string = DEFAULT_LIVE_PROMPT,
  version: AnswerStyleVersion = 'current',
  lessons: readonly string[] = [],
): string {
  if (version !== 'previous') return withGlobalPrompt(LIVE_CONTRACT, globalPrompt);
  const cleaned = cleanLessons(lessons);
  if (cleaned.length === 0) return `${CORE_RULES_PREVIOUS}\n\n${NO_LESSONS}`;
  const bullets = cleaned.map((lesson) => `- ${lesson}`).join('\n');
  return `${CORE_RULES_PREVIOUS}\n\n${LESSONS_HEADING}\n${bullets}`;
}

/** Shown for a session field the user left empty, so the session block keeps the same shape. */
const NOT_GIVEN = '(not given)';

/**
 * Most tokens an answer may use. A headline and five short bullets need about 150. A coding answer
 * (steps, complexity, edge cases, code, what to say) and a private answer need far more (ADR-0030);
 * the limit only stops a runaway reply, and the shape rules keep ordinary answers short.
 * ADR-0121: screenshot answers have their own, larger limit (SCREENSHOT_MAX_TOKENS).
 */
export const ANSWER_MAX_TOKENS = 1_500;

/**
 * ADR-0121: most tokens a screenshot answer may use (mode 'screenshot': Ctrl+Shift+Enter, the Screenshot
 * button, and Ctrl+Alt+Enter with a spoken question). A coding problem on screen is answered with the
 * approach, the steps, the whole code, the complexity and a "Say" line (ADR-0107). Measured on 25 Nov 2026
 * (Claude Haiku, an invented Java scheduler problem): cut off at 1,500 in 2 of 2 runs, with the code block
 * left open; 1,995–2,437 tokens when allowed to finish. 4,000 is about 1.6 times the longest; only the
 * tokens written are billed, and Claude Sonnet writes 4,000 in about 25 s, inside the 60 s limit. The
 * first word comes as fast as before: the limit does not change the prompt.
 */
export const SCREENSHOT_MAX_TOKENS = 4_000;

/**
 * ADR-0121: the output limit for a live reply of this mode.
 *
 * @param mode The request's mode ('kite' has its own limit and is not passed here).
 * @returns SCREENSHOT_MAX_TOKENS for 'screenshot', else ANSWER_MAX_TOKENS.
 * Called from: app/api/answer/route.ts; tests
 */
export function liveMaxTokens(mode: AnswerRequest['mode']): number {
  return mode === 'screenshot' ? SCREENSHOT_MAX_TOKENS : ANSWER_MAX_TOKENS;
}

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
 * Writes a session's details (everything but the documents) as the `<session>` part of the session
 * block: the call's details, the experience rules where they apply (locked, ADR-0084), then the user's
 * preferences under PREFERENCES_HEADING (ADR-0089, ADR-0103: they decide format, length, tone, language
 * and focus over the admin's general rules, never over the contract or the never-invent rules): format and length with their meaning, tone, the optional lines, the coding language, the
 * approved lessons (live answers) and the user's instructions. Fixed order and labels; the same session
 * always gives the same lines.
 *
 * @param session The session details from the request.
 * @param lessons Live answers: the approved lessons ([] for none, and for the smart-model routes).
 * @returns The lines, from '<session>' to '</session>'.
 * Called from: sessionBlock(), smartSessionBlock()
 */
function sessionLines(session: SessionContext, lessons: readonly string[] = []): string[] {
  const keyTerms = session.keyTerms.map((term) => term.trim()).filter((term) => term !== '');
  const learned = cleanLessons(lessons);
  return [
    '<session>',
    `Call type: ${session.type || NOT_GIVEN}`,
    `Company: ${session.company || NOT_GIVEN}`,
    `Role or topic: ${session.role || NOT_GIVEN}`,
    // ADR-0093: only with a name, so a session without one keeps its bytes (and cache entry).
    ...(session.themName
      ? [
          `The other person ("Them" in these rules) is ${session.themName}: their lines are labelled "${session.themName}".`,
        ]
      : []),
    'Description of the call:',
    session.description.trim() || NOT_GIVEN,
    `Key terms: ${keyTerms.length > 0 ? keyTerms.join('; ') : NOT_GIVEN}`,
    // ADR-0084: the experience rules, only where questions about the user's own past belong
    // (experienceApplies()). Locked honesty rules, so they sit before the user's preferences.
    ...(experienceApplies(session) ? [EXPERIENCE_RULES] : []),
    PREFERENCES_HEADING,
    // Each value with its meaning (prompts/preferences.ts), so the admin's text cannot redefine it.
    `Answer format: ${formatPreference(session)}`,
    `Answer length: ${lengthPreference(session)}`,
    `Answer tone: ${session.style.tone}`,
    // v1.2.0: only when the session asks for it. The honesty rule stays: a part the CV does not
    // state is left out, never invented (ADR-0032).
    ...(session.style.star
      ? [
          'For behavioural questions in this session, structure the answer as Situation, Task, Action and Result, one bullet each, starting with those words, built from the closest real project in the CV. If the CV does not state a part, leave that bullet out rather than invent it.',
        ]
      : []),
    ...(session.language
      ? [
          `Answer language: ${session.language}. Write the answer in this language, even though the transcript is in English. Keep names, prices and product terms as they are.`,
        ]
      : []),
    `Coding language: ${session.codingLanguage || DEFAULT_CODING_LANGUAGE}.`,
    ...(session.missingInfo === 'story'
      ? [
          'Missing information: when nothing in the CV is close, tell one plausible example story in the first person and set source to example. Keep its details generic: no company names, no numbers of any kind (no durations, counts or percentages), no named results.',
        ]
      : []),
    ...(learned.length > 0 ? [LEARNED_HEADING, ...learned.map((lesson) => `- ${lesson}`)] : []),
    'Instructions from the user:',
    session.instructions.trim() || NOT_GIVEN,
    '</session>',
  ];
}

/**
 * Writes documents as the `<documents>` part of the session block, in the order given (the CV
 * first: core/answer/warm.ts toSessionContext() sorts them).
 *
 * @param documents The documents.
 * @returns The lines, from '<documents>' to '</documents>'.
 * Called from: sessionBlock(), smartSessionBlock()
 */
function documentLines(documents: SessionContext['documents']): string[] {
  const lines = ['<documents>'];
  if (documents.length === 0) lines.push(NOT_GIVEN);
  for (const document of documents) {
    lines.push(
      `<document name="${escapeTags(document.name).replaceAll('"', '&quot;')}">`,
      escapeTags(document.text),
      '</document>',
    );
  }
  lines.push('</documents>');
  return lines;
}

/**
 * Writes documents as one `<documents>` block, escaped like the session block.
 *
 * @param documents The documents.
 * @returns The block's text.
 * Called from: summaryPrompt() in server/summary.ts
 */
export function documentsBlock(documents: SessionContext['documents']): string {
  return documentLines(documents).join('\n');
}

/**
 * Writes a session as a session block with every document in full: the details (and, for live answers,
 * the approved lessons in the preferences), then the documents. Fixed order and labels; the same session
 * always gives the same text, byte for byte.
 *
 * @param session The session details from the request.
 * @param lessons Live answers: the approved lessons ([] for none).
 * @returns The block's text.
 * Called from: smartSessionBlock() (older pages); scripts/eval-answers.ts (the grader); tests
 */
export function sessionBlock(session: SessionContext, lessons: readonly string[] = []): string {
  return [...sessionLines(session, lessons), '', ...documentLines(session.documents)].join('\n');
}

/**
 * The heading over the documents summary in smartSessionBlock(). It says the summary is shorter
 * than the documents, so the smart model does not read a missing detail as absent from them.
 */
export const SUMMARY_HEADING =
  'Summary of the other documents (written from the full documents; a detail not in it may still be in them):';

/**
 * Writes a session for the routes that send a documents summary (ADR-0067; live answers since ADR-0078):
 * the details (the job description, the user's preferences and instructions included), the documents
 * sent (only the CV from a current page) in full, then the short summary of the other documents. A
 * request without `documentsSummary` comes from a page older than ADR-0067 and gets sessionBlock().
 *
 * @param session The session details from the request.
 * @param lessons Live answers: the approved lessons, in the preferences ([] for none).
 * @returns The block's text.
 * Called from: buildPromptParts(), notesPrompt() in server/notes.ts, answerAboutCall() in server/ask.ts,
 *              systemBlocks() in server/prepare.ts; tests
 */
export function smartSessionBlock(
  session: SessionContext,
  lessons: readonly string[] = [],
): string {
  if (session.documentsSummary === undefined) return sessionBlock(session, lessons);
  const summary = session.documentsSummary.trim();
  return [
    ...sessionLines(session, lessons),
    '',
    ...documentLines(session.documents),
    '',
    '<documents_summary>',
    ...(summary ? [SUMMARY_HEADING, escapeTags(summary)] : [NOT_GIVEN]),
    '</documents_summary>',
  ].join('\n');
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

/** The other person's speaker label when the session gives no name for them. */
export const THEM_SPEAKER = 'Them';

/**
 * The other person's speaker label in the prompt (ADR-0093): their name when the request has one, else
 * "Them" (so a request without a name is byte for byte what it was).
 *
 * @param session The session details, if any.
 * @returns For example "Sarah" or "Them".
 * Called from: buildPromptParts(), tailText(); server/notes.ts callRecord()
 */
export function themSpeaker(session: Pick<SessionContext, 'themName'> | undefined): string {
  return session?.themName || THEM_SPEAKER;
}

/**
 * Writes one transcript line as `[mm:ss] Them: text` (ADR-0093: the other person's name instead of
 * "Them" when the session gives one).
 *
 * @param line  The line.
 * @param them  The other person's speaker label (themSpeaker()).
 * @returns The line's text in the prompt.
 * Called from: itemText(), tailText()
 */
function lineText(line: CallLine, them: string): string {
  const speaker = line.speaker === 'you' ? 'You' : them;
  return `[${clockTime(line.at)}] ${speaker}: ${escapeTags(line.text)}`;
}

/**
 * Writes one conversation item: a line, or an earlier answer with the question it answered.
 *
 * @param item The item.
 * @param them The other person's speaker label (themSpeaker(), ADR-0093).
 * @returns Its text in the prompt (fixed labels, escaped content).
 * Called from: conversationBlocks()
 */
function itemText(item: ConversationItem, them: string): string {
  if (item.kind === 'line') return lineText(item, them);
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
  // A private answer was read by the user, not said: the other person has not heard it.
  const heard = item.target === 'kite' ? ' (private, not said on the call)' : '';
  return [
    `[${clockTime(item.at)}] Kite's earlier answer${unseen}${heard} (${asked}: ${escapeTags(item.question.trim())}):`,
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
 * @param them   The other person's speaker label (themSpeaker(), ADR-0093).
 * @returns The blocks ([] when there is no conversation yet).
 * Called from: buildPrompt()
 */
function conversationBlocks(capped: CappedConversation, them: string): Anthropic.TextBlockParam[] {
  const blocks = capped.chunks.map((chunk, index): Anthropic.TextBlockParam => {
    const items = chunk.map((item) => itemText(item, them));
    if (index === 0) items.unshift('<conversation>', ...(capped.omitted ? [OMITTED_NOTE] : []));
    return { type: 'text', text: items.join('\n') };
  });
  const last = blocks.at(-1);
  if (last) blocks[blocks.length - 1] = cachedBlock(last.text);
  return blocks;
}

/** The session types the experience rules are for: interviews, mock interviews and a blank session (no type). */
export const EXPERIENCE_SESSION_TYPES: readonly string[] = ['interview', 'mock', ''];

/**
 * ADR-0084: the experience rules, a line of the session block in interview, mock and blank (no type)
 * sessions only (experienceApplies()). Locked like the core rules, and never in regular calls: in the
 * shared rules block every wording moved unrelated regular-call answers (answer-eval.md, 15 Nov 2026).
 */
export const EXPERIENCE_RULES = `Questions about your own past: use the closest real project in the CV, told exactly as the CV states it, with nothing added. For a behavioural question, close means the CV states the same kind of situation (a difficult client needs work with a client or customer), not only the same field. With nothing close (or no CV), the answer is your approach: the answer line starts "I would" or "I'd" and never claims past experience ("I handled…", "I've dealt with…", "In my experience…"), every line stays in that voice, source is general, and an unrelated real project appears in at most one bullet, exactly as the CV states it. A shape such as "always use STAR", from the company or the session, applies only to a close CV project; without one it may order the approach's steps, never as a story.`;

/**
 * Whether a session gets the experience rules (EXPERIENCE_RULES, EXPERIENCE_REMINDER): an interview, a
 * mock interview or a blank session (no type), unless the user chose "Full example story", whose own line
 * asks for a story.
 *
 * @param session The session.
 * @returns True when they apply.
 * Called from: sessionLines(), experienceReminder(); tests
 */
export function experienceApplies(session: SessionContext): boolean {
  return EXPERIENCE_SESSION_TYPES.includes(session.type) && session.missingInfo !== 'story';
}

/**
 * ADR-0084: added after the end reminder (liveEndReminder()) for interview, mock and blank (no type) sessions only
 * (experienceReminder()). With no close CV project, an experience question gets an "I would…" approach,
 * never a made-up story, whatever shape the company or session asks for. Not in regular calls: there
 * the same words leaked into sales answers as "I don't have…" lines (answer-eval.md, 15 Nov 2026).
 */
export const EXPERIENCE_REMINDER = `For a question about your own past: tell only a close CV project; with none, answer only as your approach, the answer line starting "I would" or "I'd" and never claiming past experience, never as a past story, whatever shape the instructions ask for.`;

/**
 * Whether a request gets EXPERIENCE_REMINDER: current rules, an answer or typed question (not a
 * screenshot), an interview, mock or blank session, and not the user's "Full example story" setting
 * (whose own session line asks for a story).
 *
 * @param request The answer request.
 * @returns The reminder lines to add ([] or [EXPERIENCE_REMINDER]).
 * Called from: the request text in buildPrompt(); tests
 */
export function experienceReminder(request: AnswerRequest): string[] {
  const session = request.session;
  return request.styleVersion !== 'previous' &&
    request.mode !== 'screenshot' &&
    session !== undefined &&
    experienceApplies(session)
    ? [EXPERIENCE_REMINDER]
    : [];
}

/**
 * What a screenshot answer is told in v-previous (ADR-0032): kept word for word, so a rollback sends
 * the bytes its baselines were measured on.
 */
const SCREENSHOT_RULES_PREVIOUS =
  "The image above is a screenshot of the user's screen, taken just now. Read what it shows. To say whether something on it is right, compare it only with the session details and documents; if they have nothing to compare with, do not claim it matches, and say what you would check. After the hidden line, follow the session's answer format, length, tone and instructions when the answer is for the call, and start with the headline itself, with no label.";

/**
 * The earlier answer to a similar question, put where Claude cannot miss it, so a repeat reuses its
 * facts and wording even after the long-call cap has dropped it from the conversation.
 *
 * @param request The request.
 * @returns The lines ([] when there is none).
 * Called from: tailText()
 */
function similarLines(request: AnswerRequest): string[] {
  if (!request.similar) return [];
  return [
    `A similar question was answered at ${clockTime(request.similar.at)} (${escapeTags(request.similar.question)}). Reuse the facts and wording of that answer, changing only what something said since then has changed:`,
    '<earlier_answer>',
    escapeTags(request.similar.text),
    '</earlier_answer>',
    '',
  ];
}

/**
 * The heading over the document parts that match the question (Batch C, P2-1). It says they are parts of
 * the documents summarised above, chosen for this question, so Claude reads them as the full wording.
 */
export const DOCUMENT_PARTS_HEADING =
  'Parts of the documents that match this question (exact wording from the documents summarised above):';

/**
 * The document parts that match the question (Batch C, P2-1), in the uncached tail.
 *
 * @param request The request.
 * @returns The lines ([] when there are none).
 * Called from: tailText()
 */
function chunkLines(request: AnswerRequest): string[] {
  const chunks = request.documentChunks ?? [];
  if (chunks.length === 0) return [];
  return [
    DOCUMENT_PARTS_HEADING,
    '<document_parts>',
    ...chunks.flatMap((chunk) => [
      `<part document="${escapeTags(chunk.name).replaceAll('"', '&quot;')}">`,
      escapeTags(chunk.text),
      '</part>',
    ]),
    '</document_parts>',
    '',
  ];
}

/**
 * What the user chose for this answer: who it is for (the switch next to the chat box) and the
 * question type (the answer card's menu). In the tail, so a choice never changes the cached parts.
 *
 * @param request The request.
 * @returns The lines ([] when the user chose nothing).
 * Called from: tailText()
 */
function choiceLines(request: AnswerRequest): string[] {
  const lines: string[] = [];
  if (request.target === 'call') {
    lines.push('The user chose: this answer is for the call, so for is call.');
  } else if (request.target === 'kite') {
    lines.push('The user chose: this is a private answer, so for is kite.');
  }
  if (request.answerType) {
    lines.push(
      `The user chose the question type ${request.answerType}: answer in that shape and write it in the hidden line.`,
    );
  }
  return lines;
}

/** ADR-0137: the heading over the call memory in the tail. */
export const MEMORY_HEADING =
  'Call memory (a running summary of the whole call so far, kept by the app; the exact words above win where they differ):';

/**
 * ADR-0137: the call memory block of the tail ([] when the request has none).
 *
 * @param request The request.
 * @returns The lines.
 * Called from: tailText(); tests
 */
export function memoryLines(request: AnswerRequest): string[] {
  const memory = request.memory?.trim();
  if (!memory) return [];
  return [MEMORY_HEADING, '<call_memory>', escapeTags(memory), '</call_memory>', ''];
}

/**
 * ADR-0132: how the question is introduced when the other side was still speaking at the press (like
 * SPOKEN_LABEL, a short note in the same line). ADR-0133: the press keeps production's tail ("Question to
 * answer: …", everything they said since the last answer); the rules for several questions are in the locked
 * contract (prompts/contract.ts LIVE_CONTRACT). Measured 27 Nov 2026: a separate block and instructions at the
 * end of the prompt made Haiku write the hidden lines in the wrong order or think aloud (as ADR-0107 found).
 */
export const STILL_SPEAKING_LABEL = 'they were still speaking, so its end may be cut off';

/** ADR-0133: how the questions an earlier answer left on its "Still open:" line are introduced. */
export const STILL_OPEN_LABEL = 'left open by an earlier answer';

/**
 * ADR-0133: the tail's question line for a request: production's "Question to answer: …", with a short note
 * for a press made while they were still speaking, or for questions an earlier answer left open.
 *
 * @param request  The request (mode answer).
 * @param question The question (trimmed).
 * @returns The line.
 * Called from: tailText(); tests
 */
export function questionLine(request: AnswerRequest, question: string): string {
  const note = request.press?.stillOpen
    ? STILL_OPEN_LABEL
    : request.press?.speaking
      ? STILL_SPEAKING_LABEL
      : '';
  return note
    ? `Question to answer (${note}): ${escapeTags(question)}`
    : `Question to answer: ${escapeTags(question)}`;
}

/**
 * ADR-0107: whether a request is a screen-only screenshot (Ctrl+Shift+Enter or the Screenshot button).
 *
 * @param request The request.
 * @returns True for mode screenshot with screenOnly and an image.
 * Called from: tailText(), buildPromptParts(); tests
 */
export function isScreenOnly(request: AnswerRequest): boolean {
  return request.mode === 'screenshot' && request.screenOnly === true && Boolean(request.image);
}

/**
 * Writes the uncached tail: the end of the conversation, the lines that may still change, the question
 * (or the instruction to answer the latest question when there is none), the user's choices, and last
 * the automatic end reminder (ADR-0089: generated from the contract and the user's format and length,
 * never editable). A rollback (v-previous) keeps its own screenshot text and reminder.
 *
 * @param request         The request (mode, tail, question, session).
 * @param hasConversation True when conversation blocks come before (their tag is closed here).
 * @param options         ADR-0108: cvMatchSignal (on unless false) adds NO_CV_MATCH_LINE last when no CV
 *                        project matches an own-experience question (prompts/experience.ts).
 * @returns The tail's text.
 * Called from: buildPromptParts()
 */
function tailText(
  request: AnswerRequest,
  hasConversation: boolean,
  options: PromptOptions = {},
): string {
  const previous = request.styleVersion === 'previous';
  // ADR-0107: a screen-only screenshot: no conversation, latest lines, earlier answer or document parts,
  // only the screen's own instruction and question, then the user's choices and the end reminder.
  if (isScreenOnly(request) && !previous) {
    return [
      SCREEN_ONLY_TAIL,
      `Question about the screenshot: ${SCREEN_ONLY_QUESTION}`,
      ...choiceLines(request),
      request.session ? liveEndReminder(request.session) : CALL_REMINDER_PREVIOUS,
    ].join('\n');
  }
  const tail = request.tail ?? [];
  const question = request.question?.trim() ?? '';
  const parts = hasConversation
    ? ['</conversation>', '']
    : ['<conversation>', '(nothing said yet)', '</conversation>', ''];
  // ADR-0137: the call memory (a running summary of the whole call), uncached, before the newest lines.
  parts.push(...memoryLines(request));
  parts.push(
    '<latest>',
    ...(tail.length > 0
      ? tail.map((line) => lineText(line, themSpeaker(request.session)))
      : ['(nothing new)']),
    '</latest>',
  );
  parts.push('', ...similarLines(request), ...chunkLines(request));
  if (request.mode === 'screenshot') {
    parts.push(
      previous ? SCREENSHOT_RULES_PREVIOUS : SCREENSHOT_TAIL,
      // ADR-0101: a spoken question says so (speech recognition may have misheard words).
      request.spoken && question
        ? `Question about the screenshot, ${SPOKEN_LABEL}: ${escapeTags(question)}`
        : `Question about the screenshot: ${escapeTags(question || DEFAULT_SCREENSHOT_QUESTION)}`,
    );
  } else if (request.mode === 'chat') {
    parts.push(
      request.spoken
        ? `Question ${SPOKEN_LABEL}: ${escapeTags(question)}`
        : `Question typed by the user: ${escapeTags(question)}`,
    );
  } else if (question) {
    // ADR-0132/0133: a key press notes "still speaking" or "left open" (never in a rollback).
    parts.push(
      previous ? `Question to answer: ${escapeTags(question)}` : questionLine(request, question),
    );
  } else {
    parts.push('Answer the latest question from "Them".');
  }
  parts.push(
    ...choiceLines(request),
    previous || !request.session ? CALL_REMINDER_PREVIOUS : liveEndReminder(request.session),
    ...experienceReminder(request),
    // ADR-0108: the CV match signal, last in the tail (uncached, so the cached parts are unchanged).
    ...(options.cvMatchSignal !== false && request.session
      ? noCvMatchLines(request, experienceApplies(request.session))
      : []),
  );
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

/**
 * ADR-0101: how a voice question is introduced in the request text (not the admin's prompt): it was spoken, so
 * the model reads through misheard words rather than judging the question garbled.
 */
export const SPOKEN_LABEL = 'spoken by the user (speech recognition; may contain misheard words)';

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
 * @param request      A validated request with `session` set.
 * @param globalPrompt The admin's global prompt for live answers (ADR-0089): the version the call pinned
 *                     (DEFAULT_LIVE_PROMPT when none was saved), so every request of a call sends the
 *                     same rules block. '' sends the contract alone.
 * @param options      ADR-0108: the app passes none (the CV match signal is on); the evaluation may turn it
 *                     off to compare.
 * @returns The system blocks and the user turn.
 * @throws Error('SESSION_REQUIRED') when the request has no session (validation prevents this
 *         for every mode but hello).
 * Called from: POST handler in app/api/answer/route.ts;
 *              scripts/verify-warm.ts, scripts/verify-answer-cache.ts, scripts/eval-answers.ts
 */
export function buildPrompt(
  request: AnswerRequest,
  globalPrompt: string = DEFAULT_LIVE_PROMPT,
  options: PromptOptions = {},
): BuiltPrompt {
  if (!request.session) throw new Error('SESSION_REQUIRED');
  // Batch C (P2-1): under MAX_ANSWER_INPUT_TOKENS whatever the documents' size (server/budget.ts): the
  // session block has a fixed ceiling (the same bytes for every request of a session), and only in an
  // extreme case do the uncached and oldest parts go.
  const capped = { ...request, session: capSessionDocuments(request.session) };
  return fitToBudget(capped, (next) => buildPromptParts(next, globalPrompt, options)).prompt;
}

/**
 * Builds the prompt's parts for a request, as it is (buildPrompt() keeps it within the budget).
 *
 * @param request      A validated request with `session` set.
 * @param globalPrompt The admin's global prompt for live answers.
 * @param options      ADR-0108 (see buildPrompt()).
 * @returns The system blocks and the user turn.
 * @throws Error('SESSION_REQUIRED') when the request has no session.
 * Called from: buildPrompt() (through fitToBudget())
 */
function buildPromptParts(
  request: AnswerRequest,
  globalPrompt: string,
  options: PromptOptions = {},
): BuiltPrompt {
  if (!request.session) throw new Error('SESSION_REQUIRED');
  const previous = request.styleVersion === 'previous';
  const lessons = request.lessons ?? [];
  // ADR-0107: a screen-only screenshot never carries the call, even if a client sent it.
  const conversation = conversationBlocks(
    capConversation(isScreenOnly(request) && !previous ? [] : (request.conversation ?? [])),
    themSpeaker(request.session),
  );
  const last: Anthropic.TextBlockParam = {
    type: 'text',
    text:
      request.mode === 'warm' ? WARM_MESSAGE : tailText(request, conversation.length > 0, options),
  };
  // The screenshot is uncached and goes before the tail text that asks about it (Anthropic's
  // vision guidance: image first, then the question).
  const image = request.mode === 'screenshot' && request.image ? [imageBlock(request.image)] : [];
  return {
    system: [
      // ADR-0089: the app contract, then the admin's global prompt (a rollback: the old rules and lessons).
      cachedBlock(rulesBlock(globalPrompt, request.styleVersion, lessons)),
      // The session with the user's preferences (they override the general rules) and, for current
      // rules, the approved lessons; the CV and the documents summary when the page sends one.
      cachedBlock(smartSessionBlock(request.session, previous ? [] : lessons)),
    ],
    messages: [{ role: 'user', content: [...conversation, ...image, last] }],
  };
}
