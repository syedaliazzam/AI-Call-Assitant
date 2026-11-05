/**
 * File: apps/web/src/core/companies/suggestions.ts
 * Purpose: The rows of the company field's dropdown: companies from the user's own past sessions
 *          first (on this device, so they work offline), then brands from Brandfetch, each company
 *          once (ADR-0048).
 * Used by: src/features/session-setup/CompanyField.tsx
 * Depends on: src/core/storage/types.ts, ./brandfetch.ts
 * Architecture: docs/decisions/ADR-0048-company-suggestions-from-brandfetch.md
 */
import type { Session } from '../storage/types';
import type { BrandResult } from './brandfetch';

/** Typed characters needed before anything is suggested. */
export const MIN_SUGGESTION_CHARS = 2;

/** The pause after typing before looking anything up, in ms. */
export const SUGGESTION_DEBOUNCE_MS = 250;

/** Most companies shown from past sessions. */
const MAX_LOCAL = 5;

/** One row of the dropdown. */
export interface CompanySuggestion {
  /** A key for the row, unique in the list. */
  key: string;
  /** The company's name. */
  name: string;
  /** Its domain, when known. */
  domain: string | null;
  /** Its icon's address, to show now and never store; only a Brandfetch result has one. */
  iconUrl: string | null;
}

/**
 * Companies from past sessions that match the typed text. A company used more than once keeps one
 * row: the most recent, unless only an older session knows its domain.
 *
 * @param sessions The sessions, newest first.
 * @param query    The typed text.
 * @returns The rows, newest first.
 * Called from: CompanyField.tsx; tests
 */
export function localCompanies(
  sessions: readonly Pick<Session, 'company' | 'companyDomain'>[],
  query: string,
): CompanySuggestion[] {
  const text = query.trim().toLowerCase();
  if (text.length < MIN_SUGGESTION_CHARS) return [];
  const byName = new Map<string, CompanySuggestion>();
  for (const { company, companyDomain } of sessions) {
    const name = company.trim();
    const key = name.toLowerCase();
    if (!key.includes(text)) continue;
    const known = byName.get(key);
    if (!known) {
      byName.set(key, { key: `local:${key}`, name, domain: companyDomain ?? null, iconUrl: null });
    } else if (!known.domain && companyDomain) {
      known.domain = companyDomain;
    }
  }
  return [...byName.values()].slice(0, MAX_LOCAL);
}

/**
 * The dropdown's rows: past sessions first, then Brandfetch's brands that add something. A brand
 * with the same name as a past company still shows if that company has no domain yet, because
 * picking it is how that company gets a logo.
 *
 * @param local  Rows from past sessions.
 * @param brands Brands from Brandfetch.
 * @returns The rows in order.
 * Called from: CompanyField.tsx; tests
 */
export function mergeSuggestions(
  local: readonly CompanySuggestion[],
  brands: readonly BrandResult[],
): CompanySuggestion[] {
  const domains = new Set(local.flatMap((row) => (row.domain ? [row.domain.toLowerCase()] : [])));
  const namesWithDomain = new Set(
    local.flatMap((row) => (row.domain ? [row.name.toLowerCase()] : [])),
  );
  const added = new Set<string>();
  const remote = brands.flatMap((brand): CompanySuggestion[] => {
    const domain = brand.domain.toLowerCase();
    if (domains.has(domain) || namesWithDomain.has(brand.name.toLowerCase()) || added.has(domain)) {
      return [];
    }
    added.add(domain);
    return [{ key: `brand:${domain}`, ...brand }];
  });
  return [...local, ...remote];
}
