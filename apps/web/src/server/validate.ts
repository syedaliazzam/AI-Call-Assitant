/**
 * File: apps/web/src/server/validate.ts
 * Purpose: Checks the body of POST /api/answer against the AnswerRequest type from @kite/shared,
 *          with size limits so one request cannot send unbounded text to Claude: documents,
 *          key terms, and (Day 4) the conversation chunks, tail and question.
 * Used by: app/api/answer/route.ts
 * Depends on: zod, @kite/shared (AnswerRequest, request limits, estimateItemTokens)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (server rules: validate with zod,
 *               documents ≤ ~150k characters, request ≤ 4 MB); day-04-answers.md Stage 1
 *
 * Error messages name the field and the rule, never the submitted text.
 */
import 'server-only';
import {
  MAX_ANSWER_CHARS,
  MAX_CONVERSATION_CHUNKS,
  MAX_CONVERSATION_TOKENS,
  MAX_IMAGE_CHARS,
  MAX_LINE_CHARS,
  MAX_TAIL_LINES,
  estimateItemTokens,
  type AnswerRequest,
} from '@kite/shared';
import { z } from 'zod';

/** Largest request body accepted, in bytes (architecture §7.2). */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** Largest total length of all session document texts, in characters (architecture §7.2). */
export const MAX_DOCUMENT_CHARS = 150_000;

/** Most key terms a session may send (the hotword list keeps at most 100 phrases). */
export const MAX_KEY_TERMS = 100;

/** How answers should look (AnswerStyle). */
const styleSchema = z.object({
  format: z.string().max(50),
  length: z.string().max(50),
  tone: z.string().max(50),
});

/** One attached document (SessionDocument). */
const documentSchema = z.object({
  name: z.string().min(1).max(200),
  text: z.string().max(MAX_DOCUMENT_CHARS),
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
    keyTerms: z.array(z.string().max(200)).max(MAX_KEY_TERMS),
    style: styleSchema,
    documents: z.array(documentSchema).max(20),
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

/**
 * The whole request body. `.strict()` rejects unknown fields, so typos are reported instead of
 * silently ignored. `satisfies` makes the compiler check it matches AnswerRequest exactly.
 */
export const answerRequestSchema = z
  .object({
    mode: z.enum(['hello', 'warm', 'answer', 'chat', 'screenshot']),
    model: z.enum(['fast', 'smart']).optional(),
    session: sessionSchema.optional(),
    conversation: conversationSchema.optional(),
    tail: z.array(callLineSchema).max(MAX_TAIL_LINES).optional(),
    question: z.string().max(MAX_LINE_CHARS).optional(),
    // The screenshot (Day 5): a JPEG data URL whose bytes really start as a JPEG.
    image: z
      .string()
      .max(MAX_IMAGE_CHARS, `at most ${MAX_IMAGE_CHARS} characters`)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/, 'must be a JPEG data URL')
      .refine(startsAsJpeg, 'must be a JPEG image')
      .nullable()
      .optional(),
  })
  .strict()
  // Every mode but hello is built on the session's cached prompt, so it needs the session.
  .superRefine((request, context) => {
    if (request.mode !== 'hello' && request.session === undefined) {
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
