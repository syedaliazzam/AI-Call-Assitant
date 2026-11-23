/**
 * File: apps/web/app/download/windows/route.ts
 * Purpose: GET /download/windows: downloads the newest Windows installer straight away (a redirect to the
 *          .exe, no GitHub page), or opens the release page if the installer's name cannot be read. Open to
 *          signed-out visitors (proxy.ts PUBLIC_PAGE_PATHS), like the "Get the desktop app" link on the
 *          sign-in page. Thin: the work is in src/server/desktopDownload.ts. Windows only for now.
 * Used by: every "Download for Windows" link (src/features/session-setup/labels.ts DESKTOP_DOWNLOAD_URL)
 *          and the user guide
 * Depends on: src/server/desktopDownload.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10 (installation); ADR-0028
 */
import { windowsDownloadResponse } from '@/server/desktopDownload';

/** Next.js route setting: Node.js (a plain fetch to GitHub). */
export const runtime = 'nodejs';
/** Next.js route setting: never pre-rendered at build time (the newest release changes after a deploy). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /download/windows.
 *
 * @returns See windowsDownloadResponse().
 */
export function GET(): Promise<Response> {
  return windowsDownloadResponse();
}
