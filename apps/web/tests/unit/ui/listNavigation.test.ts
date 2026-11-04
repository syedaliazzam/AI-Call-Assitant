/**
 * Tests for apps/web/src/ui/listNavigation.ts and the summary in src/ui/MultiSelect.tsx: what a search
 * shows, where the arrow keys and type-ahead land (skipping disabled options and wrapping round), and
 * what a closed multi-select says.
 */
import { describe, expect, it } from 'vitest';
import { filterOptions, nextEnabled, typeAhead } from '@/ui/listNavigation';
import { multiSelectSummary } from '@/ui/MultiSelect';

/** A short list, with one option that cannot be chosen. */
const OPTIONS = [
  { label: 'Danish' },
  { label: 'Dutch', disabled: true },
  { label: 'English' },
  { label: 'Spanish' },
];

describe('filterOptions', () => {
  it('matches anywhere in the label, ignoring case and outer spaces', () => {
    expect(filterOptions(OPTIONS, '  ISH ').map((option) => option.label)).toEqual([
      'Danish',
      'English',
      'Spanish',
    ]);
  });

  it('shows everything for an empty search and nothing for no match', () => {
    expect(filterOptions(OPTIONS, '   ')).toHaveLength(4);
    expect(filterOptions(OPTIONS, 'klingon')).toEqual([]);
  });
});

describe('nextEnabled', () => {
  it('skips a disabled option', () => {
    expect(nextEnabled(OPTIONS, 0, 1)).toBe(2);
    expect(nextEnabled(OPTIONS, 2, -1)).toBe(0);
  });

  it('wraps round the ends', () => {
    expect(nextEnabled(OPTIONS, 3, 1)).toBe(0);
    expect(nextEnabled(OPTIONS, 0, -1)).toBe(3);
  });

  it('starts at the first option going down and the last going up', () => {
    expect(nextEnabled(OPTIONS, -1, 1)).toBe(0);
    expect(nextEnabled(OPTIONS, -1, -1)).toBe(3);
  });

  it('gives -1 when nothing can be chosen', () => {
    expect(nextEnabled([], 0, 1)).toBe(-1);
    expect(nextEnabled([{ label: 'Only', disabled: true }], 0, 1)).toBe(-1);
  });
});

describe('typeAhead', () => {
  it('finds the next option starting with the letters, looking on from the current one', () => {
    expect(typeAhead(OPTIONS, -1, 'e')).toBe(2);
    expect(typeAhead(OPTIONS, 2, 's')).toBe(3);
    expect(typeAhead(OPTIONS, 3, 'd')).toBe(0);
  });

  it('skips a disabled option and gives -1 for no match', () => {
    expect(typeAhead(OPTIONS, 0, 'du')).toBe(-1);
    expect(typeAhead(OPTIONS, 0, 'x')).toBe(-1);
  });
});

describe('multiSelectSummary', () => {
  const docs = [
    { value: 'a', label: 'Pricing sheet' },
    { value: 'b', label: 'Runbook' },
  ];

  it('says what is missing when there is nothing to select', () => {
    expect(multiSelectSummary([], [], 'None selected', 'No documents yet')).toEqual({
      text: 'No documents yet',
      muted: true,
    });
  });

  it('names one item and counts several', () => {
    expect(multiSelectSummary(docs, [], 'None selected', 'No documents yet')).toEqual({
      text: 'None selected',
      muted: true,
    });
    expect(multiSelectSummary(docs, ['b'], 'None selected', 'No documents yet').text).toBe(
      'Runbook',
    );
    expect(multiSelectSummary(docs, ['a', 'b'], 'None selected', 'No documents yet').text).toBe(
      '2 selected',
    );
  });

  it('ignores a selected value that is no longer in the list', () => {
    expect(multiSelectSummary(docs, ['gone'], 'None selected', 'No documents yet').text).toBe(
      'None selected',
    );
  });
});
