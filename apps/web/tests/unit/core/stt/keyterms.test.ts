/**
 * Tests for buildKeyterms() in apps/web/src/core/stt/sessionHotwords.ts (ADR-0076; Batch D P1-F, ADR-0079):
 * the session's keyterms for Deepgram keep the hotwords' sources as people write them (case and digits
 * kept, no scores), without duplicates; the session's Key terms come first, then the signed-in user's first
 * name and the contact's name, then company, role, the interview vocabulary, document names and (Batch D)
 * single capitalised words that repeat across runs ("Freshdesk", "Toptal"); at most MAX_KEYTERMS (100) and
 * MAX_KEYTERM_CHARS in all. Also extractSingleWordTerms() and firstNameOf(). All data is invented. ADR-0136: extractInstructionTerms() and the instruction terms in buildKeyterms().
 */
import { describe, expect, it } from 'vitest';
import {
  buildKeyterms,
  extractInstructionTerms,
  extractSingleWordTerms,
  firstNameOf,
  MAX_KEYTERM_CHARS,
  MAX_KEYTERMS,
} from '@/core/stt/sessionHotwords';

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

  it(`stops at ${MAX_KEYTERMS} and drops terms that are too long or have no letters`, () => {
    expect(MAX_KEYTERMS).toBe(100);
    const many = Array.from(
      { length: 130 },
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

  it('Batch D: the Key terms first, then the user’s first name and the contact’s name', () => {
    const terms = buildKeyterms(
      {
        company: 'Harbor Lane',
        role: 'Backend engineer',
        contactName: 'Dana Okafor',
        type: 'interview',
        preferences: { keyTerms: 'Qdrant\nsupport copilot' } as never,
      },
      [],
      { accountFirstName: 'Sam' },
    );
    expect(terms.slice(0, 6)).toEqual([
      'Qdrant',
      'support copilot',
      'Sam',
      'Dana Okafor',
      'Harbor Lane',
      'Backend engineer',
    ]);
    // Without a name nothing is added in its place.
    expect(
      buildKeyterms(
        { company: 'Harbor Lane', role: '', preferences: { keyTerms: '' } as never },
        [],
      ),
    ).toEqual(['Harbor Lane']);
  });

  it('Batch D: single capitalised words that repeat across runs qualify (the 14 Nov Freshdesk/Toptal case)', () => {
    // Invented CV lines: each name appears once alone at a sentence start and once inside another run.
    const cv = [
      'Freshdesk tickets were triaged by a copilot I built.',
      'Integrated Zendesk Freshdesk webhooks for the support team.',
      'Toptal contract, remote.',
      'Freelance AI work through Toptal for two clients.',
    ].join('\n');
    const terms = buildKeyterms(
      { company: 'Harbor Lane', role: 'AI engineer', preferences: { keyTerms: '' } as never },
      [{ text: cv }],
    );
    expect(terms).toContain('Freshdesk');
    expect(terms).toContain('Toptal');
  });

  it(`Batch D: stays within ${MAX_KEYTERM_CHARS} characters in all`, () => {
    const long = Array.from({ length: 100 }, (_, i) => `Longer invented term number ${i}`);
    const terms = buildKeyterms(
      { company: '', role: '', preferences: { keyTerms: long.join('\n') } as never },
      [],
    );
    expect(terms.join('').length).toBeLessThanOrEqual(MAX_KEYTERM_CHARS);
    expect(terms.length).toBeLessThan(100);
    // The user's own terms keep their order: the first ones are in.
    expect(terms[0]).toBe('Longer invented term number 0');
  });
});

describe('extractSingleWordTerms (Batch D)', () => {
  it('needs two mentions, one of them inside a sentence; leaves out acronyms, common and heading words', () => {
    const words = extractSingleWordTerms([
      'Kafka was new to me. We moved queues to Kafka last year.',
      'Experience\nEngineer at Harbor. Senior Engineer at Harbor.',
      'Built the API. Built the CRM. The API was fast.',
      'Monday standup. Monday retro.',
    ]);
    expect(words).toContain('Kafka');
    expect(words).toContain('Harbor');
    // Only ever at a sentence start ("Built"), acronyms, heading words, days.
    expect(words).not.toContain('Built');
    expect(words).not.toContain('API');
    expect(words).not.toContain('Engineer');
    expect(words).not.toContain('Monday');
  });

  it('sorts by mentions, ties alphabetical', () => {
    expect(
      extractSingleWordTerms(['Using Zeta and Alpha. Using Alpha and Zeta. Using Alpha again.']),
    ).toEqual(['Alpha', 'Zeta']);
  });
});

describe('firstNameOf (Batch D)', () => {
  it('takes the first word with at least two letters', () => {
    expect(firstNameOf('Sam Rivera')).toBe('Sam');
    expect(firstNameOf('  Dana  ')).toBe('Dana');
    expect(firstNameOf('J')).toBe('');
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf(null)).toBe('');
  });
});

describe('terms from the session instructions and description (ADR-0136)', () => {
  it('takes acronyms, inner-capital names and capitalised runs inside a sentence, once each', () => {
    const terms = extractInstructionTerms([
      'Keep answers short. We use LangFuse and BM25 for the SOW review with Priya Raman at Northwind.',
      'Please mention the SOW only if asked. US teams are out of scope.',
    ]);
    expect(terms).toEqual(['LangFuse', 'BM25', 'SOW', 'Priya Raman', 'Northwind']);
  });

  it('adds them to the keyterms after the company and role, before the document terms', () => {
    const terms = buildKeyterms(
      {
        company: 'Acme Freight',
        role: 'Account review',
        preferences: { keyTerms: 'Bluefin Route' } as never,
        instructions: 'Spell our tool as LangFuse.',
        description: '',
      },
      [],
    );
    expect(terms).toEqual(['Bluefin Route', 'Acme Freight', 'Account review', 'LangFuse']);
  });
});
