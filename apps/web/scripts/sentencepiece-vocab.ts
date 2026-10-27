/**
 * File: apps/web/scripts/sentencepiece-vocab.ts
 * Purpose: Turns a SentencePiece model file (bpe.model) into the text vocabulary (bpe.vocab)
 *          that sherpa-onnx needs to encode hotwords. It writes exactly what the official
 *          sherpa-onnx script scripts/export_bpe_vocab.py writes (one "piece<TAB>score" line per
 *          piece), without needing Python: the model's tokenizer repositories ship bpe.model only.
 * Used by: scripts/fetch-models.ts
 * Depends on: nothing (pure)
 * Architecture: ADR-0020 (hotwords)
 *
 * bpe.model is a protocol buffer (SentencePiece ModelProto). Only field 1 is needed: the
 * repeated pieces, each with field 1 = piece text and field 2 = score (32-bit float).
 */

/** A read position inside a byte buffer. */
interface Cursor {
  /** Index of the next byte to read. */
  at: number;
}

/**
 * Reads one protocol-buffer varint (up to 2^53, enough for any length or key in this file).
 *
 * @param bytes  The buffer.
 * @param cursor Read position; moved past the varint.
 * @returns The value.
 * @throws Error('Truncated bpe.model') if the buffer ends inside the varint.
 */
function readVarint(bytes: Uint8Array, cursor: Cursor): number {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (cursor.at >= bytes.length) throw new Error('Truncated bpe.model');
    const byte = bytes[cursor.at++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7;
  }
}

/**
 * Skips a field's value of the given wire type.
 *
 * @param bytes    The buffer.
 * @param cursor   Read position; moved past the value.
 * @param wireType Protocol-buffer wire type (0 varint, 1 64-bit, 2 length-delimited, 5 32-bit).
 * @throws Error for wire types this file never uses (groups).
 */
function skipValue(bytes: Uint8Array, cursor: Cursor, wireType: number): void {
  if (wireType === 0) readVarint(bytes, cursor);
  else if (wireType === 1) cursor.at += 8;
  else if (wireType === 2) {
    // Not `cursor.at += readVarint(…)`: that would add to the position from before the length.
    const length = readVarint(bytes, cursor);
    cursor.at += length;
  } else if (wireType === 5) cursor.at += 4;
  else throw new Error(`Unsupported protobuf wire type ${wireType} in bpe.model`);
}

/**
 * Formats a score the way Python's f"{float}" does (shortest round-trip form, and "0.0" rather
 * than "0" for whole numbers), so the output matches export_bpe_vocab.py byte for byte.
 *
 * @param score The piece's score.
 * @returns The text.
 */
function formatScore(score: number): string {
  return Number.isInteger(score) ? score.toFixed(1) : String(score);
}

/**
 * Converts bpe.model bytes into bpe.vocab text.
 *
 * @param model Contents of bpe.model.
 * @returns The vocabulary: one "piece\tscore\n" line per piece, in id order.
 * @throws Error if the file is truncated or not a SentencePiece model (no pieces found).
 * Called from: installBpeVocab() in scripts/fetch-models.ts
 */
export function sentencePieceVocab(model: Uint8Array): string {
  const view = new DataView(model.buffer, model.byteOffset, model.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const lines: string[] = [];
  const cursor: Cursor = { at: 0 };
  while (cursor.at < model.length) {
    const key = readVarint(model, cursor);
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (field !== 1 || wireType !== 2) {
      skipValue(model, cursor, wireType);
      continue;
    }
    // One SentencePiece message: read its piece (field 1) and score (field 2).
    // Read the length first: it moves the cursor, and the message starts after it.
    const length = readVarint(model, cursor);
    const end = cursor.at + length;
    if (end > model.length) throw new Error('Truncated bpe.model');
    let piece = '';
    let score = 0;
    while (cursor.at < end) {
      const innerKey = readVarint(model, cursor);
      const innerField = Math.floor(innerKey / 8);
      const innerType = innerKey % 8;
      if (innerField === 1 && innerType === 2) {
        const length = readVarint(model, cursor);
        piece = decoder.decode(model.subarray(cursor.at, cursor.at + length));
        cursor.at += length;
      } else if (innerField === 2 && innerType === 5) {
        score = view.getFloat32(cursor.at, true);
        cursor.at += 4;
      } else {
        skipValue(model, cursor, innerType);
      }
    }
    lines.push(`${piece}\t${formatScore(score)}\n`);
  }
  if (lines.length === 0) throw new Error('No pieces found: not a SentencePiece bpe.model');
  return lines.join('');
}
