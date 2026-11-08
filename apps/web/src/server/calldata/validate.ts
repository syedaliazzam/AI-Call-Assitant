/**
 * File: apps/web/src/server/calldata/validate.ts
 * Purpose: Checks the sync routes' input (ADR-0049): the push body (operations, kinds, ids, sizes)
 *          and the pull and record queries. Error messages name the field only and never echo a
 *          value, because values are call data.
 * Used by: src/server/calldata/api.ts
 * Depends on: zod, @kite/shared (SYNC_KINDS, SESSION_CHILD_KINDS, SYNC_LIMITS, SYNC_ID_PATTERN)
 * Architecture: ADR-0049
 */
import 'server-only';
import {
  SESSION_CHILD_KINDS,
  SYNC_ID_PATTERN,
  SYNC_KINDS,
  SYNC_LIMITS,
  type SyncKind,
  type SyncOp,
} from '@kite/shared';
import { z } from 'zod';

/** An id: a UUID, a transcript line id, or a fixed id such as 'defaults'. */
const idSchema = z.string().regex(SYNC_ID_PATTERN);

/** A record kind. */
const kindSchema = z.enum(SYNC_KINDS);

/** A record: any JSON object (the device's own shape), at most SYNC_LIMITS.recordBytes as JSON. */
const recordSchema = z
  .record(z.string(), z.unknown())
  .refine((record) => Buffer.byteLength(JSON.stringify(record)) <= SYNC_LIMITS.recordBytes, {
    message: 'too large',
  });

/** One operation. */
const opSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('put'),
      kind: kindSchema,
      id: idSchema,
      sessionId: idSchema.optional(),
      baseRev: z.number().int().nonnegative().nullable(),
      record: recordSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('insert'),
      kind: kindSchema,
      id: idSchema,
      sessionId: idSchema.optional(),
      record: recordSchema,
    })
    .strict(),
  z.object({ op: z.literal('delete'), kind: kindSchema, id: idSchema }).strict(),
  z.object({ op: z.literal('clearLines'), sessionId: idSchema }).strict(),
  z.object({ op: z.literal('deleteAll') }).strict(),
]);

/** The push body. */
const pushSchema = z
  .object({ ops: z.array(opSchema).min(1).max(SYNC_LIMITS.opsPerPush) })
  .strict()
  .superRefine((body, context) => {
    body.ops.forEach((op, index) => {
      if (op.op !== 'put' && op.op !== 'insert') return;
      // A session's documents, lines, answers, notes and question bank carry its id (so deleting
      // the session takes them); every other kind must not.
      const child = (SESSION_CHILD_KINDS as readonly SyncKind[]).includes(op.kind);
      if (child !== (op.sessionId !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['ops', index, 'sessionId'],
          message: child ? 'required' : 'not allowed',
        });
      }
    });
  });

/** The result of checking input: the value, or the names of the fields that are wrong. */
export type Checked<T> =
  | {
      /** The input is fine. */
      ok: true;
      /** The checked value. */
      value: T;
    }
  | {
      /** The input is wrong. */
      ok: false;
      /** Field names with a short reason each, never a value. */
      problems: string[];
    };

/**
 * Turns zod issues into field names with a short reason, never a value.
 *
 * @param issues The issues.
 * @returns For example ["ops.0.kind: invalid"].
 */
function describe(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.slice(0, 5).map((issue) => {
    const reason = issue.code === 'custom' ? issue.message : 'invalid';
    return `${issue.path.join('.') || 'body'}: ${reason}`;
  });
}

/**
 * Checks a push body.
 *
 * @param text The request body as text.
 * @returns The operations, or what is wrong.
 * Called from: handlePush() in api.ts; tests
 */
export function checkPush(text: string): Checked<SyncOp[]> {
  if (Buffer.byteLength(text) > SYNC_LIMITS.requestBytes) {
    return { ok: false, problems: ['body: too large'] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['body: not JSON'] };
  }
  const result = pushSchema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data.ops as SyncOp[] }
    : { ok: false, problems: describe(result.error.issues) };
}

/**
 * Checks a pull's query: `since` (Unix ms) and the optional page token `after`.
 *
 * @param params The URL's query.
 * @returns The values, or what is wrong.
 * Called from: handlePull() in api.ts; tests
 */
export function checkPull(
  params: URLSearchParams,
): Checked<{ since: number; after: string | null }> {
  const since = Number(params.get('since') ?? '0');
  const after = params.get('after');
  if (!Number.isSafeInteger(since) || since < 0) return { ok: false, problems: ['since: invalid'] };
  if (after !== null && (after.length === 0 || after.length > 600)) {
    return { ok: false, problems: ['after: invalid'] };
  }
  return { ok: true, value: { since, after } };
}

/**
 * Checks a single-record query: `kind` and `id`.
 *
 * @param params The URL's query.
 * @returns The kind and id, or what is wrong.
 * Called from: handleRecord() in api.ts; tests
 */
export function checkRecordQuery(params: URLSearchParams): Checked<{ kind: SyncKind; id: string }> {
  const kind = kindSchema.safeParse(params.get('kind'));
  const id = idSchema.safeParse(params.get('id'));
  if (!kind.success) return { ok: false, problems: ['kind: invalid'] };
  if (!id.success) return { ok: false, problems: ['id: invalid'] };
  return { ok: true, value: { kind: kind.data, id: id.data } };
}
