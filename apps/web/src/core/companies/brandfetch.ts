/**
 * File: apps/web/src/core/companies/brandfetch.ts
 * Purpose: Talks to Brandfetch from the browser (ADR-0048): searches brand names for the company
 *          field, and builds the address of a company's logo. Brandfetch's rules shape this file:
 *          search runs live from the user's browser; icon addresses are shown as they come and never
 *          stored, because they expire after 24 hours; logos are embedded, never fetched by code.
 * Used by: src/core/companies/suggestions.ts, src/features/session-setup/CompanyField.tsx,
 *          src/features/dashboard/CompanyTile.tsx
 * Depends on: fetch (the browser's)
 * Architecture: docs/decisions/ADR-0048-company-suggestions-from-brandfetch.md
 *
 * The typed company is sent to Brandfetch and to nobody else, and is never logged.
 */

/** Brandfetch's Brand Search API. */
const BRAND_SEARCH_URL = 'https://api.brandfetch.io/v2/search';

/** Brandfetch's Logo API, by domain. */
const LOGO_URL = 'https://cdn.brandfetch.io/domain';

/** Most results shown: Brandfetch allows at most 5 per search. */
const MAX_RESULTS = 5;

/**
 * A logo's size in pixels: the tile is 24 px, doubled for sharp screens.
 */
const LOGO_SIZE = 48;

/** A host name such as "example.co.uk". Anything else is never put into a logo address. */
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** One brand from a search. Only what is shown; other fields, such as badges, are dropped. */
export interface BrandResult {
  /** The brand's name. */
  name: string;
  /** Its domain. */
  domain: string;
  /** Its icon's address, to show now and never store; null when it has none. */
  iconUrl: string | null;
}

/** What a search found. */
export type BrandSearchOutcome =
  | {
      /** The search ran. */
      status: 'ok';
      /** The brands, possibly none. */
      brands: BrandResult[];
    }
  | {
      /** The search could not be answered, which is not the same as finding nothing. */
      status: 'failed';
    };

/**
 * The client ID this build was given. Next.js writes the value into the page when it builds.
 *
 * @returns The ID, or '' when there is none, which turns off everything from Brandfetch.
 * Called from: searchBrands(), brandLogoUrl(), CompanyField.tsx; tests
 */
export function brandfetchClientId(): string {
  try {
    return process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID?.trim() ?? '';
  } catch {
    // A page built without Next.js, such as a test page, has no `process` at all.
    return '';
  }
}

/**
 * Whether text is a plain host name, so that a domain from an imported file cannot change what a
 * logo address points at.
 *
 * @param domain The text.
 * @returns True for a host name.
 * Called from: brandLogoUrl(), searchBrands(); tests
 */
export function isCompanyDomain(domain: string): boolean {
  return DOMAIN.test(domain);
}

/**
 * The address of a company's logo. It asks for a 404 when there is no logo, rather than Brandfetch's
 * placeholder, so that the card can show its letter tile instead.
 *
 * @param domain   The company's domain.
 * @param clientId The client ID.
 * @returns The address, or null with no client ID or a domain that is not a host name.
 * Called from: CompanyTile.tsx; tests
 */
export function brandLogoUrl(domain: string, clientId = brandfetchClientId()): string | null {
  if (!clientId || !isCompanyDomain(domain)) return null;
  const size = `w/${LOGO_SIZE}/h/${LOGO_SIZE}`;
  return `${LOGO_URL}/${domain}/${size}/fallback/404/type/icon?c=${encodeURIComponent(clientId)}`;
}

/**
 * Reads one brand from a search reply.
 *
 * @param item One entry of the reply.
 * @returns The brand, or null when it has no usable name and domain.
 * Called from: searchBrands()
 */
function brandFrom(item: unknown): BrandResult | null {
  if (typeof item !== 'object' || item === null) return null;
  const { name, domain, icon } = item as Record<string, unknown>;
  if (typeof domain !== 'string' || !isCompanyDomain(domain)) return null;
  const shownName = typeof name === 'string' && name.trim() ? name.trim() : domain;
  const iconUrl = typeof icon === 'string' && icon.startsWith('https://') ? icon : null;
  return { name: shownName, domain, iconUrl };
}

/**
 * Searches brand names. Sends only the typed text and the client ID: no cookies, and no other detail
 * of the session.
 *
 * @param query    The typed company.
 * @param signal   Cancels the search when the text changes.
 * @param clientId The client ID.
 * @returns The brands, or 'failed' for any reply other than a list of brands. Never throws.
 * Called from: CompanyField.tsx; tests
 */
export async function searchBrands(
  query: string,
  signal?: AbortSignal,
  clientId = brandfetchClientId(),
): Promise<BrandSearchOutcome> {
  const text = query.trim();
  if (!clientId || text === '') return { status: 'failed' };
  const address = `${BRAND_SEARCH_URL}/${encodeURIComponent(text)}?c=${encodeURIComponent(clientId)}`;
  try {
    const response = await fetch(address, { credentials: 'omit', ...(signal ? { signal } : {}) });
    if (response.status !== 200) return { status: 'failed' };
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return { status: 'failed' };
    const brands = body.flatMap((item) => brandFrom(item) ?? []);
    return { status: 'ok', brands: brands.slice(0, MAX_RESULTS) };
  } catch {
    // Offline, cancelled or an unreadable reply. Nothing is logged: the address holds the typed text.
    return { status: 'failed' };
  }
}
