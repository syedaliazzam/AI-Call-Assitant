/**
 * Tests apps/web/src/server/macRelease.ts and its route, app/api/mac-release/route.ts (ADR-0125): the Mac app
 * counts as published only when the mac-latest channel's latest-mac.yml answers 200 with a version and a .zip;
 * a 404 (not published yet), an error, an unreadable file or no answer in time all mean "not published", so no
 * broken install is offered. "Not published" is read again after a minute (the download appears by itself
 * soon after the release), "published" after ten. fetch is replaced; nothing goes to GitHub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../../app/api/mac-release/route';
import {
  forgetMacRelease,
  isMacReleaseYml,
  MAC_LATEST_YML_URL,
  macReleasePublished,
  NOT_PUBLISHED_TTL_MS,
  PUBLISHED_TTL_MS,
} from '@/server/macRelease';

/** latest-mac.yml as electron-builder writes it (the 1.8.0 shape; hash shortened). */
const LATEST_MAC_YML = `version: 1.8.0
files:
  - url: Paramount-AI-1.8.0-universal-mac.zip
    sha512: abc==
    size: 312000000
path: Paramount-AI-1.8.0-universal-mac.zip
sha512: abc==
releaseDate: '2026-11-26T08:00:00.000Z'
`;

/** The fetch spy standing in for GitHub. */
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  forgetMacRelease();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The failure paths log a warning (no body); keep the test output clean.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  forgetMacRelease();
  vi.unstubAllGlobals();
});

describe('isMacReleaseYml', () => {
  it('needs a version and a .zip to install', () => {
    expect(isMacReleaseYml(LATEST_MAC_YML)).toBe(true);
    expect(
      isMacReleaseYml('version: \'1.8.0\'\npath: "Paramount-AI-1.8.0-universal-mac.zip"\n'),
    ).toBe(true);
    expect(isMacReleaseYml('version: 1.8.0\n')).toBe(false);
    expect(isMacReleaseYml('path: Paramount-AI-1.8.0-universal-mac.zip\n')).toBe(false);
    expect(isMacReleaseYml('version: 1.8.0\npath: Paramount-AI-Setup-1.8.0.exe\n')).toBe(false);
    expect(isMacReleaseYml('<html>Not Found</html>')).toBe(false);
  });
});

describe('macReleasePublished (ADR-0125)', () => {
  it('is false while mac-latest has no latest-mac.yml (404), and asks again after a minute', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    expect(await macReleasePublished(1_000)).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(MAC_LATEST_YML_URL, expect.anything());
    // Reused within the minute…
    expect(await macReleasePublished(1_000 + NOT_PUBLISHED_TTL_MS - 1)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // …and once published, it turns on by itself after it.
    fetchMock.mockResolvedValue(new Response(LATEST_MAC_YML, { status: 200 }));
    expect(await macReleasePublished(1_000 + NOT_PUBLISHED_TTL_MS)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is true for a complete release, reused for ten minutes', async () => {
    fetchMock.mockResolvedValue(new Response(LATEST_MAC_YML, { status: 200 }));
    expect(await macReleasePublished(5_000)).toBe(true);
    expect(await macReleasePublished(5_000 + PUBLISHED_TTL_MS - 1)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is false (offers no install) on an error, an unreadable file or no answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await macReleasePublished(0)).toBe(false);
    forgetMacRelease();
    fetchMock.mockResolvedValueOnce(new Response('version: 1.8.0\n', { status: 200 }));
    expect(await macReleasePublished(0)).toBe(false);
    forgetMacRelease();
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    expect(await macReleasePublished(0)).toBe(false);
  });
});

describe('GET /api/mac-release', () => {
  it('answers { published } and is never cached by browsers', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ published: false });
    forgetMacRelease();
    fetchMock.mockResolvedValue(new Response(LATEST_MAC_YML, { status: 200 }));
    expect(await (await GET()).json()).toEqual({ published: true });
  });
});
