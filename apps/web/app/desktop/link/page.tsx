/**
 * File: apps/web/app/desktop/link/page.tsx
 * Purpose: The /desktop/link route: where the desktop app (1.3.0) lands for a paramountai:// link with
 *          a one-time sign-in code (ADR-0052). Public on purpose (the app may be signed out): the page
 *          signs in with the code, which the shell hands over directly, never in this address.
 * Used by: Next.js App Router; loaded by apps/desktop/src/home.ts
 * Depends on: src/features/handoff/DesktopLinkPage.tsx
 * Architecture: ADR-0052; docs/architecture/kite-architecture-v3.1.md §9.2 (thin routes)
 */
import { DesktopLinkPage } from '@/features/handoff/DesktopLinkPage';

/** Next.js route setting: each visit is a new link. */
export const dynamic = 'force-dynamic';

/** A session id: the UUID the app makes. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Desktop link page.
 *
 * @param props.searchParams The address's query: `session` is the session the link names.
 * @returns The page.
 */
export default async function DesktopLinkRoute({
  searchParams,
}: {
  /** The address's query, as Next.js passes it. */
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const { session } = await searchParams;
  const sessionId = typeof session === 'string' && SESSION_ID.test(session) ? session : '';
  return <DesktopLinkPage sessionId={sessionId} />;
}
