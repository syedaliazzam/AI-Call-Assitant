/**
 * Tests apps/web/src/server/requestBody.ts (1.5.1, ADR-0069): a plain body is read as text; a gzipped one
 * (Content-Encoding: gzip) is unpacked; the size limit applies as sent and as unpacked; broken gzip is
 * refused.
 */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readRequestText } from '@/server/requestBody';

/**
 * A POST request.
 *
 * @param body    Its body.
 * @param headers Its headers.
 * @returns The request.
 */
function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('https://kite.test/api/answer', { method: 'POST', body, headers });
}

describe('readRequestText', () => {
  it('reads a plain body', async () => {
    expect(await readRequestText(post('{"a":1}'), 100)).toEqual({ ok: true, text: '{"a":1}' });
  });

  it('unpacks a gzipped body', async () => {
    const json = JSON.stringify({ text: 'invented '.repeat(1_000) });
    const result = await readRequestText(
      post(new Uint8Array(gzipSync(json)), { 'content-encoding': 'gzip' }),
      100_000,
    );
    expect(result).toEqual({ ok: true, text: json });
  });

  it('refuses a body over the limit, plain or once unpacked', async () => {
    expect(await readRequestText(post('x'.repeat(200)), 100)).toEqual({
      ok: false,
      reason: 'too-large',
    });
    const packed = new Uint8Array(gzipSync('y'.repeat(10_000)));
    expect(packed.byteLength).toBeLessThan(1_000);
    expect(await readRequestText(post(packed, { 'content-encoding': 'gzip' }), 1_000)).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('refuses broken gzip', async () => {
    expect(await readRequestText(post('not gzip', { 'content-encoding': 'gzip' }), 1_000)).toEqual({
      ok: false,
      reason: 'bad-gzip',
    });
  });
});
