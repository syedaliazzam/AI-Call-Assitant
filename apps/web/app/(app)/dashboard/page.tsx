/**
 * File: apps/web/app/(app)/dashboard/page.tsx
 * Purpose: The /dashboard address (ADR-0071), a stable link for the desktop app's buttons: /dashboard
 *          opens the sessions page ("/"), and /dashboard?create=1 opens it with Create session open
 *          (/sessions/new, the wizard as a modal over the sessions page). Signed-out visitors are sent
 *          to sign in first by the (app) layout's guard.
 * Used by: Next.js App Router; src/features/home/LauncherSessions.tsx (+ Create session)
 * Depends on: next/navigation
 * Architecture: ADR-0071
 */
import { redirect } from 'next/navigation';

/**
 * Sends the visitor on.
 *
 * @param props.searchParams The address's query: `create=1` opens Create session.
 * @returns Never: it always redirects.
 */
export default async function DashboardRedirect({
  searchParams,
}: {
  /** The address's query, as Next.js passes it. */
  searchParams: Promise<{ create?: string | string[] }>;
}): Promise<never> {
  const { create } = await searchParams;
  redirect(create === '1' ? '/sessions/new?type=interview' : '/');
}
