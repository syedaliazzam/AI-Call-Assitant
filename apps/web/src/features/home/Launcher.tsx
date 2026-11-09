/**
 * File: apps/web/src/features/home/Launcher.tsx
 * Purpose: The desktop app's window for an account with account sync (ADR-0051, ADR-0055): the window
 *          frame and one card at a time: "Your sessions" → the session's Start card → its Connect card.
 *          Connect starts the call in the main window (core/live/callStart.ts), and the shell then
 *          hides this window until the call ends. Opened from the Start menu it shows the sessions; opened
 *          by the browser's "Desktop app" link (/home?session=<id>) that session comes first,
 *          highlighted. The acceptable-use notice, the accurate-transcription offer and the one-time
 *          upload of this computer's own data keep their places.
 * Used by: src/features/home/HomePanel.tsx (accounts with account sync)
 * Depends on: next/navigation, src/core/storage/sessions.ts, src/core/stt/prefetch.ts,
 *             src/core/sync/client.ts,
 *             src/features/appearance/useAppearance, src/features/notices/AcceptableUseNotice.tsx,
 *             src/features/sync/LegacyUploadCard.tsx, src/platform, ./AccurateDownload.tsx,
 *             ./DesktopFrame.tsx, ./LauncherConnect.tsx, ./LauncherSessions.tsx, ./LauncherStart.tsx
 * Architecture: ADR-0051, ADR-0052, ADR-0055
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { shownStatus, watchSessions } from '@/core/storage/sessions';
import { speechModelPrefetch } from '@/core/stt/prefetch';
import type { Session } from '@/core/storage/types';
import { pullAccountSync } from '@/core/sync/client';
import { useAppearance } from '@/features/appearance/useAppearance';
import { AcceptableUseNotice } from '@/features/notices/AcceptableUseNotice';
import { LegacyUploadCard } from '@/features/sync/LegacyUploadCard';
import { getPlatform } from '@/platform';
import { AccurateDownload } from './AccurateDownload';
import { DesktopFrame } from './DesktopFrame';
import { LauncherSessions } from './LauncherSessions';
import { LauncherConnect } from './LauncherConnect';
import { LauncherStart } from './LauncherStart';

/** Props for Launcher. */
export interface LauncherProps {
  /** The signed-in person's email. */
  email: string;
  /** The session the browser's "Desktop app" link named: shown first, highlighted. */
  fromBrowserId?: string;
}

/** Which card shows. */
export type LauncherView =
  | {
      /** "Your sessions". */
      kind: 'sessions';
    }
  | {
      /** A session's Start card, or its Connect card. */
      kind: 'start' | 'connect';
      /** The session. */
      sessionId: string;
    };

/** The window size the cards are drawn for (reference: about 560 × 720 CSS px). */
export const LAUNCHER_SIZE = { width: 560, height: 720 };

/** How long after a call the launcher offers its notes, in ms. */
export const LAST_CALL_MS = 2 * 60 * 60 * 1000;

/**
 * A call that ended in the last LAST_CALL_MS, the most recent first.
 *
 * @param sessions The sessions.
 * @param now      The clock, in ms.
 * @returns The session, or null.
 * Called from: Launcher; tests
 */
export function lastEndedCall(sessions: readonly Session[], now: number): Session | null {
  const recent = sessions
    .filter(
      (session) =>
        shownStatus(session, now) === 'ended' &&
        now - (session.lastActiveAt ?? session.createdAt) < LAST_CALL_MS,
    )
    .sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt));
  return recent[0] ?? null;
}

/**
 * Nothing to subscribe to: the platform does not change while the page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Whether this app has the home panel. Server render: yes, so a desktop app paints it at once.
 *
 * @returns True in a desktop app from 1.1.0.
 */
const hasPanel = () => getPlatform().hasHomePanel();

/**
 * The launcher.
 *
 * @param props See LauncherProps.
 * @returns The frame and the current card.
 * Rendered by: HomePanel.tsx
 */
export function Launcher({ email, fromBrowserId }: LauncherProps) {
  const router = useRouter();
  const available = useSyncExternalStore(subscribeNever, hasPanel, () => true);
  const { theme, resolved, zoom } = useAppearance('dashboard');
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Fixed per list, so every row judges "live for over 12 hours" the same way.
  const [now, setNow] = useState(0);
  const [view, setView] = useState<LauncherView>({ kind: 'sessions' });
  // The link's session is looked for in the account once when this computer does not have it yet.
  const [pulled, setPulled] = useState(false);

  // Anywhere but a desktop app from 1.1.0 this page has no window of its own.
  useEffect(() => {
    if (!available) router.replace('/');
  }, [available, router]);

  // The cards are drawn for a window of about 560 × 720 (desktop 1.3.0 sizes it; older ones keep theirs).
  useEffect(() => {
    getPlatform().sizePanel(LAUNCHER_SIZE.width, LAUNCHER_SIZE.height);
  }, []);

  // v1.3.1 (ADR-0059): the speech model gets ready in the background as soon as the app opens (from
  // the installer's copy, or a silent download when that is missing), so Connect does not wait.
  useEffect(() => {
    if (available) void speechModelPrefetch(globalThis.location.origin).start();
  }, [available]);

  useEffect(
    () =>
      watchSessions(
        (rows) => {
          setSessions(rows);
          setNow(Date.now());
        },
        () => setFailed(true),
      ),
    [],
  );

  // A session just made in the browser may not be on this computer yet: ask the account once.
  const missing =
    fromBrowserId !== undefined &&
    sessions !== null &&
    !sessions.some((session) => session.id === fromBrowserId);
  useEffect(() => {
    if (!missing || pulled) return;
    let active = true;
    pullAccountSync()
      .catch(() => undefined)
      .finally(() => {
        if (active) setPulled(true);
      });
    return () => {
      active = false;
    };
  }, [missing, pulled]);

  const lastCall = useMemo(
    () => (sessions === null ? null : lastEndedCall(sessions, now)),
    [sessions, now],
  );

  /**
   * Back to "Your sessions".
   *
   * @returns Nothing.
   */
  const toSessions = () => setView({ kind: 'sessions' });

  return (
    <DesktopFrame
      email={email}
      theme={theme}
      resolved={resolved}
      zoom={zoom}
      buyCredits={view.kind !== 'sessions'}
    >
      <AcceptableUseNotice />
      {view.kind === 'sessions' ? (
        <LauncherSessions
          sessions={sessions}
          failed={failed}
          now={now}
          fromBrowserId={fromBrowserId ?? null}
          fromBrowserMissing={missing && pulled}
          lastCall={lastCall}
          onOpen={(session) => setView({ kind: 'start', sessionId: session.id })}
          notices={
            <>
              <AccurateDownload />
              {/* ADR-0049: offers once to add this computer's own data to the account. */}
              <LegacyUploadCard compact />
            </>
          }
        />
      ) : view.kind === 'start' ? (
        <LauncherStart
          email={email}
          onStartFree={() => setView({ kind: 'connect', sessionId: view.sessionId })}
          onBack={toSessions}
        />
      ) : (
        <LauncherConnect
          key={view.sessionId}
          sessionId={view.sessionId}
          onBack={() => setView({ kind: 'start', sessionId: view.sessionId })}
          // The call runs: the shell hides this window; when it comes back after End, the sessions
          // card shows "Call ended · View notes".
          onConnected={toSessions}
        />
      )}
    </DesktopFrame>
  );
}
