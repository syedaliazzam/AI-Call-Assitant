/**
 * File: apps/web/src/features/home/Launcher.tsx
 * Purpose: The desktop app's window for an account with account sync (ADR-0051, ADR-0055): the window
 *          frame and one card at a time: "Your sessions" → the session's Connect card (ADR-0082: Start and
 *          Start again go straight to Connect; the "Start your session" Free / Paid card is gone).
 *          Connect starts the call in the main window (core/live/callStart.ts), and the shell then
 *          hides this window until the call ends. Opened from the Start menu it shows the sessions; opened
 *          by the browser's Start (a paramountai://session link, /home?session=<id>) it goes straight to
 *          that session's Connect card (1.6.1; also an ended one, ADR-0073), and Back shows the sessions
 *          with it first, highlighted.
 *          Google Drive's notices sit above "Your sessions" (1.6.1). The acceptable-use notice, the accurate-transcription offer and the one-time
 *          upload of this account's own unsynced data (ADR-0082) keep their places. Desktop 1.5.0 (ADR-0068): "Recording saved ·
 *          Open in Meetings" after a call that recorded, and this computer's recordings brought up to date
 *          in the account (core/recording/reconcile.ts). ADR-0071: each session card's answer count and
 *          Delete (ADR-0082: no Buy credits button any more).
 * Used by: src/features/home/HomePanel.tsx (accounts with account sync)
 * Depends on: next/navigation, src/core/storage (sessions.ts, answers.ts), src/core/stt/prefetch.ts,
 *             src/core/sync/client.ts,
 *             src/features/appearance/useAppearance, src/features/drive/DriveNotices.tsx,
 *             src/features/notices/AcceptableUseNotice.tsx,
 *             src/features/sync/LegacyUploadCard.tsx, src/platform, ./AccurateDownload.tsx,
 *             ./DesktopFrame.tsx, ./LauncherConnect.tsx, ./LauncherSessions.tsx,
 *             ./RecordingSavedNotice.tsx, src/core/recording (handoff.ts, reconcile.ts)
 *             ADR-0098: src/core/live/liveLock.ts (Take over, "moved"), src/features/live/useLiveElsewhere.ts,
 *             ./CallMovedNotice.tsx
 * Architecture: ADR-0051, ADR-0052, ADR-0055, ADR-0068, ADR-0071, ADR-0098
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { leaveTakeOver, watchCallMoved } from '@/core/live/liveLock';
import { countAnswersBySession } from '@/core/storage/answers';
import { deleteSession, shownStatus, watchSessions } from '@/core/storage/sessions';
import { speechModelPrefetch } from '@/core/stt/prefetch';
import type { Session } from '@/core/storage/types';
import { pullAccountSync } from '@/core/sync/client';
import { useAppearance } from '@/features/appearance/useAppearance';
import { DriveNotices } from '@/features/drive/DriveNotices';
import { AcceptableUseNotice } from '@/features/notices/AcceptableUseNotice';
import { useLiveElsewhere } from '@/features/live/useLiveElsewhere';
import { LegacyUploadCard } from '@/features/sync/LegacyUploadCard';
import { getPlatform } from '@/platform';
import { AccurateDownload } from './AccurateDownload';
import { CallMovedNotice } from './CallMovedNotice';
import { DesktopFrame } from './DesktopFrame';
import { LauncherSessions } from './LauncherSessions';
import { LauncherConnect } from './LauncherConnect';
import { RecordingSavedNotice } from './RecordingSavedNotice';
import { reconcileRecordings } from '@/core/recording/reconcile';
import { watchRecordingSaved } from '@/core/recording/handoff';

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
      /** A session's Connect card (ADR-0082: there is no Start card before it any more). */
      kind: 'connect';
      /** The session. */
      sessionId: string;
    };

/**
 * The card the launcher opens on (1.6.1): the browser's Start button (a paramountai://session link, which
 * the shell turns into /home?session=<id>) goes straight to that session's Connect card (ADR-0082);
 * otherwise "Your sessions".
 *
 * @param fromBrowserId The session the link named, if any.
 * @returns The first card.
 * Called from: Launcher; tests
 */
export function initialLauncherView(fromBrowserId: string | undefined): LauncherView {
  return fromBrowserId ? { kind: 'connect', sessionId: fromBrowserId } : { kind: 'sessions' };
}

/**
 * The card to show (1.6.1): the chosen one, except that the link's session goes back to "Your sessions"
 * when it cannot be started here: it no longer exists, or the account does not have it (after asking it
 * once). The sessions card then says so. An ended session is started again like any other (ADR-0073:
 * each start is a new call in the same session).
 *
 * @param view           The chosen card.
 * @param fromBrowserId  The session the link named, if any.
 * @param linkStatus     That session's status here: 'missing' (looked for and not found), or 'ok'
 *                       (also while the list is still loading).
 * @returns The card to show.
 * Called from: Launcher; tests
 */
export function shownLauncherView(
  view: LauncherView,
  fromBrowserId: string | undefined,
  linkStatus: 'ok' | 'missing',
): LauncherView {
  if (view.kind === 'sessions' || view.sessionId !== fromBrowserId) return view;
  return linkStatus === 'ok' ? view : { kind: 'sessions' };
}

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
  // ADR-0071: each card's "12 answers"; read again whenever the list changes.
  const [answerCounts, setAnswerCounts] = useState<ReadonlyMap<string, number>>(new Map());
  // Fixed per list, so every row judges "live for over 12 hours" the same way.
  const [now, setNow] = useState(0);
  // 1.6.1: a link from the browser's Start opens on that session's Start card.
  const [chosenView, setView] = useState<LauncherView>(() => initialLauncherView(fromBrowserId));
  // The link's session is looked for in the account once when this computer does not have it yet.
  const [pulled, setPulled] = useState(false);
  // Desktop 1.5.0 (ADR-0068): a call just ended with a recording saved ("Recording saved · Open in
  // Meetings").
  const [recordingSaved, setRecordingSaved] = useState(false);
  useEffect(() => watchRecordingSaved(() => setRecordingSaved(true)), []);
  // ADR-0098: a call here was taken over by another device; the call window says so as it closes.
  const [callMoved, setCallMoved] = useState(false);
  useEffect(() => watchCallMoved(() => setCallMoved(true)), []);
  const liveElsewhere = useLiveElsewhere();
  // Recordings this computer finalised after a crash or a quit get their length and size in the
  // account (the shell recovers them when it starts).
  useEffect(() => {
    const host = getPlatform().recording;
    if (available && host) void reconcileRecordings(host).catch(() => undefined);
  }, [available]);

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

  useEffect(() => {
    if (sessions === null) return;
    let active = true;
    countAnswersBySession()
      .then((counts) => {
        if (active) setAnswerCounts(counts);
      })
      // The count is extra: without it the cards show the call length, or "No answers yet".
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [sessions]);

  // The link's session cannot be started here only when it is gone or not in the account (an ended
  // one starts again: ADR-0073).
  const view = shownLauncherView(chosenView, fromBrowserId, missing && pulled ? 'missing' : 'ok');

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
    <DesktopFrame email={email} theme={theme} resolved={resolved} zoom={zoom}>
      <AcceptableUseNotice />
      {view.kind === 'sessions' ? (
        <LauncherSessions
          sessions={sessions}
          failed={failed}
          now={now}
          fromBrowserId={fromBrowserId ?? null}
          fromBrowserMissing={missing && pulled}
          lastCall={lastCall}
          answers={answerCounts}
          // Through account sync the delete reaches the account; the list updates by itself.
          onDelete={async (session) => {
            await deleteSession(session.id);
          }}
          // ADR-0082: Start / Start again go straight to Connect (the audio source).
          onOpen={(session) => setView({ kind: 'connect', sessionId: session.id })}
          // ADR-0098: live on another device: Start disabled, Take over leaves the note for Connect.
          liveElsewhere={liveElsewhere}
          onTakeOver={(session) => {
            leaveTakeOver(session.id);
            setView({ kind: 'connect', sessionId: session.id });
          }}
          notices={
            <>
              {/* 1.6.1: Drive's notices in the card's flow, never over the bottom bar. */}
              <DriveNotices placement="inline" />
              {recordingSaved && <RecordingSavedNotice onClose={() => setRecordingSaved(false)} />}
              {callMoved && <CallMovedNotice onClose={() => setCallMoved(false)} />}
              <AccurateDownload />
              {/* ADR-0049, ADR-0082: offers once to add this account's own unsynced data to it. */}
              <LegacyUploadCard compact />
            </>
          }
        />
      ) : (
        <LauncherConnect
          key={view.sessionId}
          sessionId={view.sessionId}
          saveTranscript={
            sessions?.find((session) => session.id === view.sessionId)?.saveTranscript ?? true
          }
          onBack={toSessions}
          // The call runs: the shell hides this window; when it comes back after End, the sessions
          // card shows "Call ended · View notes".
          onConnected={toSessions}
        />
      )}
    </DesktopFrame>
  );
}
