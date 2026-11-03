/**
 * Tests apps/web/src/core/answer/markdown.ts: splitting a private answer into paragraphs, lists,
 * headings and code blocks while it streams, and inline bold and code marks.
 */
import { describe, expect, it } from 'vitest';
import { inlinePieces, markdownBlocks } from '@/core/answer/markdown';

describe('markdownBlocks', () => {
  it('joins lines of a paragraph, and splits at a blank line', () => {
    expect(markdownBlocks('One\ntwo\n\nThree')).toEqual([
      { kind: 'paragraph', text: 'One two' },
      { kind: 'paragraph', text: 'Three' },
    ]);
  });

  it('groups list items, numbered and not', () => {
    expect(markdownBlocks('- a\n- b\n1. c')).toEqual([
      { kind: 'list', ordered: false, items: ['a', 'b'] },
      { kind: 'list', ordered: true, items: ['c'] },
    ]);
  });

  it('keeps a code block whole, with its language', () => {
    expect(markdownBlocks('```python\n- not a list\n\nx = 1\n```\nAfter')).toEqual([
      { kind: 'code', language: 'python', text: '- not a list\n\nx = 1' },
      { kind: 'paragraph', text: 'After' },
    ]);
  });

  it('shows a code block still arriving', () => {
    expect(markdownBlocks('```js\nconst a')).toEqual([
      { kind: 'code', language: 'js', text: 'const a' },
    ]);
  });

  it('reads headings', () => {
    expect(markdownBlocks('## Title')).toEqual([{ kind: 'heading', text: 'Title' }]);
  });
});

describe('inlinePieces', () => {
  it('splits at bold and code marks, without the marks', () => {
    expect(inlinePieces('a **b** `c` d')).toEqual([
      { text: 'a ', style: 'plain' },
      { text: 'b', style: 'bold' },
      { text: ' ', style: 'plain' },
      { text: 'c', style: 'code' },
      { text: ' d', style: 'plain' },
    ]);
  });

  it('leaves unmatched marks as text', () => {
    expect(inlinePieces('2 ** 3')).toEqual([{ text: '2 ** 3', style: 'plain' }]);
  });
});
