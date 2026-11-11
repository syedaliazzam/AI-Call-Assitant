/**
 * File: apps/web/src/server/requestBody.ts
 * Purpose: Reads a route's request body as text, unpacking it when the browser sent it gzipped (1.5.1,
 *          ADR-0069: answers with large documents are gzipped to upload about 4× faster). The size limit
 *          applies to the unpacked text too, so a small gzipped body cannot expand into a huge one.
 * Used by: app/api/answer/route.ts, app/api/summary/route.ts
 * Depends on: node:zlib
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (request ≤ 4 MB); ADR-0069
 *
 * Never logs the body.
 */
import 'server-only';
import { gunzipSync } from 'node:zlib';

/** What readRequestText() found. */
export type RequestText =
  | {
      /** The body was read. */
      ok: true;
      /** The body as text. */
      text: string;
    }
  | {
      /** The body was refused. */
      ok: false;
      /** 'too-large' (over the limit, sent or unpacked) or 'bad-gzip' (not valid gzip). */
      reason: 'too-large' | 'bad-gzip';
    };

/**
 * Reads the body.
 *
 * @param request  The request.
 * @param maxBytes The most bytes allowed, as sent and as unpacked.
 * @returns The text, or why it was refused.
 * Called from: the answer and summary routes; tests
 */
export async function readRequestText(request: Request, maxBytes: number): Promise<RequestText> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return { ok: false, reason: 'too-large' };
  const encoding = (request.headers.get('content-encoding') ?? '').trim().toLowerCase();
  if (encoding === 'gzip') {
    const packed = Buffer.from(await request.arrayBuffer());
    if (packed.byteLength > maxBytes) return { ok: false, reason: 'too-large' };
    try {
      // maxOutputLength makes zlib stop (and throw) as soon as the unpacked text passes the limit.
      return { ok: true, text: gunzipSync(packed, { maxOutputLength: maxBytes }).toString('utf8') };
    } catch (error) {
      const code = (error as { code?: string }).code;
      return { ok: false, reason: code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : 'bad-gzip' };
    }
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, reason: 'too-large' };
  return { ok: true, text };
}
