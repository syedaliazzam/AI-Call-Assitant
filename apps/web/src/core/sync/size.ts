/**
 * File: apps/web/src/core/sync/size.ts
 * Purpose: Measures a value's JSON size in UTF-8 bytes, the unit the sync server checks its limits in
 *          (SYNC_LIMITS.recordBytes and requestBytes, with Buffer.byteLength). String length counts
 *          UTF-16 code units instead, which under-counts any text outside ASCII (up to 3 bytes per
 *          unit); a push sized by it could pass here and be refused by the server, again on every
 *          retry. That mattered once documents could hold 250k characters (ADR-0067).
 * Used by: src/core/sync/engine.ts (toOp(), pushOnce()), src/core/sync/legacyUpload.ts
 * Depends on: the TextEncoder global (browser and Node)
 * Architecture: ADR-0049 (sync), ADR-0067 (larger documents)
 */

/** One encoder for every measurement. */
const encoder = new TextEncoder();

/**
 * The size of a value as JSON, in UTF-8 bytes.
 *
 * @param value Anything JSON.stringify() accepts.
 * @returns Bytes of its JSON text, as the server's Buffer.byteLength() counts them.
 * Called from: engine.ts, legacyUpload.ts; tests
 */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}
