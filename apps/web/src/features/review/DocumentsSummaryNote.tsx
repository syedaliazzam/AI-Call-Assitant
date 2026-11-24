/**
 * File: apps/web/src/features/review/DocumentsSummaryNote.tsx
 * Purpose: ADR-0116: a short muted note under "Documents" in Call details when the summary of the
 *          session's documents (other than the CV) is unavailable: its last request failed, so AI
 *          notes, Ask AI and the Prepare tools work without those documents until it is written. Says
 *          when it is tried again. Shows nothing in every other case.
 * Used by: src/features/review/SessionReview.tsx (Call details)
 * Depends on: src/core/documents/summary.ts (documentsSummaryStatus)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0116
 */
'use client';

import { useEffect, useState } from 'react';
import { documentsSummaryStatus, type DocumentsSummaryStatus } from '@/core/documents/summary';
import type { Session, StoredDocument } from '@/core/storage/types';

/** Props for DocumentsSummaryNote. */
export interface DocumentsSummaryNoteProps {
  /** The stored session. */
  session: Session;
  /** Its documents (any order). */
  documents: readonly StoredDocument[];
  /** The clock (tests; default Date.now). */
  now?: () => number;
}

/** Time format for the retry, in the user's locale (for example "14:05"). */
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

/**
 * The note, or nothing when the summary is not unavailable.
 *
 * @param props See DocumentsSummaryNoteProps.
 * @returns A muted paragraph, or null.
 * Rendered by: SessionReview.tsx (Call details, under Documents)
 */
export function DocumentsSummaryNote({
  session,
  documents,
  now = Date.now,
}: DocumentsSummaryNoteProps) {
  const [status, setStatus] = useState<DocumentsSummaryStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void documentsSummaryStatus(session, documents).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [session, documents]);

  if (status?.state !== 'unavailable') return null;
  const when =
    status.retryAt > now()
      ? `It will be tried again after ${TIME_FORMAT.format(status.retryAt)}.`
      : 'It will be tried again the next time it is needed.';
  return (
    <p className="mt-1 text-[13px] text-ui-muted" role="status">
      Documents summary unavailable: AI notes, Ask AI and Prepare cannot see the documents other
      than the CV until it is written. {when}
    </p>
  );
}
