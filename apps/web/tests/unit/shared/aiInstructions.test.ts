/**
 * Tests for packages/shared/src/aiInstructions.ts (ADR-0089): lintGlobalPrompt() flags lines that try to
 * set the answer's layout or a user's personal preferences (as whole words, any case), but not lines
 * that are exactly the default prompt's; normaliseGlobalPrompt() cleans line endings and outer spaces.
 */
import { lintGlobalPrompt, normaliseGlobalPrompt, PROMPT_LINT_MESSAGE } from '@kite/shared';
import { describe, expect, it } from 'vitest';

describe('lintGlobalPrompt', () => {
  it('flags layout and preference words, line by line', () => {
    const hints = lintGlobalPrompt(
      [
        'Always mention our free trial.',
        'Start with a HEADLINE and use bullet points.',
        'Keep the tone formal and the length detailed.',
        'Always reply in English.',
        'Put [[sales]] first.',
        'Stone, formatting and lengthy are fine.',
      ].join('\n'),
    );
    expect(hints).toEqual([
      { line: 2, terms: ['headline', 'bullet'] },
      { line: 3, terms: ['length', 'tone'] },
      { line: 4, terms: ['always reply'] },
      { line: 5, terms: ['[['] },
    ]);
    expect(PROMPT_LINT_MESSAGE).toBe(
      'Structure and personal preferences are set elsewhere — describe what to say, not how answers are laid out.',
    );
  });

  it("leaves the default prompt's own lines alone, but flags them once edited", () => {
    const baseline = "- Follow the user's answer format, length and tone.";
    expect(lintGlobalPrompt(baseline, baseline)).toEqual([]);
    expect(lintGlobalPrompt(`${baseline} Use bullets.`, baseline)).toHaveLength(1);
  });
});

describe('normaliseGlobalPrompt', () => {
  it('cleans line endings and outer spaces only', () => {
    expect(normaliseGlobalPrompt('  a\r\nb\rc  \n')).toBe('a\nb\nc');
  });
});
