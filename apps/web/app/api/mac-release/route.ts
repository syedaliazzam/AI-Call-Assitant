/**
 * File: apps/web/app/api/mac-release/route.ts
 * Purpose: ADR-0125: GET /api/mac-release answers { published: boolean }: whether the Mac app is published, so
 *          the "Get it for Mac" dialogs offer the install command only when there is a release to install
 *          (otherwise "Mac version coming soon"). Open to signed-out visitors (proxy.ts PUBLIC_PAGE_PATHS):
 *          the sign-in page has the desktop app link too. Thin: the work is in src/server/macRelease.ts.
 * Used by: src/core/download/macRelease.ts (the browser side)
 * Depends on: src/server/macRelease.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.3 (installation); ADR-0125
 */
import { macReleasePublished } from '@/server/macRelease';

/** Next.js route setting: Node.js (a plain fetch to GitHub). */
export const runtime = 'nodejs';
/** Next.js route setting: never pre-rendered at build time (the release appears after a deploy). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/mac-release.
 *
 * @returns 200 { published } (never an error: "not published" when GitHub cannot be read). Not cached by
 *          browsers or the CDN: the server keeps the answer briefly itself (src/server/macRelease.ts).
 */
export async function GET(): Promise<Response> {
  const published = await macReleasePublished();
  return Response.json({ published }, { headers: { 'cache-control': 'no-store' } });
}
