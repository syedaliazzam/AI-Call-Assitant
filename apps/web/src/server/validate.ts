/**
 * File: apps/web/src/server/validate.ts
 * Purpose: Checks the body of POST /api/answer against the AnswerRequest type from @kite/shared,
 *          with size limits so one request cannot send unbounded text to Claude.
 * Used by: app/api/answer/route.ts
 * Depends on: zod, @kite/shared (AnswerRequest)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (server rules: validate with zod,
 *               documents ≤ ~150k characters, request ≤ 4 MB)
 */
import 'server-only';
import type { AnswerRequest } from '@kite/shared';
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

/** One transcript line (TranscriptLine). */
const transcriptLineSchema = z.object({
  speaker: z.enum(['you', 'them']),
  text: z.string().max(2_000),
  t: z.number().finite(),
});

/**
 * The whole request body. `.strict()` rejects unknown fields, so typos are reported instead of
 * silently ignored. `satisfies` makes the compiler check it matches AnswerRequest exactly.
 */
export const answerRequestSchema = z
  .object({
    mode: z.enum(['hello', 'warm', 'answer', 'chat', 'screenshot']),
    model: z.enum(['fast', 'smart']).optional(),
    session: sessionSchema.optional(),
    transcript: z.array(transcriptLineSchema).max(500).optional(),
    question: z.string().max(2_000).optional(),
    // Screenshot as a data URL (Day 5); the 4 MB body limit caps its size.
    image: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp);base64,/, 'must be a PNG, JPEG or WebP data URL')
      .nullable()
      .optional(),
  })
  .strict()
  // A warm-up writes the session's cached prompt, so it needs the session.
  .refine((request) => request.mode !== 'warm' || request.session !== undefined, {
    path: ['session'],
    message: 'required for mode warm',
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
