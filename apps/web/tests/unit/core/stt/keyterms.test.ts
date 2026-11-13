/**
 * Tests for buildKeyterms() in apps/web/src/core/stt/sessionHotwords.ts (ADR-0076): the session's keyterms
 * for Deepgram keep the hotwords' sources and order, as people write them (case and digits kept, no
 * scores), without duplicates, and at most 50.
 */
import { describe, expect, it } from 'vitest';
import { buildKeyterms, MAX_KEYTERMS } from '@/core/stt/sessionHotwords';

describe('buildKeyterms', () => {
  it('takes key terms, company, role, the interview vocabulary and document names, in that order', () => {
    const terms = buildKeyterms(
      {
        company: 'Northwind Logistics',
        role: 'Platform Engineer',
        type: 'interview',
        preferences: { keyTerms: 'BM25 :3\nKubernetes, kubernetes' } as never,
      },
      [{ text: 'Worked with Contoso Pharma on CRM. Later, Contoso Pharma liked the CRM work.' }],
    );
    expect(terms.slice(0, 4)).toEqual([
      'BM25',
      'Kubernetes',
      'Northwind Logistics',
      'Platform Engineer',
    ]);
    expect(terms).toContain('RAG');
    expect(terms).toContain('Contoso Pharma');
    expect(terms).toContain('CRM');
    // No duplicates, ignoring case.
    expect(terms.filter((term) => term.toLowerCase() === 'kubernetes')).toHaveLength(1);
  });

  it('stops at 50 and drops terms that are too long or have no letters', () => {
    const many = Array.from(
      { length: 80 },
      (_, i) => `Term${String.fromCharCode(65 + (i % 26))}${i}`,
    );
    const terms = buildKeyterms(
      {
        company: '42',
        role: 'a very long role title that has far too many words in it',
        preferences: { keyTerms: many.join('\n') } as never,
      },
      [],
    );
    expect(terms).toHaveLength(MAX_KEYTERMS);
    expect(terms).not.toContain('42');
  });
});
