/**
 * File: apps/web/src/features/live/LiveSession.tsx
 * Purpose: Opens a session's live screen: loads the session, its documents and its saved
 *          transcript from this computer, builds the session's hotwords, starts warming Claude's
 *          prompt cache for the session (Day 3 Stage 5), then shows LivePage.
 *          A session that does not exist here gets a message and a link to the dashboard.
 * Used by: app/(app)/live/[id]/page.tsx
 * Depends on: src/core/storage (sessions, documents, utterances),
 *             src/core/stt/sessionHotwords.ts, src/core/answer/warm.ts, ./LivePage.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session), §8.1
 *               (data stays on this computer), §6.3 (pre-warm); day-03-sessions.md Stages 4–5
 *
 * The session is loaded here, in the browser, because it lives in IndexedDB on this computer:
 * the server never sees it. Loading it before LivePage mounts means the speech engine starts
 * with the session's hotwords already in place.
 *
 * The warm-up runs every time the session is loaded here, so after the session's documents are
 * edited (on the edit page) and the live screen is opened again, the new documents are warmed.
 * It is not awaited: the screen never waits for it.
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { warmSession } from '@/core/answer/warm';
import { loadActiveLessons } from '@/core/lessons/active';
import { listDocuments } from '@/core/storage/documents';
import { getSession } from '@/core/storage/sessions';
import type { Session, StoredDocument, StoredUtterance } from '@/core/storage/types';
import { listUtterances } from '@/core/storage/utterances';
import { buildHotwords, hotwordsText } from '@/core/stt/sessionHotwords';
import { LivePage } from './LivePage';

/** Props for LiveSession. */
export interface LiveSessionProps {
  /** The session id from the URL. */
  sessionId: string;
}

/** What the loader produced. */
type Loaded =
  | {
      /** Still reading from IndexedDB. */
      state: 'loading';
    }
  | {
      /** No session with this id on this computer. */
      state: 'not-found';
    }
  | {
      /** IndexedDB could not be opened or read. */
      state: 'failed';
    }
  | {
      /** Everything the live screen needs. */
      state: 'ready';
      /** The session. */
      session: Session;
      /** Its documents. */
      documents: StoredDocument[];
      /** Its hotwords as engine text ("PHRASE :score" per line). */
      hotwords: string;
      /** How many hotwords. */
      hotwordCount: number;
      /** Lines saved by earlier calls. */
      savedLines: StoredUtterance[];
      /** The approved lessons for this session type (Day 5 Stage 7), oldest approval first. */
      lessons: string[];
    };

/**
 * Loads a session and shows its live screen.
 *
 * @param props See LiveSessionProps.
 * @returns The live screen, or a loading / not-found message.
 * Rendered by: app/(app)/live/[id]/page.tsx
 */
export function LiveSession({ sessionId }: LiveSessionProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession(sessionId);
      if (!session) return { state: 'not-found' } as const;
      const [documents, savedLines, lessons] = await Promise.all([
        listDocuments(session.id),
        listUtterances(session.id),
        // Loaded once: the whole call sends the same lessons, so the rules block stays cached.
        loadActiveLessons(session.type),
      ]);
      // Not awaited: warmSession() never throws, and the screen does not wait for Claude.
      if (!cancelled) void warmSession(session, documents, { lessons });
      const hotwords = buildHotwords(session, documents);
      return {
        state: 'ready',
        session,
        documents,
        hotwords: hotwordsText(hotwords),
        hotwordCount: hotwords.length,
        savedLines,
        lessons,
      } as const;
    })()
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loaded.state === 'ready') {
    return (
      <LivePage
        session={loaded.session}
        documents={loaded.documents}
        hotwords={loaded.hotwords}
        hotwordCount={loaded.hotwordCount}
        savedLines={loaded.savedLines}
        lessons={loaded.lessons}
      />
    );
  }
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      {loaded.state === 'loading' ? (
        <p className="text-sm text-slate-500">Opening the session…</p>
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-slate-900">
            {loaded.state === 'not-found' ? 'Session not found' : 'Could not open the session'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {loaded.state === 'not-found'
              ? 'This session does not exist on this computer. Sessions are saved per browser and per desktop app, so a session created elsewhere does not appear here.'
              : 'Kite could not open its local storage. Reload the page to try again.'}
          </p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700">
            Back to Call Sessions
          </Link>
        </>
      )}
    </div>
  );
}
