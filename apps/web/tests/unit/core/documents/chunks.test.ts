/**
 * Tests apps/web/src/core/documents/chunks.ts (Batch C, P2-1): documents are split into parts of about
 * 1,200 characters at paragraph and sentence boundaries, never over the limit, the same way every time; the
 * CV is never split (it is sent in full); BM25 ranks the parts that match a question first, rare words count
 * more than common ones, and at most 5 parts (3 when the rest match weakly) go with a question; a question
 * with no matching words gets none.
 */
import { MAX_DOCUMENT_CHUNK_CHARS, MAX_DOCUMENT_CHUNKS } from '@kite/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildChunkIndex,
  chunkText,
  forgetChunks,
  MIN_CHUNKS,
  rankChunks,
  terms,
} from '@/core/documents/chunks';

beforeEach(() => forgetChunks());

/**
 * A paragraph of filler sentences about one topic.
 *
 * @param topic A word to repeat.
 * @param sentences How many sentences.
 * @returns The paragraph.
 */
function paragraph(topic: string, sentences = 6): string {
  return Array.from(
    { length: sentences },
    (_, index) => `Section ${index} explains the ${topic} process in plain words for the team.`,
  ).join(' ');
}

describe('terms', () => {
  it('lower-cases, drops common words and plural endings', () => {
    expect(terms('What are the Services and Policies of Kubernetes?')).toEqual([
      'service',
      'policy',
      'kubernete',
    ]);
  });
});

describe('chunkText', () => {
  it('keeps parts under the limit and covers the whole text in order', () => {
    const text = Array.from({ length: 40 }, (_, i) => paragraph(`topic${i}`)).join('\n\n');
    const spans = chunkText(text);
    expect(spans.length).toBeGreaterThan(5);
    for (const span of spans)
      expect(span.end - span.start).toBeLessThanOrEqual(MAX_DOCUMENT_CHUNK_CHARS);
    for (let i = 1; i < spans.length; i += 1)
      expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
    // Every word of the text is in some part.
    const covered = spans.map((span) => text.slice(span.start, span.end)).join(' ');
    expect(terms(covered)).toEqual(terms(text));
  });

  it('splits a long paragraph with no breaks, and a sentence longer than the limit', () => {
    const long = 'x'.repeat(MAX_DOCUMENT_CHUNK_CHARS * 3 + 10);
    const spans = chunkText(long);
    expect(spans.length).toBe(4);
    for (const span of spans)
      expect(span.end - span.start).toBeLessThanOrEqual(MAX_DOCUMENT_CHUNK_CHARS);
  });

  it('gives the same parts for the same text', () => {
    const text = [paragraph('billing'), paragraph('refund'), paragraph('support')].join('\n\n');
    expect(chunkText(text)).toEqual(chunkText(text));
  });
});

describe('rankChunks', () => {
  const documents = [
    { id: 'cv', name: 'cv.pdf', text: 'Rate limiter in Go at Acme.', kind: 'resume' },
    {
      id: 'jd',
      name: 'job.pdf',
      text: [
        paragraph('onboarding'),
        paragraph('payroll'),
        'The team runs a public API with a token bucket rate limiter and Redis for counters.',
        paragraph('holiday'),
      ].join('\n\n'),
    },
  ];

  it('never splits the CV (it is sent in full)', () => {
    const index = buildChunkIndex(documents);
    expect(index.chunks.every((chunk) => chunk.name === 'job.pdf')).toBe(true);
  });

  it('ranks the part that matches the question first', () => {
    const ranked = rankChunks(
      buildChunkIndex(documents),
      'How would you design a rate limiter with Redis?',
    );
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.text).toContain('token bucket rate limiter');
    expect(ranked[0]!.name).toBe('job.pdf');
  });

  it('sends nothing when no word of the question is in the documents', () => {
    expect(rankChunks(buildChunkIndex(documents), 'Tell me about yourself')).toEqual([]);
    expect(rankChunks(buildChunkIndex([]), 'rate limiter')).toEqual([]);
  });

  it('sends at most 5 parts, and only 3 when the rest match weakly', () => {
    // Twelve parts mention "pipeline"; one also mentions the rare "flink" many times.
    const many = Array.from({ length: 12 }, (_, i) =>
      i === 0
        ? `${paragraph('pipeline', 16)} Flink flink flink streaming jobs.`
        : paragraph('pipeline', 16),
    );
    const index = buildChunkIndex([{ id: 'd', name: 'notes.txt', text: many.join('\n\n') }]);
    const common = rankChunks(index, 'pipeline');
    expect(common.length).toBe(MAX_DOCUMENT_CHUNKS);
    const rare = rankChunks(index, 'flink pipeline');
    expect(rare[0]!.text).toContain('Flink');
    expect(rare.length).toBe(MIN_CHUNKS);
  });

  it('gives the same parts for the same question', () => {
    const index = buildChunkIndex(documents);
    const question = 'What does the payroll process involve?';
    expect(rankChunks(index, question)).toEqual(rankChunks(index, question));
  });

  it('indexes a 500k-character document in well under a second', () => {
    const big = Array.from({ length: 900 }, (_, i) => paragraph(`subject${i % 50}`, 8)).join(
      '\n\n',
    );
    expect(big.length).toBeGreaterThan(450_000);
    const started = performance.now();
    const index = buildChunkIndex([{ id: 'big', name: 'big.pdf', text: big }]);
    const ranked = rankChunks(index, 'subject7 process');
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.reduce((total, chunk) => total + chunk.text.length, 0)).toBeLessThanOrEqual(
      MAX_DOCUMENT_CHUNKS * MAX_DOCUMENT_CHUNK_CHARS,
    );
  });
});
