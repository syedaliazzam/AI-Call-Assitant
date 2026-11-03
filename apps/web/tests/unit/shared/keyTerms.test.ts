/**
 * Tests packages/shared/src/keyTerms.ts: key terms pasted as one comma- or semicolon-separated
 * line are split, trimmed, deduplicated (ignoring case), cut to 60 characters and capped at 100
 * (v1.0.1: such a paste was stored as one term and every answer failed).
 */
import { describe, expect, it } from 'vitest';
import { MAX_KEY_TERM_CHARS, MAX_KEY_TERMS, normaliseKeyTerms, parseKeyTerms } from '@kite/shared';

describe('parseKeyTerms', () => {
  it('splits on commas, semicolons and new lines, and trims', () => {
    expect(parseKeyTerms(' Kubernetes,Terraform ;  BM25\r\nH100\n\nHarbor  Lane ')).toEqual([
      'Kubernetes',
      'Terraform',
      'BM25',
      'H100',
      'Harbor Lane',
    ]);
  });

  it('drops duplicates whatever their case, keeping the first spelling', () => {
    expect(parseKeyTerms('PostgreSQL, postgresql, POSTGRESQL, Redis')).toEqual([
      'PostgreSQL',
      'Redis',
    ]);
  });

  it('cuts a term to 60 characters and keeps at most 100 terms', () => {
    const [long] = parseKeyTerms('y'.repeat(200));
    expect(long).toHaveLength(MAX_KEY_TERM_CHARS);
    const many = Array.from({ length: 150 }, (_, i) => `Term ${i}`).join(', ');
    expect(parseKeyTerms(many)).toHaveLength(MAX_KEY_TERMS);
  });

  it('accepts a list, splitting each item (an older request or session)', () => {
    expect(parseKeyTerms(['Alpha, Beta', 'Gamma'])).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('gives nothing for empty input', () => {
    expect(parseKeyTerms(' , ;\n ')).toEqual([]);
  });
});

describe('normaliseKeyTerms', () => {
  it('stores one clean term per line', () => {
    expect(normaliseKeyTerms('Kubernetes, Terraform; BM25')).toBe('Kubernetes\nTerraform\nBM25');
  });
});
