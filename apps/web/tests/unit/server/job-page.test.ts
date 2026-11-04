/**
 * Tests: apps/web/src/server/job-page.ts. The server fetches addresses users type, so these pin
 * the SSRF rules: only public addresses, on the usual ports, also after redirects and whatever a
 * host name resolves to; and the size limit. Also how a page becomes plain text. No network.
 */
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns', () => ({ lookup }));

import {
  checkedLookup,
  checkUrl,
  fetchJobPage,
  isPublicAddress,
  JobPageError,
  JOB_PAGE_TIMEOUT_MS,
  MAX_JOB_PAGE_BYTES,
  MAX_JOB_TEXT_CHARS,
  pageText,
} from '@/server/job-page';

/**
 * A fake response.
 *
 * @param status  Its status.
 * @param headers Its headers.
 * @param body    Its body.
 * @returns The response.
 */
function response(status: number, headers: Record<string, string>, body = ''): IncomingMessage {
  const stream = new PassThrough();
  stream.end(body);
  return Object.assign(stream, { statusCode: status, headers }) as unknown as IncomingMessage;
}

/**
 * The reason a call failed.
 *
 * @param run What to run.
 * @returns The JobPageError's reason, or null if it did not fail that way.
 */
async function reasonOf(run: () => unknown): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof JobPageError ? error.reason : null;
  }
}

afterEach(() => {
  lookup.mockReset();
});

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
    'not-an-address',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('checkUrl', () => {
  it('allows ordinary job pages', () => {
    expect(checkUrl('https://jobs.example.com/roles/42?a=1').hostname).toBe('jobs.example.com');
    // The usual port written out is the same address.
    expect(checkUrl('https://jobs.example.com:443/x').hostname).toBe('jobs.example.com');
  });

  it.each([
    'not a url',
    // https only (spec §6), even for a public site.
    'http://jobs.example.com/roles/42',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com/',
    'https://user:secret@example.com/',
    'https://example.com:8080/',
  ])('refuses %s as a bad address', async (url) => {
    expect(await reasonOf(() => checkUrl(url))).toBe('bad_url');
  });

  it.each([
    'https://127.0.0.1/',
    // Other spellings of 127.0.0.1, which the URL parser normalises.
    'https://2130706433/',
    'https://0x7f.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:169.254.169.254]/',
    // Link-local, including the cloud metadata address.
    'https://169.254.169.254/latest/meta-data/',
    'https://[fe80::1]/',
    // Private ranges.
    'https://10.0.0.5/',
    'https://172.16.0.1/',
    'https://192.168.1.1/',
    'https://[fc00::1]/',
    'https://localhost/',
    'https://intranet.local/',
  ])('refuses %s as private', async (url) => {
    expect(await reasonOf(() => checkUrl(url))).toBe('blocked');
  });
});

describe('checkedLookup', () => {
  /**
   * Runs the lookup with a fake DNS answer.
   *
   * @param addresses What DNS answers.
   * @returns What the lookup called back with.
   */
  function resolve(addresses: { address: string; family: number }[]) {
    lookup.mockImplementation((_host, _options, done) => done(null, addresses));
    return new Promise<{ error: unknown; address: unknown }>((finish) => {
      checkedLookup('jobs.example.com', { all: true }, (error, address) =>
        finish({ error, address }),
      );
    });
  }

  it('passes on public answers', async () => {
    const answer = [{ address: '8.8.8.8', family: 4 }];
    expect(await resolve(answer)).toEqual({ error: null, address: answer });
  });

  it('refuses a host that resolves to a private address', async () => {
    const { error } = await resolve([{ address: '10.0.0.5', family: 4 }]);
    expect((error as JobPageError).reason).toBe('blocked');
  });

  it('refuses when any one of several answers is private', async () => {
    const { error } = await resolve([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    expect((error as JobPageError).reason).toBe('blocked');
  });
});

describe('fetchJobPage', () => {
  it('returns the body of a page', async () => {
    const send = vi.fn(async () => response(200, { 'content-type': 'text/html' }, '<p>Hi</p>'));
    const page = await fetchJobPage('https://jobs.example.com/1', send);
    expect(page.body).toBe('<p>Hi</p>');
  });

  it('follows a redirect to another public page', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: '/moved' }))
      .mockResolvedValueOnce(response(200, { 'content-type': 'text/html' }, 'ok'));
    const page = await fetchJobPage('https://jobs.example.com/1', send);
    expect(page.url.pathname).toBe('/moved');
  });

  it('refuses a redirect to a private address, without requesting it', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: 'https://169.254.169.254/latest/' }));
    expect(await reasonOf(() => fetchJobPage('https://jobs.example.com/1', send))).toBe('blocked');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('checks every redirect: a private address after a public hop is refused too', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: 'https://cdn.example.com/2' }))
      .mockResolvedValueOnce(response(301, { location: 'https://10.0.0.5/admin' }));
    expect(await reasonOf(() => fetchJobPage('https://jobs.example.com/1', send))).toBe('blocked');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect down to http, without requesting it', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: 'http://jobs.example.com/1' }));
    expect(await reasonOf(() => fetchJobPage('https://jobs.example.com/1', send))).toBe('bad_url');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a loopback name, without requesting it', async () => {
    const send = vi.fn().mockResolvedValueOnce(response(307, { location: 'https://localhost/' }));
    expect(await reasonOf(() => fetchJobPage('https://jobs.example.com/1', send))).toBe('blocked');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reads HTML and plain text, and nothing else', async () => {
    const url = 'https://jobs.example.com/1';
    const page = (headers: Record<string, string>) =>
      vi.fn(async () => response(200, headers, 'words'));
    expect(
      (await fetchJobPage(url, page({ 'content-type': 'text/html; charset=utf-8' }))).body,
    ).toBe('words');
    expect((await fetchJobPage(url, page({ 'content-type': 'text/plain' }))).body).toBe('words');
    expect(await reasonOf(() => fetchJobPage(url, page({ 'content-type': 'image/png' })))).toBe(
      'unreadable',
    );
    expect(await reasonOf(() => fetchJobPage(url, page({})))).toBe('unreadable');
  });

  it('keeps the agreed limits: 10 seconds and 3 MB', () => {
    expect(JOB_PAGE_TIMEOUT_MS).toBe(10_000);
    expect(MAX_JOB_PAGE_BYTES).toBe(3 * 1024 * 1024);
  });

  it('stops after a few redirects', async () => {
    const send = vi.fn(async () => response(302, { location: '/again' }));
    expect(await reasonOf(() => fetchJobPage('https://jobs.example.com/1', send))).toBe(
      'unreadable',
    );
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('refuses errors, non-text pages and pages over the size limit', async () => {
    const page = (status: number, type: string, body = '') =>
      vi.fn(async () => response(status, { 'content-type': type }, body));
    const url = 'https://jobs.example.com/1';
    expect(await reasonOf(() => fetchJobPage(url, page(404, 'text/html')))).toBe('unreadable');
    expect(await reasonOf(() => fetchJobPage(url, page(200, 'application/pdf')))).toBe(
      'unreadable',
    );
    const huge = 'x'.repeat(MAX_JOB_PAGE_BYTES + 1);
    expect(await reasonOf(() => fetchJobPage(url, page(200, 'text/html', huge)))).toBe(
      'unreadable',
    );
  });

  it('passes on a refusal from the lookup', async () => {
    const send = vi.fn(async () => {
      throw new JobPageError('blocked');
    });
    expect(await reasonOf(() => fetchJobPage('https://rebind.example.com/', send))).toBe('blocked');
  });
});

describe('pageText', () => {
  it('keeps the words and drops scripts, styles and tags', () => {
    const text = pageText(
      '<html><head><title>Data Analyst</title><style>p{}</style></head><body><script>steal()</script><p>Join us &amp; grow</p><ul><li>SQL</li><li>Python</li></ul></body></html>',
    );
    expect(text).toContain('Data Analyst');
    expect(text).toContain('Join us & grow');
    expect(text).toContain('SQL\nPython');
    expect(text).not.toContain('steal');
    expect(text).not.toContain('p{}');
  });

  it('keeps a JobPosting data block, which many sites show only through scripts', () => {
    const text = pageText(
      '<script type="application/ld+json">{"@type":"JobPosting","title":"Analyst"}</script><script type="application/ld+json">{"@type":"Organization"}</script>',
    );
    expect(text).toContain('"title":"Analyst"');
    expect(text).not.toContain('Organization');
  });

  it('decodes numeric entities and limits the length', () => {
    expect(pageText('<p>&#65;&#x42;</p>')).toBe('AB');
    expect(pageText(`<p>${'a'.repeat(MAX_JOB_TEXT_CHARS + 50)}</p>`)).toHaveLength(
      MAX_JOB_TEXT_CHARS,
    );
  });
});
