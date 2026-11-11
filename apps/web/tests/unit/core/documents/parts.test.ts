/**
 * Tests apps/web/src/core/documents/parts.ts (1.5.1, ADR-0069): a long document is cut into parts of at
 * most 250k characters at a paragraph break (else a line break, a sentence end, or the limit), joining
 * them gives the text back exactly, and stored parts are joined into one document (first part's id and
 * name) while ordinary rows pass through; rowIdsOf finds every part. Invented text only.
 */
import { describe, expect, it } from 'vitest';
import {
  joinDocumentParts,
  MAX_PART_CHARS,
  rowIdsOf,
  splitDocumentText,
} from '@/core/documents/parts';
import type { StoredDocument } from '@/core/storage/types';

describe('splitDocumentText', () => {
  it('keeps a text that fits in one part', () => {
    expect(splitDocumentText('short')).toEqual(['short']);
    expect(MAX_PART_CHARS).toBe(250_000);
  });

  it('cuts at a paragraph break, and the parts join back exactly', () => {
    const paragraph = 'Invented handbook sentence. '.repeat(40) + '\n\n';
    const text = paragraph.repeat(500);
    const parts = splitDocumentText(text, 100_000);
    expect(parts.join('')).toBe(text);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(100_000);
    for (const part of parts.slice(0, -1)) expect(part.endsWith('\n\n')).toBe(true);
  });

  it('cuts exactly at the limit when there is no break at all', () => {
    const text = 'x'.repeat(250);
    expect(splitDocumentText(text, 100)).toEqual([
      'x'.repeat(100),
      'x'.repeat(100),
      'x'.repeat(50),
    ]);
  });
});

/**
 * A stored row.
 *
 * @param id   Its id (the name is `<id>.txt`).
 * @param text Its text.
 * @param part Its place in a long document, if it is a part.
 * @returns The row.
 */
function row(id: string, text: string, part?: StoredDocument['part']): StoredDocument {
  return {
    id,
    sessionId: 's',
    name: `${id}.txt`,
    text,
    chars: text.length,
    addedAt: 1,
    ...(part ? { part } : {}),
  };
}

describe('joinDocumentParts', () => {
  it('joins parts in order into one document and leaves other rows alone', () => {
    const rows = [
      row('cv', 'CV'),
      row('p2', 'world', { group: 'p1', index: 1, count: 2 }),
      row('p1', 'hello ', { group: 'p1', index: 0, count: 2 }),
      row('price', 'list'),
    ];
    const joined = joinDocumentParts(rows);
    expect(joined.map((document) => document.id)).toEqual(['cv', 'p1', 'price']);
    expect(joined[1]).toMatchObject({ id: 'p1', name: 'p1.txt', text: 'hello world', chars: 11 });
    expect(joined[1]!.part).toBeUndefined();
    expect(rowIdsOf(rows, 'p1').sort()).toEqual(['p1', 'p2']);
    expect(rowIdsOf(rows, 'cv')).toEqual(['cv']);
  });
});
