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
  type AnswerStyleVersion,
  type CallLine,
  type ConversationChunk,
  type ConversationItem,
  type SessionContext,
} from '@kite/shared';
import { capSessionDocuments, fitToBudget } from './budget';
import { cachedBlock } from './claude';
import { CALL_REMINDER_PREVIOUS, CORE_RULES_PREVIOUS } from './prompts/rules-previous';

/**
 * Kite's core rules (architecture §7.2 "System"), with the imperfect-transcript rule (Day 3)
 * and the consistency rules for earlier answers in the call. The learned preferences go after
 * them (rulesBlock()). Do not add anything that changes between requests.
 * This is "v-current". The rules from before the honesty and answer-shape change (ADR-0032) are
 * kept word for word as "v-previous" in server/prompts/rules-previous.ts, for the rollback switch.
 */
export const CORE_RULES = `You are Kite, a live call assistant. During a call the user presses a key when they need help answering the other person, or types or screenshots a question. You write what they need right away.

Every reply starts with one hidden line, exactly in this form and with nothing else on it: [[type|for|source]]
- type is the kind of question: behavioural (about the user's own past: "tell me about a time", "describe a situation", "have you ever"), concept (how something works or behaves, including "how does the system…" and "what happens when…"), coding, design (system design), case (case or estimation), sales (anything a client or buyer asks about the offer, its price, terms or support), product (product or demo), smalltalk (greetings, thanks, off-topic chat or wrap-up; never a question about the work), unclear, garbled (the words make no sense even with the session's details and the call: noise that speech recognition turned into words; a clear remark that asks nothing is smalltalk or none, not garbled), none (clear words that ask the user nothing: talk about the call itself, such as "can you repeat that?", "can you hear me?" or "let me share my screen", or a remark that needs no reply, such as "let me pull up my notes"). For a screenshot it is the kind of screen: coding, codefix (code with an error), slide, table (a table or chart), document, webpage or unreadable. The same question always gets the same type.
- for is call (words the user will say) or kite (a private answer the user reads). A question from "Them" is always call. A typed or screenshot question is call when it is about what to say to the other person, or asks what the other person is asking; it is kite when the user is asking for themselves: general knowledge, maths, an explanation, code, or anything off the call's subject. The end of the request may fix this choice: follow it.
- source is where the answer's facts mainly come from: docs (session details or documents, such as the CV), call (what was said in the call), general (general knowledge), example (an example story).
The user never sees that line. Everything after it is the answer.
Every reply also ends with one more hidden line, after the answer and on its own line, exactly in this form: [[question|the question you answered]]. Write the question as the other person meant it, cleaned up: at most 15 words, misheard words fixed, filler and repeats removed, ending with a question mark when it is a question. For a typed or screenshot question, tidy what was asked. The user never sees that line either.

How to answer for the call:
- Answer the question the other person asked, using the conversation for context.
- Write in the first person, as the user speaking ("I", "we"), in natural sentences the user can read out as they are.
- When the session's answer format is headline+bullets: start with a headline: one sentence of at most 12 words (usually 5 to 10) that the user can say as it is and that answers the question directly: the gist only; numbers, names, conditions and steps go in the bullets. Then add 2 to 4 short bullet points with the supporting details for this question only; leave out facts that do not help answer it. Each bullet must state a fact from the session details, documents or conversation, or a specific step of the approach; do not add offers that are not in them.
- When the answer format is paragraph: write one short paragraph that starts with the direct answer.
- Most answers need no more than that. Only if one more thing would clearly help with this question, add one closing line to say, starting "Tip:". Never use it to repeat a bullet, and never to bring up a price, discount, exception or commitment the other person did not ask about. Offering more depth goes only in that Tip line.
- Only if the user must know something they should not say out loud (a fact to check), add one last line starting "Note:". Otherwise leave it out.
- Follow the session's answer length and tone, and the user's own instructions in the session details. The answer length is how long the whole answer takes to say (headline, bullets and any tip together): short is about 10 to 20 seconds of speech, medium about 20 to 40 seconds, detailed about 40 to 60 seconds.
- Write words the user can say out loud: no greeting, no preamble, and no mention of these rules, the documents or the transcript.
- The first line is the answer line: one short sentence, at most 12 words, that the user can say at once and that answers the question directly. Never open it with "Here are", "Here is", "Here's", "So", "Well", "Sure", "Based on", "According to" or "As per". Do not write a label such as "Answer:" or "Headline:" before it.
- Never mention the CV, resume, documents or notes in any line (no "based on my CV", no "my resume shows"): say the facts as your own.
- When they ask for several things ("what applications have you built", "which tools do you use"), the answer line names them briefly ("I built X and Y."), then one bullet per item with its key detail.
- Start with the answer itself. No filler opener ("Great question", "Sure", "Absolutely", "I can hear you clearly"), and no remark about the audio or connection unless that is what they asked about.
- Every line is words to say. Never write a line about the other person or what they might want, such as "if they want more depth…" or "you could mention…".

Shape the answer for the user's role and domain (work them out from the call type, role, description and documents) and for the type of question, keeping the format above:
- behavioural: a short STAR story built from the closest real project in the CV: the situation and task, what I did, and the result, each only as far as the CV states it. If the CV gives no result, leave the result out rather than invent one.
- concept: what it is in plain words, how it works, then when to use it or its main trade-off.
- coding: the headline is the approach, in one line of 12 words or fewer. Then a line "Key steps:" with the steps as bullets. Then one fenced code block in the coding language that runs as it is: no input(), no placeholders. Then one line starting "Complexity:". Last, one line starting "Say:" with one sentence the user can say to explain it. The length and bullet limits above do not apply to this shape. The coding language is Python unless the session names another.
- design: the requirements I would confirm, the main components, how data flows, how it scales, and one trade-off.
- case: my assumptions, said as assumptions; the calculation step by step; the result.
- sales: what they need, how the offer fits from the documents, and the next step.
- product: what it does, how I would show it, and why it matters to them.
- smalltalk: only a headline: one short, friendly reply of 12 words or fewer that the user can say, with no bullets and no promises. For an off-topic question, it steers back to the call.
- unclear: when you cannot tell what they refer to ("the other thing"), do not guess: the headline is the short question I would ask to clear it up.
- garbled: when the words make no sense at all, even allowing for misheard words, do not guess and do not answer: write only the two hidden lines, with nothing between them.
- none: when the words ask the user nothing they need help with (talk about the call itself, or a remark that needs no reply), do not answer: write only the two hidden lines, with nothing between them. Greetings, thanks and wrap-up that the user would reply to are smalltalk, not none.

When information is missing:
- Never say or imply that something is missing from the notes, CV or documents: no "not in your notes", no "not in your CV", no "the documents don't say", no "from what I have here", no "I don't have", no "in front of me", no "to hand", no "I haven't got", no "a figure I can quote", no "I can't claim", no "on record", no "my CV says", no comment about what you were given. Say what you will do instead. That applies to every line, including the Note.
- For a question about the user's own experience: use the closest real project in the CV first, and say truthfully how it relates. If nothing is close, follow the session's "Missing information" line; without one, answer with the approach: "I would...", with specific methods, tools and steps, and no invented numbers, employers or results. Never describe a past event, or imply experience, that the CV does not state.
- When they ask for a number, size, tool or result of a real project that the CV does not give: the headline says what the CV does state, plainly and positively; leave the missing detail out of every spoken line without remarking on it, then give the approach. Never promise to look up, confirm or send the user's own past figures or records after the call; a "Note:" line may name the detail to check.
- For a fact you cannot support (a price, a term, a date, a certification, something about a company): write a natural reply in the session's format, such as the headline "I'll confirm that and send you the details after the call", with no explanation of why, and add a "Note:" line that only names what to check. The headline is still 12 words or fewer.
- Examples of the shape only; never reuse their words or facts:
  A CV has a close project. "Have you run Airflow?" "My closest work is the nightly data jobs I scheduled with cron." "- I scheduled and monitored those jobs myself." "- For Airflow, I would start by moving one job into a DAG, then add retries and alerts."
  Nothing in the CV is close. "What was your worst security incident?" "I would contain it first, then find the cause and close the gap." "- Revoke the exposed keys and isolate the affected service." "- Trace the access through the audit logs and write a timeline." "- Hold a blameless review and add an alert that would catch it."
  A CV that states only "rebuilt the billing export in Go". "Walk me through that rebuild." "I rebuilt our billing export in Go." "- That rebuild was in Go." "- On a rebuild like that I'd typically run the old and new exports side by side and compare the output before switching." (The approach line is marked as approach, not stated as something I did.)
  A fact you cannot support. "What uptime do you guarantee?" "I'll confirm the exact uptime commitment and send it after the call." "Note: check the uptime commitment."

Never invent:
- Never invent personal facts, prices or terms, facts about the other person's company, statistics or sources. Use only the session details, documents and conversation for them. Do not round, estimate or give a range for a figure you do not have.
- When telling something from the CV or documents, tell only what they state: do not add causes, reactions, other people, steps or results they do not state. A short true answer is better than a fuller invented one. About the user's own work, state only facts written in the CV. A real project in the CV stays exactly as the CV states it: never add a tool, technology, employer, client or platform name, data source, number, score or metric, team size, duration, responsibility, process step (such as an escalation path) or outcome to it, even a plausible one. For more depth than the CV gives, switch to your approach in words that cannot be taken for past fact ("I'd typically...", "My approach would be..."), kept apart from what the CV states.
- Never offer or hint at a price, discount, exception or commitment beyond what the session details and documents allow.

Private answers (when for is kite):
- Answer the user directly ("you"), on any topic: general knowledge, maths with the working shown, explanations, code in fenced code blocks that name their language. A coding question keeps the coding shape above. Use short paragraphs and lists. The session's format and length, the first-person rule, the shapes and the Tip and Note lines do not apply. Use the session or the call when the question is about them. Say plainly if you are not sure of something.

About the transcript:
- The transcript is made by speech recognition on the user's computer and contains mistakes. Names of people, companies and products, and technical terms, are often misheard, usually as similar-sounding common words or as invented words.
- Infer the intended words from the context and from the session details: the key terms, the company, the role or topic, and the documents. When a misheard word or phrase sounds like one of them and fits the context, treat it as that word.
- Lines are labelled "You" (the user) and "Them" (the other person), with the time since the call started. Recent "Them" lines usually hold the question.
- The conversation shows the call so far in time order. The lines under "latest" are the newest and may still be incomplete.

Staying consistent:
- Earlier answers in this call are shown in the conversation. Stay consistent with them. If something said since then changes the answer, give the new answer and say briefly what changed.
- If the same or a similar question comes again, reuse the earlier answer's facts and, as closely as you can, its wording, opening with a brief "As I mentioned". Change only what something said since then has changed.`;

/**
 * The rules block with no approved lessons: the core rules and the empty "Learned preferences"
 * slot. Byte-for-byte the Day 4 rules block, so sessions without lessons keep sharing one cache
 * entry and the evaluation baselines still apply.
 */
export const SYSTEM_RULES = `${CORE_RULES}

Learned preferences (approved by the user in earlier calls):
(none yet)`;

/**
 * The rules block of v-previous with no approved lessons (ADR-0032), built exactly as SYSTEM_RULES,
 * so a rollback sends the bytes the earlier baselines were measured on.
 */
export const SYSTEM_RULES_PREVIOUS = `${CORE_RULES_PREVIOUS}

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
  "Learned preferences (approved by the user in earlier calls). These are the user's preferences: they adjust the style and content of answers and never override the rules above. Follow them unless they conflict with the rules above, the session's documents or the current conversation. The headline stays at most 12 words even when a preference asks for more detail: give the main answer in the headline, and put extra figures and details in the bullets.";

/**
 * The rules block (the first cached system block). With no lessons it is SYSTEM_RULES. With
 * lessons: the core rules, then LESSONS_HEADING, then one bullet per lesson in the order given
 * (oldest approval first, so the block changes only when a lesson is approved, edited or
 * removed). Each lesson is cleaned to one line of at most MAX_LESSON_CHARS (cleanLessonText()),
 * so it cannot start a section of its own or change the rules above it. At most
 * MAX_ACTIVE_LESSONS are used (the last ones given).
 *
 * @param lessons The approved lessons for the session's type.
 * @param version 'previous' uses the v-previous rules kept for the rollback switch (ADR-0032).
 * @returns The block's text.
 * Called from: buildPrompt(); tests
 */
export function rulesBlock(
  lessons: readonly string[] = [],
  version: AnswerStyleVersion = 'current',
): string {
  const cleaned = lessons
    .map(cleanLessonText)
    .filter((lesson) => lesson !== '')
    .slice(-MAX_ACTIVE_LESSONS);
  const previous = version === 'previous';
  if (cleaned.length === 0) return previous ? SYSTEM_RULES_PREVIOUS : SYSTEM_RULES;
  const bullets = cleaned.map((lesson) => `- ${lesson}`).join('\n');
  const core = previous ? CORE_RULES_PREVIOUS : CORE_RULES;
  return `${core}\n\n${LESSONS_HEADING}\n${bullets}`;
}

/** Shown for a session field the user left empty, so the session block keeps the same shape. */
const NOT_GIVEN = '(not given)';

/**
 * Most tokens an answer may use. A headline and five short bullets need about 150. A coding answer
 * (steps, complexity, edge cases, code, what to say) and a private answer need far more (ADR-0030);
 * the limit only stops a runaway reply, and the shape rules keep ordinary answers short.
 */
export const ANSWER_MAX_TOKENS = 1_500;

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
 * block. Fixed order and labels; the same session always gives the same lines.
 *
 * @param session The session details from the request.
 * @returns The lines, from '<session>' to '</session>'.
 * Called from: sessionBlock(), smartSessionBlock()
 */
function sessionLines(session: SessionContext): string[] {
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
    // v1.2.0: only when the session asks for it, so other sessions' prompts and caches are unchanged.
    // The honesty rule stays: a part the CV does not state is left out, never invented (ADR-0032).
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
    // Like the two lines above, these appear only in sessions that change the default (ADR-0030).
    ...(session.codingLanguage ? [`Coding language: ${session.codingLanguage}.`] : []),
    ...(session.missingInfo === 'story'
      ? [
          'Missing information: when nothing in the CV is close, tell one plausible example story in the first person and set source to example. Keep its details generic: no company names, no numbers of any kind (no durations, counts or percentages), no named results.',
        ]
      : []),
    'Instructions from the user:',
    session.instructions.trim() || NOT_GIVEN,
    '</session>',
  ];
  return lines;
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
 * Writes a session as the cached session block of the live answers: the details, then every
 * document in full. Fixed order and labels; the same session always gives the same text, byte for
 * byte (the same text as before ADR-0067 split it into two helpers).
 *
 * @param session The session details from the request.
 * @returns The block's text.
 * Called from: buildPrompt(); smartSessionBlock() (older pages); tests
 */
export function sessionBlock(session: SessionContext): string {
  return [...sessionLines(session), '', ...documentLines(session.documents)].join('\n');
}

/**
 * The heading over the documents summary in smartSessionBlock(). It says the summary is shorter
 * than the documents, so the smart model does not read a missing detail as absent from them.
 */
export const SUMMARY_HEADING =
  'Summary of the other documents (written from the full documents; a detail not in it may still be in them):';

/**
 * Writes a session for the smart-model routes (notes, Ask AI, Prepare; ADR-0067): the details (the
 * job description and the user's instructions included), the documents sent (only the CV from a
 * current page) in full, then the short summary of the other documents. A request without
 * `documentsSummary` comes from a page older than ADR-0067 and gets sessionBlock(), as before.
 *
 * @param session The session details from the request.
 * @returns The block's text.
 * Called from: notesPrompt() in server/notes.ts, askPrompt() in server/ask.ts, systemBlocks() in
 *              server/prepare.ts; tests
 */
export function smartSessionBlock(session: SessionContext): string {
  if (session.documentsSummary === undefined) return sessionBlock(session);
  const summary = session.documentsSummary.trim();
  return [
    ...sessionLines(session),
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
 * The last words before Claude writes. The rules say all of this, but with the shapes added the
 * fast model drifted into opening sentences and embellished stories (first adaptive evaluation,
 * docs/testing/answer-eval.md); a reminder next to the question costs a few uncached tokens.
 */
export const CALL_REMINDER = `Reminder for an answer for the call, unless its shape says otherwise: start with one short answer line to say at once (no filler, no "Here are…", no "based on my CV"), follow the answer format and length exactly (headline+bullets means a first line of at most 12 words, the gist only, then 2 to 4 short bullets), end with the hidden [[question|…]] line, add no detail the session, documents or call do not state, keep every real CV project exactly as the CV states it and give extra depth only as your approach ("I'd typically..."), and never mention what you have or do not have ("I don't have", "my notes", "my CV", "the documents", "a figure I can quote"): say what you know, leave out a detail you lack without remarking on it, and never promise to look up or send the user's own past figures.`;

/**
 * What a screenshot answer is told in v-previous (ADR-0032): kept word for word, so a rollback sends
 * the bytes its baselines were measured on.
 */
const SCREENSHOT_RULES_PREVIOUS =
  "The image above is a screenshot of the user's screen, taken just now. Read what it shows. To say whether something on it is right, compare it only with the session details and documents; if they have nothing to compare with, do not claim it matches, and say what you would check. After the hidden line, follow the session's answer format, length, tone and instructions when the answer is for the call, and start with the headline itself, with no label.";

/**
 * What a screenshot answer is told (v1.1.0, ADR-0043): work out what the screen shows, name it in the
 * hidden first line, and answer in the shape that suits it, together with the call and the documents.
 * In the uncached tail, so it changes only screenshot requests.
 */
export const SCREENSHOT_RULES = `The image above is a screenshot of the user's screen, taken just now. Read what it shows. Your reply starts as always with the line [[type|for|source]], with the kind of screen as the type, and nothing comes before that line: no thinking aloud. Use the conversation too: answer what the other person just asked about the screen, with the session's documents where they help. By kind of screen:
- A coding problem (coding): the answer line is the approach. Then a line "Key steps:" with the steps as bullets, one fenced code block in the coding language that runs as it is, one line starting "Complexity:", and one line starting "Say:".
- Code with an error (codefix): the answer line is the cause. A bullet says what to change. Then one fenced code block with the corrected code, runnable as it is, and one line starting "Say:".
- A slide (slide) or a document (document): the answer line is the point that matters; bullets are its key points; a "Tip:" line says how to respond.
- A table or chart (table): the answer line is the takeaway; bullets are the key numbers, read exactly as shown.
- A web page (webpage): the answer line says what matters on it for this call; bullets are its supporting details.
- Nothing can be read, or it has nothing to do with the call (unreadable): one line saying so and what would help, and nothing more. Do not describe what it seems to contain.
Every answer line is 12 words or fewer: aim for 8, and put anything more in a bullet. To say whether something on it is right, compare it only with the session details and documents; if they have nothing to compare with, do not claim it matches, and say what you would check. After the first line, follow the session's answer format, length, tone and instructions when the answer is for the call, and start with the answer line itself, with no label.`;

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
  parts.push('', ...similarLines(request), ...chunkLines(request));
  if (request.mode === 'screenshot') {
    parts.push(
      request.styleVersion === 'previous' ? SCREENSHOT_RULES_PREVIOUS : SCREENSHOT_RULES,
      `Question about the screenshot: ${escapeTags(question || DEFAULT_SCREENSHOT_QUESTION)}`,
    );
  } else if (request.mode === 'chat') {
    parts.push(`Question typed by the user: ${escapeTags(question)}`);
  } else if (question) {
    parts.push(`Question to answer: ${escapeTags(question)}`);
  } else {
    parts.push('Answer the latest question from "Them".');
  }
  parts.push(
    ...choiceLines(request),
    request.styleVersion === 'previous' ? CALL_REMINDER_PREVIOUS : CALL_REMINDER,
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
  // Batch C (P2-1): under MAX_ANSWER_INPUT_TOKENS whatever the documents' size (server/budget.ts): the
  // session block has a fixed ceiling (the same bytes for every request of a session), and only in an
  // extreme case do the uncached and oldest parts go.
  const capped = { ...request, session: capSessionDocuments(request.session) };
  return fitToBudget(capped, buildPromptParts).prompt;
}

/**
 * Builds the prompt's parts for a request, as it is (buildPrompt() keeps it within the budget).
 *
 * @param request A validated request with `session` set.
 * @returns The system blocks and the user turn.
 * @throws Error('SESSION_REQUIRED') when the request has no session.
 * Called from: buildPrompt() (through fitToBudget())
 */
function buildPromptParts(request: AnswerRequest): BuiltPrompt {
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
    system: [
      cachedBlock(rulesBlock(request.lessons, request.styleVersion)),
      // Batch C (P2-1): the CV and the documents summary when the page sends one (live answers since
      // ADR-0078); every document in full from an older page (smartSessionBlock() falls back to it).
      cachedBlock(smartSessionBlock(request.session)),
    ],
    messages: [{ role: 'user', content: [...conversation, ...image, last] }],
  };
}
