/**
 * Tests for apps/web/src/core/admin/promptDocument.ts (ADR-0089): the Preview's blocks (colon and "#"
 * headings, bullets with levels, quoted examples, paragraphs), the inline runs (bold, code, quoted
 * words), each line's kind for the editor, bullet marks, and search matches.
 */
import { describe, expect, it } from 'vitest';
import {
  bulletMarkLength,
  findMatches,
  inlineRuns,
  lineKind,
  promptBlocks,
} from '@/core/admin/promptDocument';

/** An invented prompt in the default prompt's style. */
const PROMPT = `How to answer for the call:
- Answer the question.
  - A nested point.
- Examples of the shape only:
  A CV has a close project. "Have you run Airflow?"
## Tone
Write **plainly**, with \`code\` when needed.
> A quoted example.`;

describe('promptBlocks', () => {
  it('reads headings, lists with levels, quoted examples and paragraphs', () => {
    expect(promptBlocks(PROMPT)).toEqual([
      { kind: 'heading', level: 1, text: 'How to answer for the call' },
      {
        kind: 'list',
        items: [
          { text: 'Answer the question.', level: 0 },
          { text: 'A nested point.', level: 1 },
          { text: 'Examples of the shape only:', level: 0 },
        ],
      },
      { kind: 'quote', lines: ['A CV has a close project. "Have you run Airflow?"'] },
      { kind: 'heading', level: 2, text: 'Tone' },
      { kind: 'paragraph', text: 'Write **plainly**, with `code` when needed.' },
      { kind: 'quote', lines: ['A quoted example.'] },
    ]);
  });

  it('gives nothing for an empty prompt', () => {
    expect(promptBlocks('  \n\n')).toEqual([]);
  });
});

describe('inlineRuns', () => {
  it('splits bold, code and quoted words from plain text', () => {
    expect(inlineRuns('Say **this**, run `x`, then "Hi there".')).toEqual([
      { text: 'Say ', style: 'plain' },
      { text: 'this', style: 'bold' },
      { text: ', run ', style: 'plain' },
      { text: 'x', style: 'code' },
      { text: ', then ', style: 'plain' },
      { text: '"Hi there"', style: 'quoted' },
      { text: '.', style: 'plain' },
    ]);
  });
});

describe('the editor helpers', () => {
  it('names each line kind and the bullet mark length', () => {
    expect(lineKind('How to answer for the call:')).toBe('heading');
    expect(lineKind('# Tone')).toBe('heading');
    expect(lineKind('- A rule.')).toBe('bullet');
    expect(lineKind('  An example.')).toBe('quote');
    expect(lineKind('Plain words.')).toBe('text');
    expect(lineKind('')).toBe('blank');
    expect(bulletMarkLength('- A rule.')).toBe(2);
    expect(bulletMarkLength('  1. Step')).toBe(5);
    expect(bulletMarkLength('Plain')).toBe(0);
  });

  it('finds every match, any case, without overlaps', () => {
    expect(findMatches('Price and price, PRICE.', 'price')).toEqual([
      [0, 5],
      [10, 15],
      [17, 22],
    ]);
    expect(findMatches('aaa', 'aa')).toEqual([[0, 2]]);
    expect(findMatches('anything', '')).toEqual([]);
  });
});
