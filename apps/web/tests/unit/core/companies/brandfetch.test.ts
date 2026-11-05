/**
 * Tests apps/web/src/core/companies/brandfetch.ts (ADR-0048): a search sends only the typed text and
 * the client ID, reads only the name, domain and icon, and treats anything but a list of brands as a
 * failure; a logo address needs a client ID and a real host name; nothing is ever logged. Brandfetch
 * is never called: fetch is replaced. All names are invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  brandfetchClientId,
  brandLogoUrl,
  isCompanyDomain,
  searchBrands,
} from '@/core/companies/brandfetch';

/** A made-up client ID. */
const ID = 'invented-client-id';

/**
 * Replaces fetch with one that answers.
 *
 * @param status The reply's status.
 * @param body   The reply's body.
 * @returns The fake.
 */
function fakeFetch(status: number, body: unknown) {
  const fake = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fake);
  return fake;
}

beforeEach(() => {
  vi.spyOn(console, 'log');
  vi.spyOn(console, 'warn');
  vi.spyOn(console, 'error');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('searchBrands', () => {
  it('sends only the typed text and the client ID, with no cookies', async () => {
    const fake = fakeFetch(200, []);
    await searchBrands('  Alder Foods ', undefined, ID);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake).toHaveBeenCalledWith(
      'https://api.brandfetch.io/v2/search/Alder%20Foods?c=invented-client-id',
      { credentials: 'omit' },
    );
  });

  it('cannot change the address with what is typed', async () => {
    const fake = fakeFetch(200, []);
    await searchBrands('a/../b?x=1#y', undefined, ID);
    expect(fake.mock.calls[0]).toEqual([
      'https://api.brandfetch.io/v2/search/a%2F..%2Fb%3Fx%3D1%23y?c=invented-client-id',
      { credentials: 'omit' },
    ]);
  });

  it('keeps only the name, domain and icon: no badge or other field gets through', async () => {
    fakeFetch(200, [
      {
        name: 'Alder Foods',
        domain: 'alder.example',
        icon: 'https://cdn.brandfetch.io/icon-a',
        brandId: 'b1',
        claimed: true,
        verified: true,
        qualityScore: 0.9,
      },
    ]);
    expect(await searchBrands('alder', undefined, ID)).toEqual({
      status: 'ok',
      brands: [
        {
          name: 'Alder Foods',
          domain: 'alder.example',
          iconUrl: 'https://cdn.brandfetch.io/icon-a',
        },
      ],
    });
  });

  it('drops an entry without a real domain, and an icon that is not https', async () => {
    fakeFetch(200, [
      { name: 'No domain' },
      { name: 'Bad domain', domain: 'evil.example/path' },
      { name: 'Plain icon', domain: 'plain.example', icon: 'http://cdn.example/a' },
      { name: 'Script', domain: 'script.example', icon: 'javascript:alert(1)' },
      { domain: 'noname.example' },
    ]);
    expect(await searchBrands('x y', undefined, ID)).toEqual({
      status: 'ok',
      brands: [
        { name: 'Plain icon', domain: 'plain.example', iconUrl: null },
        { name: 'Script', domain: 'script.example', iconUrl: null },
        { name: 'noname.example', domain: 'noname.example', iconUrl: null },
      ],
    });
  });

  it('shows at most five', async () => {
    fakeFetch(
      200,
      Array.from({ length: 8 }, (_, i) => ({ name: `N${i}`, domain: `n${i}.example` })),
    );
    const outcome = await searchBrands('nn', undefined, ID);
    expect(outcome.status === 'ok' && outcome.brands).toHaveLength(5);
  });

  it('says found nothing when the list is empty', async () => {
    fakeFetch(200, []);
    expect(await searchBrands('zz', undefined, ID)).toEqual({ status: 'ok', brands: [] });
  });

  it.each([
    [503, { error: 'temporarily_unavailable' }],
    [429, { error: 'rate_limited' }],
    [403, { error: 'client_id_required' }],
    [410, { error: 'client_id_expired' }],
    [200, { not: 'a list' }],
  ])('treats a %i reply as a failure, not as no results', async (status, body) => {
    fakeFetch(status, body);
    expect(await searchBrands('alder', undefined, ID)).toEqual({ status: 'failed' });
  });

  it('fails quietly offline, and logs nothing that holds the typed text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await searchBrands('Secret Employer', undefined, ID)).toEqual({ status: 'failed' });
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('sends nothing without a client ID, or without text', async () => {
    const fake = fakeFetch(200, []);
    expect(await searchBrands('alder', undefined, '')).toEqual({ status: 'failed' });
    expect(await searchBrands('   ', undefined, ID)).toEqual({ status: 'failed' });
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('brandfetchClientId', () => {
  it('comes from the environment, and is empty when it is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_BRANDFETCH_CLIENT_ID', ' from-env ');
    expect(brandfetchClientId()).toBe('from-env');
    vi.stubEnv('NEXT_PUBLIC_BRANDFETCH_CLIENT_ID', '');
    expect(brandfetchClientId()).toBe('');
  });
});

describe('brandLogoUrl', () => {
  it('asks for a small icon, and a 404 rather than a placeholder', () => {
    expect(brandLogoUrl('alder.example', ID)).toBe(
      'https://cdn.brandfetch.io/domain/alder.example/w/48/h/48/fallback/404/type/icon?c=invented-client-id',
    );
  });

  it('gives nothing without a client ID', () => {
    expect(brandLogoUrl('alder.example', '')).toBeNull();
  });

  it.each(['evil.example/../x', 'a b.example', 'https://alder.example', 'localhost', ''])(
    'gives nothing for %j, such as a damaged imported file',
    (domain) => {
      expect(brandLogoUrl(domain, ID)).toBeNull();
    },
  );
});

describe('isCompanyDomain', () => {
  it.each(['alder.example', 'a.co', 'sub.alder.co.uk', 'x-y.example'])('accepts %s', (domain) => {
    expect(isCompanyDomain(domain)).toBe(true);
  });

  it.each(['alder', '.example', 'a..b.example', '-a.example', 'a.example?c=1', 'a.example#b'])(
    'refuses %s',
    (domain) => {
      expect(isCompanyDomain(domain)).toBe(false);
    },
  );
});
