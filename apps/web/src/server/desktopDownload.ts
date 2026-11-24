/**
 * File: apps/web/src/server/desktopDownload.ts
 * Purpose: The direct Windows download (/download/windows). The installer's name carries its version
 *          (Paramount-AI-Setup-<version>.exe, which the updater relies on), so GitHub's
 *          releases/latest/download/<name> cannot be linked to directly. This reads the newest release's
 *          latest.yml (the updater's own file, always the same name), takes the installer's name from its
 *          `path:` line and redirects to that file, so a click downloads the .exe without showing a GitHub
 *          page. If GitHub cannot be reached or the file cannot be read, it redirects to the releases page
 *          instead, as before.
 * Used by: app/download/windows/route.ts
 * Depends on: nothing (fetch only; the releases repository is public, so no token)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.3 (installation); ADR-0114; ADR-0028 (releases repository)
 */
import 'server-only';

/** The public releases-only repository's newest release (ADR-0028). */
const LATEST_RELEASE = 'https://github.com/Zainpak123/kite-releases/releases/latest';

/** Where every file of the newest release is served from, by its name. */
const LATEST_DOWNLOAD = `${LATEST_RELEASE}/download`;

/** The updater's file for Windows in the newest release; its `path:` names the installer. */
export const LATEST_YML_URL = `${LATEST_DOWNLOAD}/latest.yml`;

/** Where the download goes when the installer's name is not known: the release page (the old link). */
export const RELEASES_PAGE_URL = LATEST_RELEASE;

/**
 * How long one installer name is reused before latest.yml is read again, ms (ADR-0114). One read serves
 * every click meanwhile. Right after a release the old name is used for at most this long, and
 * releases/latest/download/<old name> answers 404 then (the newest release has only the new file), so
 * this is kept short: one minute.
 */
export const INSTALLER_NAME_TTL_MS = 60_000;

/** How long to wait for GitHub before sending the release page instead, ms. */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * What an installer name may look like. Anything else in latest.yml is treated as unreadable, so the
 * redirect can only ever point at an .exe in the releases repository.
 */
const INSTALLER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/;

/** The installer name last read, and until when it is reused (Date.now() time); null before the first read. */
let cached: { name: string; until: number } | null = null;

/**
 * Takes the installer's file name from latest.yml's top-level `path:` line (electron-builder writes it
 * as `path: Paramount-AI-Setup-1.7.3.exe`, sometimes quoted).
 *
 * @param yml The text of latest.yml.
 * @returns The file name, or null when there is no `path:` line or it is not a plain .exe name.
 * Called from: windowsDownloadResponse(); tests
 */
export function installerFileName(yml: string): string | null {
  // Top level only (no indent): the indented `- url:` lines under `files:` are not it.
  const match = /^path:[ \t]*(.*?)[ \t]*$/m.exec(yml);
  if (!match) return null;
  const name = match[1]!.replace(/^(['"])(.*)\1$/, '$2');
  return INSTALLER_NAME.test(name) ? name : null;
}

/**
 * Reads latest.yml from GitHub.
 *
 * @returns The installer's name, or null when GitHub did not answer in time, answered with an error,
 *          or sent a file without a readable `path:`.
 * Called from: windowsDownloadResponse()
 */
async function fetchInstallerName(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_YML_URL, {
      // GitHub answers with a redirect to the release's own copy; follow it.
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn('download: latest.yml answered', response.status);
      return null;
    }
    const name = installerFileName(await response.text());
    if (!name) console.warn('download: latest.yml has no readable installer name');
    return name;
  } catch (error) {
    // Offline, DNS, timeout: the name only, never a body.
    console.warn('download: latest.yml unreachable', error instanceof Error ? error.name : 'error');
    return null;
  }
}

/**
 * A 302 redirect that no browser or CDN keeps: the only cache is the installer name in this module,
 * so how long an old name can be used is bounded by INSTALLER_NAME_TTL_MS alone.
 *
 * @param location Where to send the browser.
 * @returns The response.
 * Called from: windowsDownloadResponse()
 */
function redirectTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store' },
  });
}

/**
 * Answers GET /download/windows: a redirect to the newest Windows installer itself, or to the release
 * page when its name cannot be found. A name read in the last INSTALLER_NAME_TTL_MS is reused; a failed
 * read is not remembered, so the next click tries GitHub again.
 *
 * @param now The current time (Date.now()); tests pass their own.
 * @returns A 302 response to the installer or to the release page. Never throws.
 * Called from: GET in app/download/windows/route.ts
 */
export async function windowsDownloadResponse(now: number = Date.now()): Promise<Response> {
  if (cached && now < cached.until) return redirectTo(installerUrl(cached.name));
  const name = await fetchInstallerName();
  if (!name) return redirectTo(RELEASES_PAGE_URL);
  cached = { name, until: now + INSTALLER_NAME_TTL_MS };
  return redirectTo(installerUrl(name));
}

/**
 * The address of one file of the newest release.
 *
 * @param name The installer's file name (already checked against INSTALLER_NAME).
 * @returns The download address.
 * Called from: windowsDownloadResponse()
 */
function installerUrl(name: string): string {
  return `${LATEST_DOWNLOAD}/${encodeURIComponent(name)}`;
}

/**
 * Forgets the installer name read last, so the next request reads latest.yml again.
 * Called from: tests only (each test starts with nothing remembered)
 */
export function forgetInstallerName(): void {
  cached = null;
}
