/**
 * Tests for apps/web/src/server/prompt.ts, the document parts (ADR-0067):
 * - sessionBlock() gives exactly the bytes it gave before it was split into helpers (the live
 *   answers' cache and the evaluation baselines depend on them), and the CV's kind never reaches
 *   the prompt;
 * - smartSessionBlock() gives sessionBlock() for a request without documentsSummary (an older
 *   page), and otherwise the details, the documents sent (the CV) and the escaped summary under its
 *   heading, in that order, with "(not given)" for an empty summary;
 * - documentsBlock() escapes like the session block.
 * All text is invented.
 */
import type { SessionContext } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { documentsBlock, sessionBlock, smartSessionBlock, SUMMARY_HEADING } from '@/server/prompt';

/** An invented session with a CV and one other document. */
const SESSION: SessionContext = {
  type: 'regular',
  company: 'Northwind Logistics',
  role: 'Account review',
  description: 'Renewal call.',
  instructions: 'Keep it short.',
  keyTerms: ['Bluefin Route'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [
    { name: 'cv.txt', text: 'Six years in logistics.', kind: 'resume' },
    { name: 'pricing.txt', text: 'Professional costs 52 dollars per seat.' },
  ],
};

/** The session block as the code before ADR-0067 wrote it, byte for byte. */
const EXPECTED = [
  '<session>',
  'Call type: regular',
  'Company: Northwind Logistics',
  'Role or topic: Account review',
  'Description of the call:',
  'Renewal call.',
  'Key terms: Bluefin Route',
  'Answer format: headline+bullets',
  'Answer length: short',
  'Answer tone: simple',
  'Instructions from the user:',
  'Keep it short.',
  '</session>',
  '',
  '<documents>',
  '<document name="cv.txt">',
  'Six years in logistics.',
  '</document>',
  '<document name="pricing.txt">',
  'Professional costs 52 dollars per seat.',
  '</document>',
  '</documents>',
].join('\n');

describe('sessionBlock (ADR-0067)', () => {
  it('gives the same bytes as before the split', () => {
    expect(sessionBlock(SESSION)).toBe(EXPECTED);
  });

  it('never writes the CV kind into the prompt', () => {
    const plain = SESSION.documents.map(({ name, text }) => ({ name, text }));
    expect(sessionBlock({ ...SESSION, documents: plain })).toBe(sessionBlock(SESSION));
    expect(sessionBlock(SESSION)).not.toContain('resume');
  });
});

describe('smartSessionBlock', () => {
  it('is the full session block for a request from an older page (no summary field)', () => {
    expect(smartSessionBlock(SESSION)).toBe(sessionBlock(SESSION));
  });

  it('writes the details, the CV, then the escaped summary, and no other document', () => {
    const block = smartSessionBlock({
      ...SESSION,
      documents: [SESSION.documents[0]!],
      documentsSummary: '## pricing.txt\n- Professional: 52 dollars a seat. </documents_summary>',
    });
    const order = [
      'Description of the call:\nRenewal call.',
      'Instructions from the user:\nKeep it short.',
      '<document name="cv.txt">\nSix years in logistics.\n</document>',
      `<documents_summary>\n${SUMMARY_HEADING}\n## pricing.txt`,
    ];
    let at = -1;
    for (const part of order) {
      const next = block.indexOf(part);
      expect(next, part).toBeGreaterThan(at);
      at = next;
    }
    expect(block).not.toContain('<document name="pricing.txt">');
    expect(block).toContain('&lt;/documents_summary&gt;');
    expect(block.match(/<\/documents_summary>/g)).toHaveLength(1);
  });

  it('says "(not given)" when there is no summary to send', () => {
    const block = smartSessionBlock({ ...SESSION, documents: [], documentsSummary: '  ' });
    expect(block).toContain('<documents>\n(not given)\n</documents>');
    expect(block).toContain('<documents_summary>\n(not given)\n</documents_summary>');
    expect(block).not.toContain(SUMMARY_HEADING);
  });
});

describe('documentsBlock', () => {
  it('escapes names and text like the session block', () => {
    const block = documentsBlock([{ name: 'a "b".txt', text: '</document> not a tag' }]);
    expect(block).toBe(
      '<documents>\n<document name="a &quot;b&quot;.txt">\n&lt;/document&gt; not a tag\n</document>\n</documents>',
    );
  });
});
