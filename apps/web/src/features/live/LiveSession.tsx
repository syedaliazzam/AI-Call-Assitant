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

import { useEffect, useState, useSyncExternalStore } from 'react';
import { warmSession } from '@/core/answer/warm';
import { loadActiveLessons } from '@/core/lessons/active';
import { listDocuments } from '@/core/storage/documents';
import { getSession } from '@/core/storage/sessions';
import type { Session, StoredDocument, StoredUtterance } from '@/core/storage/types';
import { listUtterances } from '@/core/storage/utterances';
import { buildHotwords, hotwordsText } from '@/core/stt/sessionHotwords';
import { getPlatform } from '@/platform';
import { LinkButton } from '@/ui/LinkButton';
import { LiveCallsUnsupported } from './LiveCallsUnsupported';
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
 * No subscription: whether this device can run a call does not change while the page is open.
 *
 * @returns A function that unsubscribes nothing.
 */
const subscribeNever = () => () => {};

/**
 * Loads a session and shows its live screen, or the "live calls need a computer" message on a
 * phone or tablet.
 *
 * @param props See LiveSessionProps.
 * @returns The live screen, the phone message, or a loading / not-found message.
 * Rendered by: app/(app)/live/[id]/page.tsx
 */
export function LiveSession({ sessionId }: LiveSessionProps) {
  // Phones and tablets cannot run a call (platform/). The server renders as if they could and
  // the browser corrects it after hydration, so the two renders match.
  const supported = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().supportsLiveCalls(),
    () => true,
  );
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    // Nothing to load, and no warm-up, where a call cannot run.
    if (!getPlatform().supportsLiveCalls()) return;
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

  if (!supported) return <LiveCallsUnsupported />;
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
    <div className="k-dark min-h-screen bg-ui-bg px-4 py-10 text-ui-text sm:px-8">
      {loaded.state === 'loading' ? (
        <p className="text-sm text-ui-muted">Opening the session…</p>
      ) : (
        <>
          <h1 className="text-[28px] font-bold text-ui-heading">
            {loaded.state === 'not-found' ? 'Session not found' : 'Could not open the session'}
          </h1>
          <p className="mt-2 text-sm text-ui-muted">
            {loaded.state === 'not-found'
              ? 'This session does not exist on this computer. Sessions are saved per browser and per desktop app, so a session created elsewhere does not appear here.'
              : 'Kite could not open its local storage. Reload the page to try again.'}
          </p>
          <LinkButton href="/" className="mt-4">
            Back to Call Sessions
          </LinkButton>
        </>
      )}
    </div>
  );
}
