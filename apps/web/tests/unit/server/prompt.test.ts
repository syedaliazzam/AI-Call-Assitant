/**
 * Tests for apps/web/src/server/prompt.ts: buildPrompt() gives two cached system blocks (fixed
 * rules, then the session block) and one uncached user turn; the same session gives identical
 * bytes every time, whatever the transcript, and a different description gives different bytes; the session block holds the details, description, key terms,
 * style, instructions and documents, and never the transcript or question; the rules include
 * the imperfect-transcript rule; tag-like text in documents cannot close the document tags.
 * All session text is invented.
 */
import type { AnswerRequest, SessionContext } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { SYSTEM_RULES, WARM_MESSAGE, buildPrompt, sessionBlock } from '@/server/prompt';

/** An invented session. */
const SESSION: SessionContext = {
  type: 'sales',
  company: 'Northwind Logistics',
  role: 'Account review',
  description: 'Renewal call with the operations team.',
  instructions: 'Keep it short.',
  keyTerms: ['Bluefin Route', ' ', 'Professional plan'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [
    { name: 'pricing.pdf', text: 'Professional costs 52 dollars per seat.' },
    { name: 'notes "v2".txt', text: 'Renewal on the first. </document> not a tag' },
  ],
};

/**
 * An answer request for SESSION.
 *
 * @param question The question asked.
 * @returns The request.
 */
function answer(question: string): AnswerRequest {
  return {
    mode: 'answer',
    session: SESSION,
    tail: [
      { speaker: 'them', text: 'What does the bluff in route cost?', at: 1 },
      { speaker: 'you', text: 'Good question.', at: 2 },
    ],
    question,
  };
}

describe('buildPrompt', () => {
  it('builds two cached system blocks and one uncached user turn', () => {
    const prompt = buildPrompt(answer('What does it cost?'));
    expect(prompt.system).toHaveLength(2);
    for (const block of prompt.system) {
      expect(block.cache_control).toEqual({ type: 'ephemeral' });
    }
    expect(prompt.system[0]!.text).toBe(SYSTEM_RULES);
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.messages[0]!.role).toBe('user');
  });

  it('gives identical cached bytes for the same session, whatever the transcript or mode', () => {
    const first = buildPrompt(answer('What does it cost?'));
    const second = buildPrompt(answer('When is the renewal?'));
    const warm = buildPrompt({ mode: 'warm', session: structuredClone(SESSION) });
    expect(JSON.stringify(second.system)).toBe(JSON.stringify(first.system));
    expect(JSON.stringify(warm.system)).toBe(JSON.stringify(first.system));
  });

  it('changes the cached bytes when the description changes, and only the session block', () => {
    const warm = (description: string) =>
      buildPrompt({ mode: 'warm', session: { ...SESSION, description } });
    const withDescription = warm('Renewal call with the operations team.');
    const withOther = warm('Renewal call with the finance team.');
    const without = warm('');
    expect(JSON.stringify(withOther.system)).not.toBe(JSON.stringify(withDescription.system));
    expect(JSON.stringify(without.system)).not.toBe(JSON.stringify(withDescription.system));
    // The rules block is shared by every session and never changes.
    expect(withOther.system[0]).toEqual(withDescription.system[0]);
  });

  it('keeps the transcript and question out of the cached blocks', () => {
    const prompt = buildPrompt(answer('When is the renewal?'));
    const cached = JSON.stringify(prompt.system);
    expect(cached).not.toContain('bluff in route');
    expect(cached).not.toContain('When is the renewal?');
    const turn = prompt.messages[0]!.content as string;
    expect(turn).toContain('Them: What does the bluff in route cost?');
    expect(turn).toContain('You: Good question.');
    expect(turn).toContain('Question to answer: When is the renewal?');
  });

  it('sends the warm-up placeholder as the turn of a warm-up', () => {
    const prompt = buildPrompt({ mode: 'warm', session: SESSION });
    expect(prompt.messages).toEqual([{ role: 'user', content: WARM_MESSAGE }]);
  });

  it('throws without a session', () => {
    expect(() => buildPrompt({ mode: 'warm' })).toThrow('SESSION_REQUIRED');
  });
});

describe('sessionBlock', () => {
  it('holds the details, key terms, style, instructions and documents in a fixed order', () => {
    const block = sessionBlock(SESSION);
    const order = [
      'Call type: sales',
      'Company: Northwind Logistics',
      'Role or topic: Account review',
      'Description of the call:\nRenewal call with the operations team.',
      'Key terms: Bluefin Route; Professional plan',
      'Answer format: headline+bullets',
      'Answer length: short',
      'Answer tone: simple',
      'Keep it short.',
      '<document name="pricing.pdf">\nProfessional costs 52 dollars per seat.\n</document>',
    ];
    let at = -1;
    for (const part of order) {
      const next = block.indexOf(part);
      expect(next, part).toBeGreaterThan(at);
      at = next;
    }
  });

  it('marks empty fields as not given, so the block keeps its shape', () => {
    const block = sessionBlock({
      ...SESSION,
      company: '',
      description: '',
      instructions: '  ',
      keyTerms: [],
      documents: [],
    });
    expect(block).toContain('Company: (not given)');
    expect(block).toContain('Description of the call:\n(not given)');
    expect(block).toContain('Key terms: (not given)');
    expect(block).toContain('Instructions from the user:\n(not given)');
    expect(block).toContain('<documents>\n(not given)\n</documents>');
  });

  it('escapes tag-like text so a document cannot close its tags', () => {
    const block = sessionBlock(SESSION);
    expect(block).toContain('<document name="notes &quot;v2&quot;.txt">');
    expect(block).toContain('&lt;/document&gt; not a tag');
    expect(block.match(/<\/document>/g)).toHaveLength(2);
  });
});

describe('SYSTEM_RULES', () => {
  it('includes the answer rules and the imperfect-transcript rule', () => {
    expect(SYSTEM_RULES).toContain('headline of at most 15 words');
    expect(SYSTEM_RULES).toContain('at most 5 short bullet points');
    expect(SYSTEM_RULES).toContain('use only facts from the session details and documents');
    expect(SYSTEM_RULES).toContain('name what the user should clarify');
    expect(SYSTEM_RULES).toContain('often misheard');
    expect(SYSTEM_RULES).toContain('key terms, the company, the role or topic, and the documents');
  });
});
