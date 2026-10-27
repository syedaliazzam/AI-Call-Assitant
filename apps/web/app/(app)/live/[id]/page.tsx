/**
 * File: apps/web/app/(app)/live/[id]/page.tsx
 * Purpose: The /live/[id] route: the live session screen (Connect view, then the transcript).
 *          Signed-in users only (the (app) layout's guard). On Day 2 only the id "demo" exists;
 *          any other id is a 404.
 * Used by: Next.js App Router; linked from /dev (Dev tools) until Day 3 adds real sessions
 * Depends on: src/features/live/LivePage.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session), §9.2
 */
import { notFound } from 'next/navigation';
import { LivePage } from '@/features/live/LivePage';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface LiveRouteProps {
  /** The [id] segment. */
  params: Promise<{ id: string }>;
}

/**
 * Live session page.
 *
 * @param props.params The route parameters.
 * @returns The live screen for the demo session.
 * @throws Next.js notFound() for any id other than "demo".
 */
export default async function LiveRoute({ params }: LiveRouteProps) {
  const { id } = await params;
  // Day 3: load the session from IndexedDB (in the browser) instead of accepting only "demo".
  if (id !== 'demo') notFound();
  return <LivePage sessionId={id} />;
}
