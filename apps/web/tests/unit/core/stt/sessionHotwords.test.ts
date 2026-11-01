/**
 * Tests for apps/web/src/core/stt/sessionHotwords.ts on invented session data: buildHotwords()
 * puts key terms first (keeping a typed " :score"), then the company and the role, then terms
 * that repeat in documents; removes duplicates; drops phrases that are too long or have no
 * letters; caps the list at MAX_HOTWORDS; adds the technical vocabulary for Interview sessions
 * only (after the role, before documents) and at most MAX_DOCUMENT_TERMS document terms.
 * extractDocumentTerms() finds repeated names and
 * acronyms (a comma ends a name; a verb starting a sentence is not part of the name), ignores
 * capitalised sentence starters and common words, needs two mentions and
 * sorts by mentions (ties alphabetical). hotwordsText() writes the engine's "PHRASE :score" lines.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHotwords,
  cleanPhrase,
  DOCUMENT_TERM_SCORE,
  extractDocumentTerms,
  hotwordsText,
  INTERVIEW_TECH_TERMS,
  KEY_TERM_SCORE,
  MAX_DOCUMENT_TERMS,
  MAX_HOTWORDS,
  ROLE_SCORE,
  TECH_TERM_SCORE,
} from '@/core/stt/sessionHotwords';

/**
 * An invented session with the given key terms, company and role.
 *
 * @param keyTerms Key terms, one per line.
 * @param company  Company.
 * @param role     Role or topic.
 * @returns The fields buildHotwords() reads.
 */
function session(keyTerms: string, company = 'Northwind Logistics', role = 'Renewal review') {
  return {
    company,
    role,
    preferences: {
      language: 'en' as const,
      model: 'fast' as const,
      style: {
        format: 'headline+bullets' as const,
        length: 'short' as const,
        tone: 'simple' as const,
      },
      keyTerms,
    },
  };
}

describe('buildHotwords', () => {
  it('orders key terms, company, role, then document terms, without duplicates', () => {
    const documents = [
      {
        text: 'We met Acme Robotics today. Later, Acme Robotics sent the CRM export. The CRM is new.',
      },
    ];
    const hotwords = buildHotwords(
      session('Bluefin Route\nprofessional plan :3\nNorthwind Logistics'),
      documents,
    );
    expect(hotwords).toEqual([
      { phrase: 'BLUEFIN ROUTE', score: KEY_TERM_SCORE },
      { phrase: 'PROFESSIONAL PLAN', score: 3 },
      // The company is already a key term: kept once, at its first (key-term) place.
      { phrase: 'NORTHWIND LOGISTICS', score: KEY_TERM_SCORE },
      { phrase: 'RENEWAL REVIEW', score: ROLE_SCORE },
      { phrase: 'ACME ROBOTICS', score: DOCUMENT_TERM_SCORE },
      { phrase: 'CRM', score: DOCUMENT_TERM_SCORE },
    ]);
  });

  it('drops phrases that are too long, too short or have no letters', () => {
    const hotwords = buildHotwords(
      session('this whole line is clearly a sentence not a name\nX\n12345\nKite', '', ''),
      [],
    );
    expect(hotwords.map((h) => h.phrase)).toEqual(['KITE']);
  });

  it(`stops at ${MAX_HOTWORDS} phrases`, () => {
    const many = Array.from(
      { length: 150 },
      (_, i) =>
        `Term ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
    );
    expect(buildHotwords(session(many.join('\n')), [])).toHaveLength(MAX_HOTWORDS);
  });

  it('works for a session with nothing to listen for', () => {
    expect(buildHotwords(session('', '', ''), [])).toEqual([]);
  });
});

describe('extractDocumentTerms', () => {
  it('finds repeated names and acronyms, most mentioned first', () => {
    const terms = extractDocumentTerms([
      'Contact Northwind Logistics about the SLA. Northwind Logistics agreed.',
      'The SLA covers Bluefin Route. Again: SLA and Northwind Logistics.',
    ]);
    expect(terms).toEqual([
      { phrase: 'NORTHWIND LOGISTICS', mentions: 3 },
      { phrase: 'SLA', mentions: 3 },
    ]);
  });

  it('ignores sentence starters, common words and single mentions', () => {
    const terms = extractDocumentTerms([
      'Thanks for the call. Thanks again. The plan starts Monday. On Monday we meet Globex.',
    ]);
    // "Thanks" and "The" only start sentences; "Monday" is a common word; Globex appears once.
    expect(terms).toEqual([]);
  });

  it('trims common words from the ends of a name and drops a possessive', () => {
    const terms = extractDocumentTerms([
      "We asked The Initech Team. Then The Initech Team's lead replied.",
    ]);
    expect(terms).toEqual([{ phrase: 'INITECH TEAM', mentions: 2 }]);
  });
});

describe('cleanPhrase / hotwordsText', () => {
  it('cleans to the model alphabet', () => {
    expect(cleanPhrase('  Bluefin-Route! ')).toBe('BLUEFIN ROUTE');
    expect(cleanPhrase('O')).toBeNull();
  });

  it('writes one "PHRASE :score" per line', () => {
    expect(
      hotwordsText([
        { phrase: 'BLUEFIN ROUTE', score: 2 },
        { phrase: 'CRM', score: 1.5 },
      ]),
    ).toBe('BLUEFIN ROUTE :2\nCRM :1.5');
    expect(hotwordsText([])).toBe('');
  });
});

describe('buildHotwords: Interview vocabulary and the document cap (Day 6 Stage 4c)', () => {
  it('adds the technical vocabulary for Interview sessions only, after the role', () => {
    const interview = buildHotwords({ ...session('Bluefin Route'), type: 'interview' }, []);
    const phrases = interview.map((hotword) => hotword.phrase);
    expect(phrases.slice(0, 3)).toEqual(['BLUEFIN ROUTE', 'NORTHWIND LOGISTICS', 'RENEWAL REVIEW']);
    expect(phrases).toContain('RAG');
    expect(phrases).toContain('VECTOR DATABASE');
    expect(interview.find((hotword) => hotword.phrase === 'LLM')?.score).toBe(TECH_TERM_SCORE);
    expect(interview).toHaveLength(3 + INTERVIEW_TECH_TERMS.length);
    expect(buildHotwords({ ...session('Bluefin Route'), type: 'sales' }, [])).toHaveLength(3);
  });

  it('uses at most MAX_DOCUMENT_TERMS document terms, the most mentioned first', () => {
    // 60 invented acronyms, each mentioned twice; the first ten three times.
    const names = Array.from(
      { length: 60 },
      (_, i) =>
        `Q${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
    );
    const text = names
      .map((name, i) => `We met ${name} and ${name}${i < 10 ? ` and ${name}` : ''} today.`)
      .join(' ');
    const hotwords = buildHotwords(session('', '', ''), [{ text }]);
    expect(hotwords).toHaveLength(MAX_DOCUMENT_TERMS);
    expect(hotwords.slice(0, 10).map((hotword) => hotword.phrase)).toEqual(
      names.slice(0, 10).sort(),
    );
  });
});
