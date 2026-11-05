/**
 * Tests apps/web/src/core/companies/suggestions.ts (ADR-0048): past sessions match on any part of the
 * name, each company once, keeping a known domain; Brandfetch's brands come after them, without
 * repeating a company unless picking it would give that company a logo. All names are invented.
 */
import { describe, expect, it } from 'vitest';
import type { BrandResult } from '@/core/companies/brandfetch';
import { localCompanies, mergeSuggestions } from '@/core/companies/suggestions';

/**
 * An invented brand.
 *
 * @param name   Its name.
 * @param domain Its domain.
 * @returns The brand.
 */
const brand = (name: string, domain: string): BrandResult => ({
  name,
  domain,
  iconUrl: `https://cdn.example/${domain}`,
});

describe('localCompanies', () => {
  it('needs two characters', () => {
    expect(localCompanies([{ company: 'Alder Foods' }], 'a')).toEqual([]);
    expect(localCompanies([{ company: 'Alder Foods' }], ' a ')).toEqual([]);
    expect(localCompanies([{ company: 'Alder Foods' }], 'al')).toHaveLength(1);
  });

  it('matches any part of the name, ignoring case', () => {
    const sessions = [{ company: 'Alder Foods' }, { company: 'Lantern' }];
    expect(localCompanies(sessions, 'FOOD').map((row) => row.name)).toEqual(['Alder Foods']);
  });

  it('shows a company once, as last written, with a domain from any of its sessions', () => {
    const rows = localCompanies(
      [
        { company: 'Alder Foods' },
        { company: 'ALDER FOODS', companyDomain: 'alder.example' },
        { company: 'Alder Foods ' },
      ],
      'alder',
    );
    expect(rows).toEqual([
      {
        key: 'local:alder foods',
        name: 'Alder Foods',
        domain: 'alder.example',
        iconUrl: null,
      },
    ]);
  });

  it('skips sessions with no company, and shows at most five', () => {
    const sessions = [
      { company: '' },
      ...Array.from({ length: 7 }, (_, i) => ({ company: `Alder ${i}` })),
    ];
    expect(localCompanies(sessions, 'alder')).toHaveLength(5);
  });
});

describe('mergeSuggestions', () => {
  it('puts past sessions first', () => {
    const local = localCompanies([{ company: 'Alder Partners' }], 'alder');
    const rows = mergeSuggestions(local, [brand('Alder Foods', 'alder.example')]);
    expect(rows.map((row) => row.name)).toEqual(['Alder Partners', 'Alder Foods']);
  });

  it('drops a brand whose domain or name a past company already has', () => {
    const local = localCompanies([{ company: 'Alder', companyDomain: 'alder.example' }], 'alder');
    const rows = mergeSuggestions(local, [
      brand('Alder Group', 'ALDER.example'),
      brand('alder', 'other.example'),
    ]);
    expect(rows.map((row) => row.name)).toEqual(['Alder']);
  });

  it('keeps a same-named brand when the past company has no domain, so it can get a logo', () => {
    const local = localCompanies([{ company: 'Alder' }], 'alder');
    const rows = mergeSuggestions(local, [brand('Alder', 'alder.example')]);
    expect(rows.map((row) => row.domain)).toEqual([null, 'alder.example']);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it('shows a domain once when Brandfetch repeats it', () => {
    const rows = mergeSuggestions([], [brand('A', 'a.example'), brand('A two', 'a.example')]);
    expect(rows.map((row) => row.name)).toEqual(['A']);
  });
});
