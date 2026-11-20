/**
 * Tests leadingTemplateLine(), containsTemplateLine() and isTemplateQuestion() in
 * packages/shared/src/answer-meta.ts (ADR-0112): a hidden line copied as a blank template
 * ("[[type|for|source]]", "[[question|…]]") is told apart from a real, filled-in hidden line, so the
 * server can stop such a reply and the evaluation can count it.
 */
import { containsTemplateLine, isTemplateQuestion, leadingTemplateLine } from '@kite/shared';
import { describe, expect, it } from 'vitest';

describe('leadingTemplateLine', () => {
  it('finds the copied first-line templates, with the line break after them', () => {
    expect(leadingTemplateLine('[[type|for|source]]\nThe answer')).toBe('[[type|for|source]]\n');
    expect(leadingTemplateLine('  [[ Type | for | source ]]')).toBe('[[ Type | for | source ]]');
    // The same slots under a real first word, and the Ask AI page's old template.
    expect(leadingTemplateLine('[[concept|for|source]]\n')).not.toBeNull();
    expect(leadingTemplateLine('[[type|kite|source]]\n')).not.toBeNull();
    expect(leadingTemplateLine('[[type|call|general]]\n')).not.toBeNull();
  });

  it('finds the copied question-line templates', () => {
    expect(leadingTemplateLine('[[question|…]]\n')).not.toBeNull();
    expect(leadingTemplateLine('[[question|...]]\n')).not.toBeNull();
    expect(leadingTemplateLine('[[question|the question you answered]]\n')).not.toBeNull();
    expect(leadingTemplateLine('[[question|for|source]]\n')).not.toBeNull();
  });

  it('leaves real hidden lines alone, including filled-in example lines', () => {
    expect(leadingTemplateLine('[[concept|call|general]]\nCaching keeps…')).toBeNull();
    expect(leadingTemplateLine('[[coding|kite|docs]]\n')).toBeNull();
    expect(leadingTemplateLine('[[question|How does the auth flow work?]]\n')).toBeNull();
    // A real question that happens to use a slot word is not a template.
    expect(leadingTemplateLine('[[question|What is the source of the data?]]\n')).toBeNull();
    // An oddly filled line a real reply wrote (k-maths): it names a slot but holds a real reader and
    // source, which the app reads.
    expect(leadingTemplateLine('[[calculation|for|kite|general]]\n')).toBeNull();
  });

  it('needs the whole line: text that only starts like one, or code, is not a template', () => {
    expect(leadingTemplateLine('[[type|for|sou')).toBeNull();
    expect(leadingTemplateLine('[[type|for|source]] and more on the line')).toBeNull();
    expect(leadingTemplateLine('Hmm.\n[[type|for|source]]')).toBeNull();
    expect(leadingTemplateLine('[[1, 2], [3, 4]]')).toBeNull();
  });
});

describe('containsTemplateLine', () => {
  it('finds a template anywhere in a reply', () => {
    expect(containsTemplateLine('[[concept|call|general]]\nAnswer.\n[[question|…]]')).toBe(true);
    expect(containsTemplateLine('Correct output:\n[[type|for|source]]\nAnswer.')).toBe(true);
  });

  it('is false for a reply with real hidden lines only', () => {
    expect(
      containsTemplateLine('[[concept|call|general]]\nAnswer.\n[[question|How does it work?]]'),
    ).toBe(false);
    expect(containsTemplateLine('matrix = [[1, 2], [3, 4]]')).toBe(false);
  });
});

describe('isTemplateQuestion', () => {
  it('is true for placeholder values only', () => {
    expect(isTemplateQuestion('…')).toBe(true);
    expect(isTemplateQuestion(' The question you answered ')).toBe(true);
    expect(isTemplateQuestion('How does the auth flow work?')).toBe(false);
  });
});
