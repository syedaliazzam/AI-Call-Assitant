/**
 * Tests sourceLabel() in packages/shared/src/answer-meta.ts: the private source tag's words on an
 * answer card. A made-up example story (the "Full example story" setting) says it is not from the CV
 * or documents (ADR-0084); documents read "From your CV" only where the documents are the CV.
 */
import { sourceLabel } from '@kite/shared';
import { describe, expect, it } from 'vitest';

describe('sourceLabel', () => {
  it('marks an example story as not from the CV in an interview or mock', () => {
    expect(sourceLabel('example', 'interview')).toBe('Example — not from your CV');
    expect(sourceLabel('example', 'mock')).toBe('Example — not from your CV');
  });

  it('says "your documents" for an example outside an interview', () => {
    expect(sourceLabel('example', 'regular')).toBe('Example — not from your documents');
    expect(sourceLabel('example')).toBe('Example — not from your documents');
  });

  it('keeps the other tags as they were', () => {
    expect(sourceLabel('docs', 'interview')).toBe('From your CV');
    expect(sourceLabel('docs', 'regular')).toBe('From your documents');
    expect(sourceLabel('call')).toBe('From the call');
    expect(sourceLabel('general')).toBe('General knowledge');
  });
});
