/**
 * Tests for apps/web/src/core/transcript/unclear.ts (v1.1.0, ADR-0044): noise bubbles in a row collapse
 * into one item; words still being heard never do; an overlay bubble's own flag is used when it has one.
 * All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { collapseUnclear, isUnclearGroup } from '@/core/transcript/unclear';

/** Noise, by the rules in questionKind.ts. */
const NOISE = 'GRONK BLIMP SPROCKET WIBBLE FLANGE';

/**
 * Makes an invented bubble.
 *
 * @param id          Its id.
 * @param finalText   Its finished words.
 * @param provisional Words that may still change.
 * @returns The bubble.
 */
function bubble(id: string, finalText: string, provisional = '') {
  return { id, finalText, provisionalText: provisional };
}

describe('isUnclearGroup', () => {
  it('is true for finished noise only', () => {
    expect(isUnclearGroup(bubble('a', NOISE))).toBe(true);
    expect(isUnclearGroup(bubble('a', NOISE, 'still'))).toBe(false);
    expect(isUnclearGroup(bubble('a', 'What does the plan cost?'))).toBe(false);
  });

  it("uses the bubble's own flag when it has one", () => {
    expect(isUnclearGroup({ ...bubble('a', 'Fine words.'), unclear: true })).toBe(true);
    expect(isUnclearGroup({ ...bubble('a', NOISE), unclear: false })).toBe(false);
  });
});

describe('collapseUnclear', () => {
  it('puts unclear bubbles in a row into one item, keeping the order', () => {
    const items = collapseUnclear([
      bubble('a', 'First real line.'),
      bubble('b', NOISE),
      bubble('c', NOISE),
      bubble('d', 'Second real line.'),
      bubble('e', NOISE),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['group', 'unclear', 'group', 'unclear']);
    const run = items[1]!;
    expect(run.kind === 'unclear' && run.id).toBe('b');
    expect(run.kind === 'unclear' && run.groups.map((group) => group.id)).toEqual(['b', 'c']);
  });

  it('gives an empty list for no bubbles', () => {
    expect(collapseUnclear([])).toEqual([]);
  });
});
