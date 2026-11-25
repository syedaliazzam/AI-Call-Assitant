/**
 * File: apps/web/src/server/macRelease.ts
 * Purpose: ADR-0125: whether the Mac app is published, so the site offers the Mac download only when there is
 *          one. It reads the Mac update channel's latest-mac.yml in the public releases repository (the file
 *          publish-mac.mjs uploads last, after the zip, so its presence means a complete release): published
 *          when it answers 200 with a version and a .zip. Until then every "Get it for Mac" place shows "Mac
 *          version coming soon" instead of the install command (and install-mac.sh says the same). It turns
 *          on by itself once the mac-latest release is published: no deploy or setting.
 * Used by: app/api/mac-release/route.ts
 * Depends on: nothing (fetch only; the releases repository is public, so no token)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.3 (installation); ADR-0125, ADR-0109
 */
import 'server-only';

/** The Mac update channel's file (electron-builder.yml publishes the Mac app to mac-latest; ADR-0109). */
export const MAC_LATEST_YML_URL =
  'https://github.com/Zainpak123/kite-releases/releases/download/mac-latest/latest-mac.yml';

/**
 * How long a "published" answer is reused, ms. Once out, a release stays out (rollback deletes only
 * latest-mac.yml, and then the installer refuses anyway), so ten minutes is plenty.
 */
export const PUBLISHED_TTL_MS = 10 * 60_000;

/**
 * How long a "not published" answer is reused, ms: short, so the Mac download appears within a minute of
 * the release being published.
 */
export const NOT_PUBLISHED_TTL_MS = 60_000;

/** How long to wait for GitHub before saying "not published" (safe: no broken install is offered), ms. */
const FETCH_TIMEOUT_MS = 5_000;

/** The last answer and until when it is reused (Date.now() time); null before the first read. */
let cached: { published: boolean; until: number } | null = null;

/**
 * Whether a latest-mac.yml describes a release the installer can install: a version and a .zip to
 * download (install-mac.sh reads the same top-level `version:` and `path:` lines).
 *
 * @param yml The file's text.
 * @returns True when it names a version and a .zip.
 * Called from: macReleasePublished(); tests
 */
export function isMacReleaseYml(yml: string): boolean {
  const field = (name: string) =>
    new RegExp(`^${name}:[ \\t]*['"]?([^'"\\r\\n]+?)['"]?[ \\t]*$`, 'm').exec(yml)?.[1] ?? '';
  return /^\d+\.\d+\.\d+/.test(field('version')) && /\.zip$/i.test(field('path'));
}

/**
 * Reads the channel now.
 *
 * @returns True when a complete Mac release is published; false when GitHub says there is none (404), answers
 *          with an error, sends a file that names no zip, or cannot be reached in time.
 * Called from: macReleasePublished()
 */
async function readChannel(): Promise<boolean> {
  try {
    const response = await fetch(MAC_LATEST_YML_URL, {
      // GitHub answers with a redirect to the file's own copy; follow it.
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // 404 is the normal "not published yet": nothing to log.
    if (response.status === 404) return false;
    if (!response.ok) {
      console.warn('mac release: latest-mac.yml answered', response.status);
      return false;
    }
    return isMacReleaseYml(await response.text());
  } catch (error) {
    // Offline, DNS, timeout: the name only, never a body.
    console.warn(
      'mac release: latest-mac.yml unreachable',
      error instanceof Error ? error.name : 'error',
    );
    return false;
  }
}

/**
 * ADR-0125: whether the Mac app is published (the Mac download may be offered). Never throws.
 *
 * @param now The current time (Date.now()); tests pass their own.
 * @returns True when the mac-latest release has a complete latest-mac.yml.
 * Called from: GET in app/api/mac-release/route.ts
 */
export async function macReleasePublished(now: number = Date.now()): Promise<boolean> {
  if (cached && now < cached.until) return cached.published;
  const published = await readChannel();
  cached = { published, until: now + (published ? PUBLISHED_TTL_MS : NOT_PUBLISHED_TTL_MS) };
  return published;
}

/**
 * Forgets the last answer, so the next call reads the channel again.
 * Called from: tests only
 */
export function forgetMacRelease(): void {
  cached = null;
}
