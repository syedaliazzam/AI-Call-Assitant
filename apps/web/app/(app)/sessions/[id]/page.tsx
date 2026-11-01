/**
 * File: apps/web/app/(app)/sessions/[id]/page.tsx
 * Purpose: The /sessions/[id] route: the session review (Day 5 Stage 6). Kept thin: the
 *          session lives in IndexedDB on this computer, so it is loaded in the browser.
 * Used by: Next.js App Router (a session card's "Review" link)
 * Depends on: src/features/review/ReviewPage.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review), §9.2 (thin routes)
 */
import { ReviewPage } from '@/features/review/ReviewPage';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface ReviewRouteProps {
  /** The route parameters. */
  params: Promise<{
    /** The [id] segment: the session id. */
    id: string;
  }>;
}

/**
 * Session review page.
 *
 * @param props.params The route parameters.
 * @returns The review for this session.
 */
export default async function SessionReviewRoute({ params }: ReviewRouteProps) {
  const { id } = await params;
  return <ReviewPage sessionId={id} />;
}
