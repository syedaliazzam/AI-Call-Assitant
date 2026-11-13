/**
 * File: apps/web/src/core/documents/chunks.ts
 * Purpose: Relevant document parts for live answers (Batch C, P2-1; investigation D3). The live answers'
 *          cached prefix holds the CV and the short documents summary (ADR-0067) instead of every document
 *          in full; for each question the few parts of the other documents that match it best go in the
 *          uncached tail. So a request stays about the size of a CV-only one, whatever the documents' size.
 *          - chunkText(): splits a document into parts of about CHUNK_TARGET_CHARS, at paragraph, then
 *            sentence boundaries (never longer than MAX_DOCUMENT_CHUNK_CHARS).
 *          - buildChunkIndex(): the parts of a session's documents (not the CV), with their words counted,
 *            once per document text (kept in memory for the page; never per question).
 *          - rankChunks(): BM25 over those parts for a question; the best 3–5 with any match.
 *          Runs in the browser, on this device: no new service, and document text is never logged.
 * Used by: src/core/answer/context.ts (each answer request), src/features/live/useLiveAnswers.ts (the index);
 *          tests/unit/core/documents/chunks.test.ts
 * Depends on: @kite/shared (DocumentChunk, MAX_DOCUMENT_CHUNKS, MAX_DOCUMENT_CHUNK_CHARS)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md D3; ADR-0078
 */
import { MAX_DOCUMENT_CHUNK_CHARS, MAX_DOCUMENT_CHUNKS, type DocumentChunk } from '@kite/shared';

/** The size a part aims for, in characters (a few paragraphs; about 300 tokens). */
export const CHUNK_TARGET_CHARS = 1_200;

/** BM25's term-frequency saturation (the usual value). */
export const BM25_K1 = 1.2;

/** BM25's length normalisation (the usual value). */
export const BM25_B = 0.75;

/** At least this many parts are sent when that many match at all. */
export const MIN_CHUNKS = 3;

/** Past MIN_CHUNKS, a part scoring under this share of the best one is left out. */
export const RELATIVE_CUTOFF = 0.25;

/**
 * Words too common to tell parts apart (English; other languages simply keep every word). Question words
 * are here too: "what" and "how" match every part equally.
 */
const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a an and are as at be been being but by can could did do does doing for from had has have having he her ' +
    'him his how i if in into is it its just me more most my no not of on or our out over own same she so ' +
    'some such than that the their them then there these they this those through to too under until up us ' +
    'very was we were what when where which while who whom why will with would you your yours about again ' +
    'all also any because before between both during each few further here itself let like many much myself ' +
    'nor off once only other ought shall should tell themselves yourself describe explain give walk talk ' +
    'please okay ok yes yeah'
  ).split(' '),
);

/**
 * The words of a text as BM25 compares them: lower case, letters and digits only, common words left out,
 * and a plural "s" taken off ("services" and "service" match).
 *
 * @param text Any text.
 * @returns The words, in order (repeats kept).
 * Called from: buildChunkIndex(), rankChunks(); tests
 */
export function terms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const result: string[] = [];
  for (const word of words) {
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    const stem =
      word.length > 4 && word.endsWith('ies')
        ? `${word.slice(0, -3)}y`
        : word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
          ? word.slice(0, -1)
          : word;
    result.push(stem);
  }
  return result;
}

/** A stretch of a text, by character offsets. */
interface Span {
  /** First character. */
  start: number;
  /** One past the last character. */
  end: number;
}

/**
 * Splits a stretch at the boundaries a pattern finds (the boundary stays with the piece before it).
 *
 * @param text    The whole text.
 * @param span    The stretch.
 * @param pattern A global pattern for the boundaries.
 * @returns The pieces, in order (blank ones left out).
 */
function splitAt(text: string, span: Span, pattern: RegExp): Span[] {
  const pieces: Span[] = [];
  const part = text.slice(span.start, span.end);
  let from = 0;
  for (const match of part.matchAll(pattern)) {
    const to = (match.index ?? 0) + match[0].length;
    if (part.slice(from, to).trim() !== '') {
      pieces.push({ start: span.start + from, end: span.start + to });
    }
    from = to;
  }
  if (part.slice(from).trim() !== '') pieces.push({ start: span.start + from, end: span.end });
  return pieces;
}

/**
 * Splits a document into parts: paragraphs packed together up to about CHUNK_TARGET_CHARS; a paragraph
 * longer than MAX_DOCUMENT_CHUNK_CHARS is split at sentence ends, and a sentence longer than that at the
 * limit. The same text always gives the same parts.
 *
 * @param text The document's text.
 * @returns The parts as offsets, in order.
 * Called from: buildChunkIndex(); tests
 */
export function chunkText(text: string): Span[] {
  const whole = { start: 0, end: text.length };
  // Pieces no longer than the limit: paragraphs, then sentences, then hard cuts.
  const pieces: Span[] = [];
  for (const paragraph of splitAt(text, whole, /\n\s*\n/g)) {
    if (paragraph.end - paragraph.start <= MAX_DOCUMENT_CHUNK_CHARS) {
      pieces.push(paragraph);
      continue;
    }
    for (const sentence of splitAt(text, paragraph, /[.!?]["')\]]?\s+|\n/g)) {
      for (let at = sentence.start; at < sentence.end; at += MAX_DOCUMENT_CHUNK_CHARS) {
        pieces.push({ start: at, end: Math.min(sentence.end, at + MAX_DOCUMENT_CHUNK_CHARS) });
      }
    }
  }
  // Packed into parts of about the target size (never over the limit).
  const parts: Span[] = [];
  for (const piece of pieces) {
    const last = parts.at(-1);
    if (
      last &&
      piece.end - last.start <= MAX_DOCUMENT_CHUNK_CHARS &&
      last.end - last.start < CHUNK_TARGET_CHARS
    ) {
      last.end = piece.end;
    } else {
      parts.push({ ...piece });
    }
  }
  return parts;
}

/** One part, ready to be ranked. */
interface IndexedChunk {
  /** The document's name (sent with the part). */
  name: string;
  /** The part's text, trimmed. */
  text: string;
  /** How often each word occurs in it. */
  counts: Map<string, number>;
  /** How many words it has. */
  length: number;
}

/** The parts of a session's documents, counted for ranking. */
export interface ChunkIndex {
  /** Every part. */
  chunks: readonly IndexedChunk[];
  /** In how many parts each word occurs. */
  documentFrequency: ReadonlyMap<string, number>;
  /** The average part length, in words. */
  averageLength: number;
}

/** A document as the index needs it. */
export interface ChunkSource {
  /** Its id (with its size, the memory's key). */
  id: string;
  /** Its name. */
  name: string;
  /** Its text. */
  text: string;
  /** 'resume' for the CV, which is never split (it is sent in full). */
  kind?: string;
}

/** Parts already made, by document id, size and name: made once per document text in this page. */
const made = new Map<string, IndexedChunk[]>();

/**
 * One document's parts, made once and kept.
 *
 * @param document The document.
 * @returns Its counted parts.
 */
function partsOf(document: ChunkSource): IndexedChunk[] {
  const key = `${document.id}:${document.text.length}:${document.name}`;
  const known = made.get(key);
  if (known) return known;
  const parts = chunkText(document.text).map((span) => {
    const text = document.text.slice(span.start, span.end).trim();
    const words = terms(text);
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    return { name: document.name, text, counts, length: words.length };
  });
  made.set(key, parts);
  return parts;
}

/**
 * The index of a session's documents other than the CV (the CV is in the cached prefix in full).
 *
 * @param documents The session's documents (any order).
 * @returns The index (empty when there is nothing but the CV).
 * Called from: useLiveAnswers.ts (when the documents load or change); tests
 */
export function buildChunkIndex(documents: readonly ChunkSource[]): ChunkIndex {
  const chunks = documents
    .filter((document) => document.kind !== 'resume')
    .flatMap((document) => partsOf(document));
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
    for (const word of chunk.counts.keys()) {
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    }
  }
  return {
    chunks,
    documentFrequency,
    averageLength: chunks.length > 0 ? totalLength / chunks.length : 0,
  };
}

/**
 * The parts that match a question best, by BM25: the best MAX_DOCUMENT_CHUNKS with any match, cut to the
 * best MIN_CHUNKS when the rest score under RELATIVE_CUTOFF of the best one.
 *
 * @param index    The session's index.
 * @param question The question (or what the other person just said).
 * @returns The parts, best first ([] when nothing matches).
 * Called from: core/answer/context.ts buildAnswerRequest(); tests
 */
export function rankChunks(index: ChunkIndex, question: string): DocumentChunk[] {
  const wanted = [...new Set(terms(question))];
  if (wanted.length === 0 || index.chunks.length === 0) return [];
  const total = index.chunks.length;
  const scored = index.chunks
    .map((chunk, position) => {
      let score = 0;
      for (const word of wanted) {
        const frequency = chunk.counts.get(word);
        if (!frequency) continue;
        const containing = index.documentFrequency.get(word) ?? 0;
        const idf = Math.log(1 + (total - containing + 0.5) / (containing + 0.5));
        const norm = 1 - BM25_B + BM25_B * (chunk.length / (index.averageLength || 1));
        score += (idf * frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * norm);
      }
      return { chunk, score, position };
    })
    .filter((item) => item.score > 0)
    // Best first; equal scores keep document order, so the same question always gets the same parts.
    .sort((a, b) => b.score - a.score || a.position - b.position);
  const best = scored[0]?.score ?? 0;
  const kept = scored.filter(
    (item, rank) =>
      rank < MAX_DOCUMENT_CHUNKS && (rank < MIN_CHUNKS || item.score >= best * RELATIVE_CUTOFF),
  );
  return kept.map((item) => ({ name: item.chunk.name, text: item.chunk.text }));
}

/**
 * Forgets the parts made in this page (tests).
 *
 * Called from: tests
 */
export function forgetChunks(): void {
  made.clear();
}
