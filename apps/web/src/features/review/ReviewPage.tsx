/**
 * File: apps/web/src/features/review/ReviewPage.tsx
 * Purpose: The review route's client part: renders SessionReview and, after Delete, goes back
 *          to the dashboard with the Next.js router; after Duplicate (ADR-0129), to the copy's page.
 * Used by: app/(app)/sessions/[id]/page.tsx
 * Depends on: next/navigation, src/features/review/SessionReview.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review), §9.2 (thin routes)
 */
'use client';

import { useRouter } from 'next/navigation';
import { SessionReview } from './SessionReview';

/** Props for ReviewPage. */
export interface ReviewPageProps {
  /** The session id (the [id] segment). */
  sessionId: string;
  /** Batch D (P1-F): the signed-in user's first name, for "Words Paramount AI listens for". */
  accountFirstName?: string;
}

/**
 * The review page.
 *
 * @param props See ReviewPageProps.
 * @returns SessionReview, wired to the router.
 * Rendered by: app/(app)/sessions/[id]/page.tsx
 */
export function ReviewPage({ sessionId, accountFirstName = '' }: ReviewPageProps) {
  const router = useRouter();
  return (
    <SessionReview
      sessionId={sessionId}
      accountFirstName={accountFirstName}
      onDeleted={() => router.push('/')}
      // ADR-0129: after Duplicate, the copy's own page.
      onDuplicated={(copyId) => router.push(`/sessions/${copyId}`)}
    />
  );
}
