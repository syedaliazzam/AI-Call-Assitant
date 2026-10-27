/**
 * Tests for apps/web/scripts/sentencepiece-vocab.ts:
 * sentencePieceVocab() reads the pieces and scores out of a SentencePiece model (protocol
 * buffer), skips the other fields, formats scores like Python (export_bpe_vocab.py), and rejects
 * files without pieces. The real bpe.model is checked by its pinned SHA-256 in fetch-models.ts.
 */
import { describe, expect, it } from 'vitest';
import { sentencePieceVocab } from '../../../scripts/sentencepiece-vocab';

/** Encodes a protocol-buffer varint. */
function varint(value: number): number[] {
  const out: number[] = [];
  while (value >= 0x80) {
    out.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  out.push(value);
  return out;
}

/** A length-delimited field. */
function lengthField(field: number, payload: number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(payload.length), ...payload];
}

/** One SentencePiece message: piece text, score, and a type field (varint) to be skipped. */
function piece(text: string, score: number): number[] {
  const scoreBytes = new Uint8Array(4);
  new DataView(scoreBytes.buffer).setFloat32(0, score, true);
  return lengthField(1, [
    ...lengthField(1, [...new TextEncoder().encode(text)]),
    ...varint(2 * 8 + 5),
    ...scoreBytes,
    ...varint(3 * 8 + 0),
    1,
  ]);
}

describe('sentencePieceVocab', () => {
  it('writes one "piece<TAB>score" line per piece in order, skipping other fields', () => {
    const model = new Uint8Array([
      ...piece('<blk>', 0),
      ...piece('▁THE', -3.3911421298980713),
      // A trainer-spec message (field 2) that must be ignored.
      ...lengthField(2, [8, 1]),
      ...piece('S', -3.25),
    ]);
    expect(sentencePieceVocab(model)).toBe('<blk>\t0.0\n▁THE\t-3.3911421298980713\nS\t-3.25\n');
  });

  it('handles messages whose length needs a two-byte varint (128 bytes or more)', () => {
    const long = 'X'.repeat(200);
    const model = new Uint8Array([
      ...piece(long, -1.5),
      // A long trainer-spec message to skip (also a two-byte length).
      ...lengthField(
        2,
        Array.from({ length: 300 }, () => 0),
      ),
      ...piece('Y', -2),
    ]);
    expect(sentencePieceVocab(model)).toBe(`${long}\t-1.5\nY\t-2.0\n`);
  });

  it('rejects a file with no pieces', () => {
    expect(() => sentencePieceVocab(new Uint8Array(lengthField(2, [8, 1])))).toThrow(/No pieces/);
  });

  it('rejects a truncated file', () => {
    expect(() => sentencePieceVocab(new Uint8Array([0x0a, 0x10, 0x0a]))).toThrow(/Truncated/);
  });
});
