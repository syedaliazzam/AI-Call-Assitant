/**
 * File: apps/web/app/(app)/live/[id]/page.tsx
 * Purpose: The /live/[id] route: a session's live screen (Connect view, then the transcript).
 *          Signed-in users only (the (app) layout's guard). Kept thin: the session lives in
 *          IndexedDB on this computer, so LiveSession loads it in the browser (an unknown id
 *          shows "Session not found" there, not a server 404).
 * Used by: Next.js App Router; opened from the dashboard (Open, then Choose platform)
 * Depends on: src/features/live/LiveSession.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session), §8.1,
 *               §9.2 (thin routes); day-03-sessions.md Stage 4
 */
import { LiveSession } from '@/features/live/LiveSession';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface LiveRouteProps {
  /** The route parameters. */
  params: Promise<{
    /** The [id] segment: the session id. */
    id: string;
  }>;
}

/**
 * Live session page.
 *
 * @param props.params The route parameters.
 * @returns The live screen for the session.
 */
export default async function LiveRoute({ params }: LiveRouteProps) {
  const { id } = await params;
  return <LiveSession sessionId={id} />;
}
