/**
 * Tests apps/web/scripts/lib/spend.ts (what a request cost, and the running total) and the pure part
 * of apps/web/scripts/lib/code-sandbox.ts (finding code blocks, and which languages it runs).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codeBlocks, sandboxLanguage } from '../../../scripts/lib/code-sandbox';
import { createSpendMeter, requestCost } from '../../../scripts/lib/spend';

/** A million of each kind of token. */
const MILLION = {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_creation_input_tokens: 1_000_000,
  cache_read_input_tokens: 1_000_000,
};

describe('requestCost', () => {
  it('prices the fast model, with cache writes and reads', () => {
    expect(requestCost('claude-haiku-5-5', MILLION)).toBeCloseTo(0.1 + 0.5 + 0.125 + 0.01);
  });
  it('prices an unknown model as the dearer one, so a total never reads low', () => {
    expect(requestCost('some-new-model', MILLION)).toBeCloseTo(
      requestCost('claude-sonnet-5-5', MILLION),
    );
  });
});

describe('createSpendMeter', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('adds a run to the running total', () => {
    root = mkdtempSync(path.join(tmpdir(), 'kite-spend-'));
    const usage = { ...MILLION, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const first = createSpendMeter(root);
    first.add('claude-haiku-5-5', usage);
    expect(first.finish('one')).toBe('Spend: $0.6000 for 1 requests; ledger total $0.6000');
    const second = createSpendMeter(root);
    second.add('claude-haiku-5-5', usage);
    expect(second.finish('two')).toBe('Spend: $0.6000 for 1 requests; ledger total $1.2000');
  });
});

describe('codeBlocks', () => {
  it('finds closed blocks with their language', () => {
    expect(codeBlocks('Hi\n```Python\nprint(1)\n```\nThen\n```\nx\n```')).toEqual([
      { language: 'python', code: 'print(1)\n' },
      { language: '', code: 'x\n' },
    ]);
  });
  it('ignores a block that never closed', () => {
    expect(codeBlocks('```python\nprint(1)')).toEqual([]);
  });
});

describe('sandboxLanguage', () => {
  it('runs Python and JavaScript only', () => {
    expect(sandboxLanguage('py')).toBe('python');
    expect(sandboxLanguage('javascript')).toBe('javascript');
    expect(sandboxLanguage('sql')).toBeNull();
    expect(sandboxLanguage('')).toBeNull();
  });
});
