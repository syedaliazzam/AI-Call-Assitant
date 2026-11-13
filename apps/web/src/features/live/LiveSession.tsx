/**
 * File: apps/web/src/features/live/LiveSession.tsx
 * Purpose: Opens a session's live screen: loads the session, its documents and its saved
 *          transcript from this computer, builds the session's hotwords, starts warming Claude's
 *          prompt cache for the session (Day 3 Stage 5), then shows LivePage.
 *          A session that does not exist here gets a message and a link to the dashboard.
 * Used by: app/(app)/live/[id]/page.tsx
 * Depends on: src/core/storage (sessions, documents, utterances), (ADR-0076) the cloud-transcription flag
 *             from the route and buildKeyterms(),
 *             src/core/stt/sessionHotwords.ts, src/core/answer/warm.ts,
 *             src/core/documents/summary.ts (ADR-0067), ./LivePage.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session), §8.1
 *               (data stays on this computer), §6.3 (pre-warm); day-03-sessions.md Stages 4–5
 *
 * The session is loaded here, in the browser, because it lives in IndexedDB on this computer:
 * the server never sees it. Loading it before LivePage mounts means the speech engine starts
 * with the session's hotwords already in place.
 *
 * The warm-up runs every time the session is loaded here, so after the session's documents are
 * edited (on the edit page) and the live screen is opened again, the new documents are warmed.
 * It is not awaited: the screen never waits for it. The documents summary (ADR-0067) is written
 * the same way, if it is missing or the documents changed, so the notes at the end of the call do
 * not have to wait for it.
 *
 * Batch C (P1-3, P2-1): while the screen is open, the session and its documents are watched. A change made
 * elsewhere (key terms edited, a document added) updates the call's keyterms (cloud transcription sends
 * them to Deepgram without reconnecting) and its documents (the parts that go with each question); a new
 * documents summary (the live answers' cached prefix since Batch C) is warmed at once.
 */
'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { warmSession } from '@/core/answer/warm';
import { ensureDocumentsSummary } from '@/core/documents/summary';
import { loadActiveLessons } from '@/core/lessons/active';
import { listDocuments, watchSessionDocuments } from '@/core/storage/documents';
import { getSession } from '@/core/storage/sessions';
import type { Session, StoredDocument, StoredUtterance } from '@/core/storage/types';
import { listUtterances } from '@/core/storage/utterances';
import { buildHotwords, buildKeyterms, hotwordsText } from '@/core/stt/sessionHotwords';
import { getPlatform } from '@/platform';
import { ErrorScreen } from '@/ui/ErrorScreen';
import { LinkButton } from '@/ui/LinkButton';
import { LiveCallsUnsupported } from './LiveCallsUnsupported';
import { LivePage } from './LivePage';

/** Props for LiveSession. */
export interface LiveSessionProps {
  /** The session id from the URL. */
  sessionId: string;
  /** ADR-0076: this account uses cloud transcription (decided on the server; default false). */
  cloudStt?: boolean;
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
      /** ADR-0076: the session's keyterms for cloud transcription. */
      keyterms: string[];
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
export function LiveSession({ sessionId, cloudStt = false }: LiveSessionProps) {
  // Phones and tablets cannot run a call (platform/). The server renders as if they could and
  // the browser corrects it after hydration, so the two renders match.
  const supported = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().supportsLiveCalls(),
    () => true,
  );
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // Batch C: the latest loaded state, for the watcher below (it compares against it).
  const loadedRef = useRef<Loaded>(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  });

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
      // Not awaited: warmSession() never throws, and the screen does not wait for Claude. 1.5.1
      // (ADR-0069): the summary the notes and Ask AI read (kept on the session) is asked for after the
      // warm-up, so the two large uploads do not compete with each other at the start of a call.
      if (!cancelled) {
        void warmSession(session, documents, { lessons }).then(() =>
          ensureDocumentsSummary(session, documents),
        );
      }
      const hotwords = buildHotwords(session, documents);
      return {
        state: 'ready',
        session,
        documents,
        hotwords: hotwordsText(hotwords),
        hotwordCount: hotwords.length,
        keyterms: buildKeyterms(session, documents),
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

  // Batch C (P1-3, P2-1): follow changes to the session and its documents while the screen is open.
  const ready = loaded.state === 'ready';
  useEffect(() => {
    if (!ready) return;
    return watchSessionDocuments(sessionId, (session, documents) => {
      const current = loadedRef.current;
      if (!session || current.state !== 'ready') return;
      const keyterms = buildKeyterms(session, documents);
      const sameTerms =
        keyterms.length === current.keyterms.length &&
        keyterms.every((term, index) => term === current.keyterms[index]);
      const docKey = (list: readonly StoredDocument[]) =>
        list.map((document) => `${document.id}:${document.chars}:${document.name}`).join('|');
      const sameDocuments = docKey(documents) === docKey(current.documents);
      const summaryAt = session.documentsSummary?.createdAt ?? 0;
      const sameSummary = summaryAt === (current.session.documentsSummary?.createdAt ?? 0);
      if (sameTerms && sameDocuments && sameSummary) return;
      // Only what the call follows changes: the summary on the session, the documents, the keyterms.
      const next = {
        ...current,
        ...(sameTerms ? {} : { keyterms }),
        ...(sameDocuments ? {} : { documents }),
        ...(sameSummary
          ? {}
          : {
              session: {
                ...current.session,
                ...(session.documentsSummary ? { documentsSummary: session.documentsSummary } : {}),
              },
            }),
      };
      // New documents get their summary written (nothing happens when it already matches); a new summary
      // is the answers' cached prefix, so it is warmed now. Neither is awaited or ever throws.
      if (!sameDocuments) void ensureDocumentsSummary(next.session, documents);
      if (!sameSummary) void warmSession(next.session, next.documents, { lessons: next.lessons });
      loadedRef.current = next;
      setLoaded(next);
    });
  }, [ready, sessionId]);

  if (!supported) return <LiveCallsUnsupported />;
  if (loaded.state === 'ready') {
    return (
      <LivePage
        session={loaded.session}
        documents={loaded.documents}
        hotwords={loaded.hotwords}
        hotwordCount={loaded.hotwordCount}
        keyterms={loaded.keyterms}
        cloudStt={cloudStt}
        savedLines={loaded.savedLines}
        lessons={loaded.lessons}
      />
    );
  }
  if (loaded.state === 'loading') {
    return <p className="px-4 py-10 text-[13px] text-ui-muted sm:px-8">Opening the session…</p>;
  }
  return (
    <ErrorScreen
      title={loaded.state === 'not-found' ? 'Session not found' : 'Could not open the session'}
      action={
        <LinkButton href="/" variant="primary">
          Back to dashboard
        </LinkButton>
      }
    >
      <p>
        {loaded.state === 'not-found'
          ? 'This session does not exist on this computer. Sessions are saved per browser and per desktop app, so a session created elsewhere does not appear here.'
          : 'Paramount AI could not open its local storage. Reload the page to try again.'}
      </p>
    </ErrorScreen>
  );
}
