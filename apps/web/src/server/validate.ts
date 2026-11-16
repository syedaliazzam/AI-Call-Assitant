/**
 * File: apps/web/src/server/validate.ts
 * Purpose: Checks the body of POST /api/answer against the AnswerRequest type from @kite/shared,
 *          with size limits so one request cannot send unbounded text to Claude: documents,
 *          key terms, and (Day 4) the conversation chunks, tail and question.
 * Used by: app/api/answer/route.ts, app/api/notes/route.ts (Day 5), src/server/aiTry.ts (ADR-0083),
 *          src/server/aiQuality.ts (ADR-0089)
 * Depends on: zod, @kite/shared (AnswerRequest, request limits, estimateItemTokens)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (server rules: validate with zod,
 *               documents ≤ 500k characters per session (ADR-0067), request ≤ 4 MB);
 *               day-04-answers.md Stage 1
 *
 * Error messages name the field and the rule, never the submitted text.
 */
import 'server-only';
import {
  AI_INSTRUCTION_BLOCKS,
  AI_INSTRUCTIONS_PIN_PATTERN,
  MAX_GLOBAL_PROMPT_CHARS,
  type AiTryRequest,
  type QualityCheckRequest,
  ANSWER_STYLE_VERSIONS,
  parseKeyTerms,
  ANSWER_TYPES,
  MAX_ACTIVE_LESSONS,
  MAX_ANSWER_CHARS,
  MAX_KITE_ATTACHMENTS,
  MAX_KITE_HISTORY,
  MAX_KITE_IMAGES,
  MAX_KITE_QUESTION_CHARS,
  MAX_KITE_TURN_CHARS,
  type AnswerType,
  MAX_CONVERSATION_CHUNKS,
  MAX_CONVERSATION_TOKENS,
  MAX_IMAGE_CHARS,
  MAX_LESSON_CHARS,
  MAX_LINE_CHARS,
  MAX_NOTES_ANSWERS,
  MAX_NOTES_CHARS,
  MAX_NOTES_LINES,
  MAX_TAIL_LINES,
  estimateItemTokens,
  type AnswerRequest,
  type NotesRequest,
  MAX_ASK_HISTORY,
  MAX_ASK_NOTES_CHARS,
  MAX_ASK_QUESTION_CHARS,
  MAX_ASK_TURN_CHARS,
  MAX_JOB_URL_CHARS,
  MAX_MOCK_FEEDBACK_CHARS,
  MAX_MOCK_QUESTIONS,
  MAX_MOCK_TEXT_CHARS,
  MIN_MOCK_QUESTIONS,
  type PrepareRequest,
  type AskRequest,
  type JobImportRequest,
  MAX_DOCUMENTS_SUMMARY_CHARS,
  MAX_DOCUMENT_CHUNK_CHARS,
  MAX_DOCUMENT_CHUNKS,
  MAX_SESSION_DOCUMENT_CHARS,
  type DocumentsSummaryRequest,
} from '@kite/shared';
import { z } from 'zod';

/** Largest request body accepted, in bytes (architecture §7.2). */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/**
 * Largest total length of all session document texts, in characters (architecture §7.2; 500k since
 * ADR-0067). The same number as the wizard's session cap (core/documents/limits.ts).
 */
export const MAX_DOCUMENT_CHARS = MAX_SESSION_DOCUMENT_CHARS;

/**
 * Largest total length of an Ask Kite chat's attachments, in characters. It stays at 150k when the
 * session cap rose (ADR-0067): the chat sends them in full to the smart model on every message.
 */
export const MAX_ATTACHMENT_CHARS = 150_000;

/**
 * Most key terms kept from a request (shared rule, packages/shared/src/keyTerms.ts). Extra terms are
 * dropped, not rejected: key terms never make an answer fail (v1.0.1).
 */
export { MAX_KEY_TERMS } from '@kite/shared';

/** How answers should look (AnswerStyle). */
const styleSchema = z.object({
  format: z.string().max(50),
  length: z.string().max(50),
  tone: z.string().max(50),
  star: z.boolean().optional(),
});

/** One attached document (SessionDocument); kind marks the CV (ADR-0067). */
const documentSchema = z.object({
  name: z.string().min(1).max(200),
  text: z.string().max(MAX_DOCUMENT_CHARS),
  kind: z.literal('resume').optional(),
});

/** Session details (SessionContext); the document total is checked across all documents. */
const sessionSchema = z
  .object({
    type: z.string().max(50),
    company: z.string().max(200),
    role: z.string().max(200),
    // Same limit as the wizard's description box.
    description: z.string().max(5_000),
    instructions: z.string().max(5_000),
    // Sanitised, not rejected (v1.0.1): a pasted comma list or an over-long term is split, cut and
    // deduplicated here. The raw bounds only stop absurd input (the 4 MB body cap applies too).
    keyTerms: z
      .array(z.string().max(5_000))
      .max(1_000)
      .transform((terms) => parseKeyTerms(terms)),
    style: styleSchema,
    language: z.string().max(50).optional(),
    codingLanguage: z.string().max(50).optional(),
    missingInfo: z.enum(['approach', 'story']).optional(),
    documents: z.array(documentSchema).max(20),
    // Smart-model routes only (ADR-0067): the summary of the documents other than the CV.
    documentsSummary: z.string().max(MAX_DOCUMENTS_SUMMARY_CHARS).optional(),
  })
  .refine(
    (session) =>
      session.documents.reduce((total, doc) => total + doc.text.length, 0) <= MAX_DOCUMENT_CHARS,
    { path: ['documents'], message: `documents may hold at most ${MAX_DOCUMENT_CHARS} characters` },
  );

/** Seconds since the call connected: a whole number, at most one day. */
const atSchema = z.number().int().min(0).max(86_400);

/** One transcript line (CallLine): the tail's lines. */
const callLineSchema = z
  .object({
    speaker: z.enum(['you', 'them']),
    text: z.string().max(MAX_LINE_CHARS),
    at: atSchema,
  })
  .strict();

/** One conversation item (ConversationItem): a stable line or an earlier answer. */
const conversationItemSchema = z.discriminatedUnion('kind', [
  callLineSchema.extend({ kind: z.literal('line') }).strict(),
  z
    .object({
      kind: z.literal('answer'),
      mode: z.enum(['answer', 'chat', 'screenshot']),
      question: z.string().max(MAX_LINE_CHARS),
      text: z.string().max(MAX_ANSWER_CHARS),
      at: atSchema,
      target: z.enum(['call', 'kite']).optional(),
    })
    .strict(),
]);

/**
 * The conversation: chunks of items, with the estimated total under MAX_CONVERSATION_TOKENS.
 * An empty chunk would add an empty prompt block, so each chunk holds at least one item.
 */
const conversationSchema = z
  .array(z.array(conversationItemSchema).min(1).max(2_000))
  .max(MAX_CONVERSATION_CHUNKS)
  .refine(
    (chunks) =>
      chunks.flat().reduce((total, item) => total + estimateItemTokens(item), 0) <=
      MAX_CONVERSATION_TOKENS,
    { message: `at most ${MAX_CONVERSATION_TOKENS} estimated tokens` },
  );

/**
 * Whether a JPEG data URL's bytes start with the JPEG start-of-image marker (FF D8 FF), so a
 * renamed PNG or other file is refused, not only a wrong prefix.
 *
 * @param dataUrl A string that already matched the JPEG data URL pattern.
 * @returns True when the decoded bytes start as a JPEG.
 * Called from: answerRequestSchema (image)
 */
function startsAsJpeg(dataUrl: string): boolean {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 9);
  const head = Buffer.from(base64, 'base64');
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

/** A JPEG data URL whose bytes really start as a JPEG (a screenshot). */
const imageSchema = z
  .string()
  .max(MAX_IMAGE_CHARS, `at most ${MAX_IMAGE_CHARS} characters`)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/, 'must be a JPEG data URL')
  .refine(startsAsJpeg, 'must be a JPEG image');

/**
 * A call's company instructions pin (ADR-0083): a version id (UUID) or 'none'. Anything else is
 * rejected, so a request cannot ask for text by any other key.
 */
const instructionsPinSchema = z.string().regex(AI_INSTRUCTIONS_PIN_PATTERN, 'must be a version id');

/**
 * The whole request body. `.strict()` rejects unknown fields, so typos are reported instead of
 * silently ignored. `satisfies` makes the compiler check it matches AnswerRequest exactly.
 */
export const answerRequestSchema = z
  .object({
    mode: z.enum(['hello', 'warm', 'answer', 'chat', 'screenshot', 'kite']),
    model: z.enum(['fast', 'smart']).optional(),
    session: sessionSchema.optional(),
    conversation: conversationSchema.optional(),
    tail: z.array(callLineSchema).max(MAX_TAIL_LINES).optional(),
    // MAX_KITE_QUESTION_CHARS is the larger limit; every other mode is held to MAX_LINE_CHARS below.
    question: z.string().max(MAX_KITE_QUESTION_CHARS).optional(),
    // The screenshot (Day 5): a JPEG data URL whose bytes really start as a JPEG.
    image: imageSchema.nullable().optional(),
    // Approved lessons (Day 5 Stage 7), for the rules block.
    lessons: z
      .array(z.string().min(1).max(MAX_LESSON_CHARS, `at most ${MAX_LESSON_CHARS} characters`))
      .max(MAX_ACTIVE_LESSONS, `at most ${MAX_ACTIVE_LESSONS} lessons`)
      .optional(),
    // Ask Kite and answer quality (ADR-0030).
    target: z.enum(['call', 'kite']).optional(),
    answerType: z.enum(ANSWER_TYPES as [AnswerType, ...AnswerType[]]).optional(),
    similar: z
      .object({
        question: z.string().max(MAX_LINE_CHARS),
        text: z.string().max(MAX_ANSWER_CHARS),
        at: atSchema,
      })
      .strict()
      .optional(),
    // Batch C (P2-1): the document parts that match the question (live answers; uncached).
    documentChunks: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            text: z.string().min(1).max(MAX_DOCUMENT_CHUNK_CHARS),
          })
          .strict(),
      )
      .max(MAX_DOCUMENT_CHUNKS)
      .optional(),
    // The answer rules' version (ADR-0032); the route ignores it for anyone but an admin.
    styleVersion: z.enum(ANSWER_STYLE_VERSIONS).optional(),
    // ADR-0083: the live-answers company instructions version the call started with (an id or 'none').
    instructionsVersion: instructionsPinSchema.optional(),
    // The Ask Kite page's chat: mode 'kite' only (checked below).
    codingLanguage: z.string().max(50).optional(),
    history: z
      .array(
        z
          .object({
            role: z.enum(['you', 'kite']),
            text: z.string().min(1).max(MAX_KITE_TURN_CHARS),
          })
          .strict(),
      )
      .max(MAX_KITE_HISTORY)
      .optional(),
    attachments: z.array(documentSchema).max(MAX_KITE_ATTACHMENTS).optional(),
    images: z.array(imageSchema).max(MAX_KITE_IMAGES).optional(),
  })
  .strict()
  // Every mode but hello and kite is built on the session's cached prompt, so it needs the session.
  .superRefine((request, context) => {
    if (request.mode === 'kite') {
      if (!request.question?.trim() && !request.images?.length) {
        context.addIssue({ code: 'custom', path: ['question'], message: 'required for mode kite' });
      }
      const total = (request.attachments ?? []).reduce((sum, item) => sum + item.text.length, 0);
      if (total > MAX_ATTACHMENT_CHARS) {
        context.addIssue({
          code: 'custom',
          path: ['attachments'],
          message: `attachments may hold at most ${MAX_ATTACHMENT_CHARS} characters`,
        });
      }
    } else {
      if (request.history || request.attachments || request.images) {
        context.addIssue({ code: 'custom', path: ['history'], message: 'only for mode kite' });
      }
      if ((request.question?.length ?? 0) > MAX_LINE_CHARS) {
        context.addIssue({
          code: 'custom',
          path: ['question'],
          message: `at most ${MAX_LINE_CHARS} characters`,
        });
      }
    }
    if (request.mode !== 'hello' && request.mode !== 'kite' && request.session === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['session'],
        message: `required for mode ${request.mode}`,
      });
    }
    // The image goes only with a screenshot answer, and a screenshot answer needs it.
    if (request.mode === 'screenshot' && !request.image) {
      context.addIssue({
        code: 'custom',
        path: ['image'],
        message: 'required for mode screenshot',
      });
    }
    if (request.mode !== 'screenshot' && request.image) {
      context.addIssue({ code: 'custom', path: ['image'], message: 'only for mode screenshot' });
    }
    // A chat question is typed by the user; there is nothing to fall back on.
    if (request.mode === 'chat' && !request.question?.trim()) {
      context.addIssue({ code: 'custom', path: ['question'], message: 'required for mode chat' });
    }
  }) satisfies z.ZodType<AnswerRequest>;

/** Result of parseAnswerRequest(). */
export type ParseResult =
  | {
      /** The body is valid. */
      ok: true;
      /** The validated request. */
      data: AnswerRequest;
    }
  | {
      /** The body is invalid. */
      ok: false;
      /** Which fields are wrong and why (field paths only, never the submitted values). */
      message: string;
    };

/**
 * Validates a parsed JSON body.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message listing the problems.
 * Called from: POST handler in app/api/answer/route.ts
 */
export function parseAnswerRequest(body: unknown): ParseResult {
  const result = answerRequestSchema.safeParse(body);
  if (result.success) return { ok: true, data: result.data as AnswerRequest };
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
  );
  return { ok: false, message: problems.join('; ') };
}

/** One answer in a notes request (NotesAnswer). */
const notesAnswerSchema = z
  .object({
    at: atSchema,
    mode: z.enum(['answer', 'chat', 'screenshot']),
    question: z.string().max(MAX_LINE_CHARS),
    text: z.string().max(MAX_ANSWER_CHARS),
    rating: z.enum(['up', 'down']).nullable(),
    note: z.string().max(MAX_LINE_CHARS),
  })
  .strict();

/**
 * The body of POST /api/notes (Day 5): the session, the call's lines (at most MAX_NOTES_LINES
 * and MAX_NOTES_CHARS characters in all) and its answers. Unknown fields are rejected.
 */
export const notesRequestSchema = z
  .object({
    session: sessionSchema,
    lines: z
      .array(callLineSchema)
      .max(MAX_NOTES_LINES)
      .refine(
        (lines) => lines.reduce((total, line) => total + line.text.length, 0) <= MAX_NOTES_CHARS,
        { message: `at most ${MAX_NOTES_CHARS} characters in all` },
      ),
    answers: z.array(notesAnswerSchema).max(MAX_NOTES_ANSWERS),
    // ADR-0083: the AI-notes company instructions version the call started with.
    instructionsVersion: instructionsPinSchema.optional(),
  })
  .strict() satisfies z.ZodType<NotesRequest>;

/** Result of parseNotesRequest(). */
export type NotesParseResult =
  | {
      /** The body is valid. */
      ok: true;
      /** The validated request. */
      data: NotesRequest;
    }
  | {
      /** The body is invalid. */
      ok: false;
      /** Which fields are wrong and why (field paths only, never the submitted values). */
      message: string;
    };

/**
 * Validates a parsed notes request body.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message listing the problems.
 * Called from: POST handler in app/api/notes/route.ts
 */
export function parseNotesRequest(body: unknown): NotesParseResult {
  const result = notesRequestSchema.safeParse(body);
  if (result.success) return { ok: true, data: result.data as NotesRequest };
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
  );
  return { ok: false, message: problems.join('; ') };
}

/** The result of checking a small request: the data, or field paths only, never the values. */
export type SmallParseResult<T> =
  | {
      /** It is valid. */
      ok: true;
      /** The validated request. */
      data: T;
    }
  | {
      /** It is not. */
      ok: false;
      /** Which fields are wrong (paths only). */
      message: string;
    };

/**
 * Validates a body against a schema, naming only the wrong fields' paths.
 *
 * @param schema The schema.
 * @param body   The JSON value from the request.
 * @returns The validated request, or a message.
 * Called from: parseJobImportRequest(), parseAskRequest(), parsePrepareRequest(), parseSummaryRequest()
 */
function parseSmall<T>(schema: z.ZodType<T>, body: unknown): SmallParseResult<T> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  const problems = result.error.issues.map((issue) => issue.path.join('.') || 'body');
  return { ok: false, message: `Invalid: ${problems.join(', ')}` };
}

/** Body of POST /api/job-import. Whether the address may be fetched is checked in job-page.ts. */
const jobImportSchema = z.object({ url: z.string().min(1).max(MAX_JOB_URL_CHARS) });

/**
 * Validates a job import request.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message.
 * Called from: POST handler in app/api/job-import/route.ts
 */
export function parseJobImportRequest(body: unknown): SmallParseResult<JobImportRequest> {
  return parseSmall<JobImportRequest>(jobImportSchema, body);
}

/** The body of POST /api/ask: a notes request, plus its notes, the question and the chat so far. */
// Ask AI has no call pin (ADR-0083): it always uses the Ask AI instructions in force.
const askRequestSchema = notesRequestSchema.omit({ instructionsVersion: true }).extend({
  notes: z.string().max(MAX_ASK_NOTES_CHARS),
  question: z.string().trim().min(1).max(MAX_ASK_QUESTION_CHARS),
  history: z
    .array(
      z
        .object({
          role: z.enum(['you', 'kite']),
          text: z.string().max(MAX_ASK_TURN_CHARS),
        })
        .strict(),
    )
    .max(MAX_ASK_HISTORY),
});

/**
 * Validates an Ask AI request.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message.
 * Called from: POST handler in app/api/ask/route.ts
 */
export function parseAskRequest(body: unknown): SmallParseResult<AskRequest> {
  return parseSmall<AskRequest>(askRequestSchema as unknown as z.ZodType<AskRequest>, body);
}

/** A question or answer in a mock interview. */
const mockTextSchema = z.string().trim().min(1).max(MAX_MOCK_TEXT_CHARS);

/** The body of POST /api/prepare: one of the Prepare tools' requests. Unknown fields are rejected. */
const prepareRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('mock-questions'),
      session: sessionSchema,
      count: z.number().int().min(MIN_MOCK_QUESTIONS).max(MAX_MOCK_QUESTIONS),
    })
    .strict(),
  z
    .object({
      kind: z.literal('mock-feedback'),
      session: sessionSchema,
      question: mockTextSchema,
      answer: mockTextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('mock-summary'),
      session: sessionSchema,
      items: z
        .array(
          z
            .object({
              question: mockTextSchema,
              answer: mockTextSchema,
              feedback: z.string().max(MAX_MOCK_FEEDBACK_CHARS),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_MOCK_QUESTIONS),
    })
    .strict(),
  z.object({ kind: z.literal('question-bank'), session: sessionSchema }).strict(),
]);

/**
 * Validates a Prepare request.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message.
 * Called from: POST handler in app/api/prepare/route.ts
 */
export function parsePrepareRequest(body: unknown): SmallParseResult<PrepareRequest> {
  return parseSmall<PrepareRequest>(
    prepareRequestSchema as unknown as z.ZodType<PrepareRequest>,
    body,
  );
}

/**
 * The body of POST /api/summary (ADR-0067): the session's documents other than the CV, at most
 * MAX_DOCUMENT_CHARS in all and at least one. Unknown fields are rejected.
 */
const summaryRequestSchema = z
  .object({
    documents: z
      .array(documentSchema)
      .min(1)
      .max(20)
      .refine(
        (documents) =>
          documents.reduce((total, document) => total + document.text.length, 0) <=
          MAX_DOCUMENT_CHARS,
        { message: `at most ${MAX_DOCUMENT_CHARS} characters in all` },
      ),
  })
  .strict();

/**
 * Validates a documents summary request.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message (field paths only).
 * Called from: POST handler in app/api/summary/route.ts
 */
export function parseSummaryRequest(body: unknown): SmallParseResult<DocumentsSummaryRequest> {
  return parseSmall<DocumentsSummaryRequest>(
    summaryRequestSchema as unknown as z.ZodType<DocumentsSummaryRequest>,
    body,
  );
}

/** A draft global prompt (ADR-0089): at most MAX_GLOBAL_PROMPT_CHARS; '' tries the contract alone. */
const globalPromptSchema = z
  .string()
  .max(MAX_GLOBAL_PROMPT_CHARS, `at most ${MAX_GLOBAL_PROMPT_CHARS} characters`);

/**
 * The body of POST /api/admin/ai-instructions/try (ADR-0083, ADR-0089): a tab, its draft global prompt, a
 * sample question or call, and an optional session. Unknown fields are rejected.
 */
const aiTryRequestSchema = z
  .object({
    block: z.enum(AI_INSTRUCTION_BLOCKS),
    prompt: globalPromptSchema,
    // A sample call for the notes can hold several lines; a question is far shorter.
    sample: z.string().trim().min(1, 'required').max(4_000),
    session: sessionSchema.optional(),
  })
  .strict();

/** The body of POST /api/admin/ai-instructions/quality (ADR-0089): the draft live answers prompt. */
const qualityRequestSchema = z.object({ prompt: globalPromptSchema }).strict();

/**
 * Validates a quality-check request.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message (field paths only).
 * Called from: handleQualityCheck() in src/server/aiQuality.ts; tests
 */
export function parseQualityRequest(body: unknown): SmallParseResult<QualityCheckRequest> {
  return parseSmall<QualityCheckRequest>(
    qualityRequestSchema as unknown as z.ZodType<QualityCheckRequest>,
    body,
  );
}

/**
 * Validates a "Try it" request.
 *
 * @param body The JSON value from the request.
 * @returns The validated request, or a message (field paths only).
 * Called from: handleTry() in src/server/aiTry.ts; tests
 */
export function parseAiTryRequest(body: unknown): SmallParseResult<AiTryRequest> {
  return parseSmall<AiTryRequest>(aiTryRequestSchema as unknown as z.ZodType<AiTryRequest>, body);
}
