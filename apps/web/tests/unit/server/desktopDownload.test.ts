/**
 * Tests apps/web/src/server/desktopDownload.ts and its route, app/download/windows/route.ts: the installer
 * name is read from latest.yml's `path:` line, a click is redirected to that .exe in the newest release,
 * the name is reused for one minute, and when GitHub cannot be reached or latest.yml cannot be read
 * the redirect goes to the release page instead. fetch is replaced; nothing goes to GitHub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../../app/download/windows/route';
import {
  forgetInstallerName,
  INSTALLER_NAME_TTL_MS,
  installerFileName,
  LATEST_YML_URL,
  RELEASES_PAGE_URL,
  windowsDownloadResponse,
} from '@/server/desktopDownload';

/** latest.yml as electron-builder writes it (the real 1.7.3 file's shape; hash shortened). */
const LATEST_YML = `version: 1.7.3
files:
  - url: Paramount-AI-Setup-1.7.3.exe
    sha512: abc==
    size: 288992910
path: Paramount-AI-Setup-1.7.3.exe
sha512: abc==
releaseDate: '2026-11-19T08:35:00.443Z'
`;

/** Where a 1.7.3 download should go. */
const INSTALLER_URL =
  'https://github.com/Zainpak123/kite-releases/releases/latest/download/Paramount-AI-Setup-1.7.3.exe';

/** The fetch spy standing in for GitHub. */
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  forgetInstallerName();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The failure paths log a warning (no body); keep the test output clean.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  forgetInstallerName();
});

describe('installerFileName', () => {
  it('reads the top-level path: line', () => {
    expect(installerFileName(LATEST_YML)).toBe('Paramount-AI-Setup-1.7.3.exe');
  });

  it('accepts a quoted name and Windows line ends', () => {
    expect(installerFileName("version: 1.7.4\r\npath: 'Paramount-AI-Setup-1.7.4.exe'\r\n")).toBe(
      'Paramount-AI-Setup-1.7.4.exe',
    );
    expect(installerFileName('path: "Paramount-AI-Setup-1.7.4.exe"')).toBe(
      'Paramount-AI-Setup-1.7.4.exe',
    );
  });

  it('ignores the indented file list and a file without path:', () => {
    expect(
      installerFileName('files:\n  - url: Paramount-AI-Setup-1.7.3.exe\n    path: x.exe\n'),
    ).toBeNull();
    expect(installerFileName('')).toBeNull();
  });

  it('refuses anything that is not a plain .exe name', () => {
    for (const bad of [
      'path: ../../evil.exe',
      'path: https://example.com/a.exe',
      'path: Paramount-AI-Setup-1.7.3.zip',
      'path: a b.exe',
      'path: ',
      'path: Paramount AI.exe?x=1',
    ]) {
      expect(installerFileName(bad), bad).toBeNull();
    }
  });
});

describe('GET /download/windows', () => {
  it('redirects to the installer named in latest.yml', async () => {
    fetchMock.mockResolvedValue(new Response(LATEST_YML, { status: 200 }));
    const response = await GET();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(INSTALLER_URL);
    // No browser or CDN keeps the redirect: only the module's few-minute cache does.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(LATEST_YML_URL);
  });

  it('reuses the name for one minute, then reads latest.yml again', async () => {
    expect(INSTALLER_NAME_TTL_MS).toBe(60_000);
    fetchMock.mockResolvedValue(new Response(LATEST_YML, { status: 200 }));
    const start = 1_000_000;
    await windowsDownloadResponse(start);
    const again = await windowsDownloadResponse(start + INSTALLER_NAME_TTL_MS - 1);
    expect(again.headers.get('location')).toBe(INSTALLER_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(
      new Response(LATEST_YML.replaceAll('1.7.3', '1.7.4'), { status: 200 }),
    );
    const later = await windowsDownloadResponse(start + INSTALLER_NAME_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(later.headers.get('location')).toBe(INSTALLER_URL.replace('1.7.3', '1.7.4'));
  });

  it('falls back to the release page when GitHub cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const response = await GET();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(RELEASES_PAGE_URL);
    expect(RELEASES_PAGE_URL).toBe('https://github.com/Zainpak123/kite-releases/releases/latest');
  });

  it('falls back to the release page when latest.yml is missing', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    const response = await GET();
    expect(response.headers.get('location')).toBe(RELEASES_PAGE_URL);
  });

  it('falls back to the release page when latest.yml has no readable name', async () => {
    fetchMock.mockResolvedValue(new Response('version: 1.7.3\n', { status: 200 }));
    const response = await GET();
    expect(response.headers.get('location')).toBe(RELEASES_PAGE_URL);
  });

  it('does not remember a failure: the next click asks GitHub again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchMock.mockResolvedValueOnce(new Response(LATEST_YML, { status: 200 }));
    expect((await GET()).headers.get('location')).toBe(RELEASES_PAGE_URL);
    expect((await GET()).headers.get('location')).toBe(INSTALLER_URL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
