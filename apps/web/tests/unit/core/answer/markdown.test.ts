/**
 * Tests apps/web/src/core/answer/markdown.ts: splitting a private answer into paragraphs, lists,
 * headings and code blocks while it streams, inline bold and code marks, and the user guide's links.
 */
import { describe, expect, it } from 'vitest';
import { inlinePieces, linkPieces, markdownBlocks } from '@/core/answer/markdown';

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

describe('linkPieces', () => {
  it('splits a line at its link', () => {
    expect(linkPieces('Get it from [the page](https://example.com/a?b=1) today.')).toEqual([
      { text: 'Get it from ', href: null },
      { text: 'the page', href: 'https://example.com/a?b=1' },
      { text: ' today.', href: null },
    ]);
  });

  it('finds every link, including at the start and the end', () => {
    expect(linkPieces('[a](https://a.example) and [b](http://b.example)')).toEqual([
      { text: 'a', href: 'https://a.example' },
      { text: ' and ', href: null },
      { text: 'b', href: 'http://b.example' },
    ]);
  });

  it.each(['javascript:alert(1)', 'install-windows.md', '/help', 'file:///c:/secret'])(
    'keeps only the words of a link to %s',
    (address) => {
      expect(linkPieces(`[words](${address})`)).toEqual([{ text: 'words', href: null }]);
    },
  );

  it('keeps brackets that belong to the address', () => {
    expect(linkPieces('[a](https://example.com/a_(b)) next')).toEqual([
      { text: 'a', href: 'https://example.com/a_(b)' },
      { text: ' next', href: null },
    ]);
  });

  it('leaves a line without a link alone', () => {
    expect(linkPieces('Plain [words] and (more).')).toEqual([
      { text: 'Plain [words] and (more).', href: null },
    ]);
  });

  it('does not change how answers are split: a link in an answer stays plain text', () => {
    expect(inlinePieces('See [this](https://example.com).')).toEqual([
      { text: 'See [this](https://example.com).', style: 'plain' },
    ]);
  });
});
