/**
 * File: apps/web/src/core/documents/parts.ts
 * Purpose: Lets one document hold up to MAX_DOCUMENT_CHARS (500,000 characters, 1.5.1, ADR-0069) while
 *          every stored row stays at most MAX_PART_CHARS (250,000). A row syncs to the account as one
 *          record, limited to 1.5 MB as JSON (SYNC_LIMITS.recordBytes): 250,000 characters is at most
 *          about 750 KB even in a three-byte script, 500,000 would not fit. So a long document is stored
 *          as parts, cut at paragraph breaks, that carry the first part's id; everything that reads
 *          documents (the live call, the wizard, review, notes) gets them joined again, as one document.
 * Used by: src/core/storage/sessions.ts (writing), src/core/storage/documents.ts (listing)
 * Depends on: src/core/storage/types.ts (StoredDocument, DocumentPart)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2, §7.4; ADR-0067, ADR-0069
 *
 * Document text is the user's content and is never logged.
 */
import type { StoredDocument } from '../storage/types';

/** The most characters one stored row holds. */
export const MAX_PART_CHARS = 250_000;

/** How far back from a part's limit a paragraph or line break is looked for, in characters. */
const BREAK_SEARCH_CHARS = 20_000;

/**
 * Cuts a text into parts of at most `maxChars`, each ending at a paragraph break, else a line break,
 * else a sentence end, else exactly at the limit. Joining the parts gives the text back exactly.
 *
 * @param text     The text.
 * @param maxChars The longest part (default MAX_PART_CHARS).
 * @returns The parts, in order ([text] when it fits in one).
 * Called from: documentRows() in sessions.ts; tests
 */
export function splitDocumentText(text: string, maxChars = MAX_PART_CHARS): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(Math.max(0, maxChars - BREAK_SEARCH_CHARS), maxChars);
    const offset = Math.max(0, maxChars - BREAK_SEARCH_CHARS);
    const at = [/\n\s*\n/g, /\n/g, /[.!?]\s/g]
      .map((pattern) => {
        let last = -1;
        for (const match of window.matchAll(pattern)) last = match.index + match[0].length;
        return last;
      })
      .find((index) => index > 0);
    const cut = at === undefined ? maxChars : offset + at;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts;
}

/**
 * Joins the parts of long documents back into one document each; other rows are returned as they are.
 * The joined document has the first part's id, name and addedAt, and the parts' text in order.
 *
 * @param rows A session's stored rows, oldest first.
 * @returns One entry per document, in the same order.
 * Called from: listDocuments() in storage/documents.ts, duplicateSession(); tests
 */
export function joinDocumentParts(rows: readonly StoredDocument[]): StoredDocument[] {
  const groups = new Map<string, StoredDocument[]>();
  const out: (StoredDocument | string)[] = [];
  for (const row of rows) {
    if (!row.part) {
      out.push(row);
      continue;
    }
    const group = groups.get(row.part.group);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.part.group, [row]);
      out.push(row.part.group);
    }
  }
  return out.map((entry) => {
    if (typeof entry !== 'string') return entry;
    const parts = [...groups.get(entry)!].sort((a, b) => a.part!.index - b.part!.index);
    const first = parts[0]!;
    const text = parts.map((part) => part.text).join('');
    const { part: _part, ...rest } = first;
    return { ...rest, id: entry, text, chars: text.length };
  });
}

/**
 * The stored ids of a document: itself, or every part of a long document.
 *
 * @param rows A session's stored rows.
 * @param id   A document's id (as listDocuments() gives it).
 * @returns The row ids to delete.
 * Called from: updateSessionWithDocuments() in sessions.ts; tests
 */
export function rowIdsOf(rows: readonly StoredDocument[], id: string): string[] {
  return rows.filter((row) => row.id === id || row.part?.group === id).map((row) => row.id);
}
