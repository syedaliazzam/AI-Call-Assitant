/**
 * File: apps/web/src/features/home/LauncherConnect.tsx
 * Purpose: The desktop app's "Connect Call Session" card (reference "connect call session card",
 *          ADR-0055): the title and "Your session is ready. Connect to start transcribing.", "Audio
 *          source" with "System audio", three tips (Zoom's window filtering, testing privacy, a mock
 *          video), then Back and Connect; under the card "Need it for macOS?" and "← Back to dashboard".
 *          The microphone is chosen on the call bar (▾), not here. v1.3.1 (ADR-0059): there is no
 *          "Speech model needed" dialog any more. The model ships in the installer and is made ready in
 *          the background when the app opens (core/stt/prefetch.ts); Connect waits for that, and shows a
 *          small progress bar only if it is still running (a silent download when the installer's copy
 *          was missing). Connecting starts the call in the main window (core/live/callStart.ts); the
 *          shell then hides this window and the call bars appear. A call that fails to start says why
 *          here, with Connect to try again. ADR-0082: no "Record" choice here any more (until 1.6.3: Off /
 *          Audio only / Screen + audio and a display picker): recording starts only from the call bars' Rec
 *          pill. Where the app can record, the "Everyone on the call has agreed to be recorded" tick stays;
 *          ticked, it reaches the live page through core/recording/handoff.ts, so the Rec pill starts
 *          without asking again. It never blocks Connect.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: lucide-react, src/core/live/callStart.ts, src/core/stt/prefetch.ts,
 *             src/features/sync/dashboardLink.ts, src/platform,
 *             src/ui (ProgressBar, Select, Tooltip, Chip)
 * Architecture: ADR-0053 (Connect starts the call), ADR-0055, ADR-0059
 */
'use client';

import { ArrowLeft, Play, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { requestCallStart, watchCallStart } from '@/core/live/callStart';
import { leaveRecordConsent } from '@/core/recording/handoff';
import { NO_STEREO_WARNING } from '@/features/live/overlay/RecordControls';
import { speechModelPrefetch, type PrefetchState } from '@/core/stt/prefetch';
import { openDashboard } from '@/features/sync/dashboardLink';
import { getPlatform } from '@/platform';
import { SOON_TOOLTIP } from '@/ui/Chip';
import { ProgressBar } from '@/ui/ProgressBar';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';

/** Props for LauncherConnect. */
export interface LauncherConnectProps {
  /** The session to connect. */
  sessionId: string;
  /** Desktop 1.5.0 (ADR-0068): whether the session saves its transcript (the stereo file needs it). */
  saveTranscript?: boolean;
  /** Back to "Your sessions" (ADR-0082: there is no Start card before this one). */
  onBack: () => void;
  /** The call is running (the shell hides this window; the card goes back to the sessions). */
  onConnected: () => void;
}

/** A public search for mock interviews, for trying the app without a real call. */
export const MOCK_VIDEO_URL = 'https://www.youtube.com/results?search_query=mock+interview';

/**
 * No-op subscription: whether this app can record never changes while the page is open.
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Whether this desktop app can record (1.5.0).
 * @returns True when the platform has a recording host.
 */
const hasRecording = () => getPlatform().recording !== null;

/** How long Connect waits for the main window to report, in ms (the speech model loads first). */
const START_TIMEOUT_MS = 60_000;

/** Where Connect is ('preparing': waiting for the speech model to be ready). */
type Phase = 'idle' | 'preparing' | 'connecting' | 'failed';

/** The server render's model state (the prefetch runs only in the browser). */
const IDLE: PrefetchState = { kind: 'idle' };

/** The look of a tip's link (reference: underlined, at the right). */
const TIP_LINK =
  'shrink-0 rounded-[4px] text-[15px] font-medium text-ui-heading underline decoration-1 underline-offset-[6px] hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/** The tips' icons. */
const TIP_ICON = { size: 20, strokeWidth: 1.5, 'aria-hidden': true } as const;

/**
 * One tip: an icon, the words and a link at the right.
 *
 * @param props.icon     The icon.
 * @param props.children The words.
 * @param props.action   The link.
 * @returns The row.
 * Rendered by: LauncherConnect
 */
function Tip({
  icon,
  children,
  action,
}: {
  /** The icon. */
  icon: ReactNode;
  /** The words. */
  children: ReactNode;
  /** The link. */
  action: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 text-[15px] leading-snug text-ui-text">{children}</span>
      {action}
    </li>
  );
}

/**
 * The card.
 *
 * @param props See LauncherConnectProps.
 * @returns The card, the links under it, and the speech model dialog when needed.
 * Rendered by: Launcher.tsx
 */
export function LauncherConnect({
  sessionId,
  saveTranscript = true,
  onBack,
  onConnected,
}: LauncherConnectProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  // ADR-0082: consent is ticked for every call (never remembered); it only lets the Rec pill start at once.
  const canRecord = useSyncExternalStore(subscribeNever, hasRecording, () => false);
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const prefetch = speechModelPrefetch(globalThis.location?.origin ?? '');
  const model = useSyncExternalStore(prefetch.subscribe, prefetch.state, () => IDLE);
  const mounted = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedRef = useRef(onConnected);
  useEffect(() => {
    connectedRef.current = onConnected;
  });

  // The main window's live page reports how the start went.
  useEffect(
    () =>
      watchCallStart(sessionId, 'status', (message) => {
        if (message.state === 'connected') {
          if (timeout.current) clearTimeout(timeout.current);
          setPhase('idle');
          connectedRef.current();
        } else if (message.state === 'failed') {
          if (timeout.current) clearTimeout(timeout.current);
          setPhase('failed');
          setProblem(message.message ?? 'The call could not start. Try again.');
        }
      }),
    [sessionId],
  );

  // Leaving the card stops the wait. The model keeps getting ready in the background.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  /** Asks the main window to start the call, and waits for its answer. */
  const start = () => {
    setPhase('connecting');
    setProblem(null);
    // ADR-0082: no call records from the start; the tick only carries the consent to the Rec pill.
    leaveRecordConsent(sessionId, canRecord && consent);
    requestCallStart(sessionId);
    getPlatform().openCallWindow(sessionId);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      setPhase('failed');
      setProblem('The call did not start. Try again.');
    }, START_TIMEOUT_MS);
  };

  /**
   * Connect: waits for the speech model (usually ready already; otherwise its background load
   * continues, or starts again after a failure), then starts the call.
   */
  const connect = async () => {
    setPhase('preparing');
    setProblem(null);
    const ready = await prefetch.start();
    if (!mounted.current) return;
    if (ready) {
      start();
      return;
    }
    setPhase('failed');
    setProblem('The speech model could not be downloaded. Check the connection and try again.');
  };

  const busy = phase === 'preparing' || phase === 'connecting';
  // The bar shows only while Connect waits on a load that is still running.
  const loading = phase === 'preparing' && model.kind === 'downloading' ? model : null;

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
      <div className="k-anim-modal k-card-texture flex flex-col gap-5 rounded-[16px] border border-ui-border p-5">
        <header className="flex flex-col items-center gap-2 pt-1 text-center">
          <h1 className="text-[24px] font-medium leading-tight text-ui-heading">
            Connect Call Session
          </h1>
          <p className="text-[16px] text-ui-muted">
            Your session is ready. Connect to start transcribing.
          </p>
        </header>

        <div className="flex items-center justify-between gap-4">
          <span className="text-[15px] font-medium text-ui-heading">Audio source</span>
          <div className="w-48">
            <Select
              label="Audio source"
              hideLabel
              align="end"
              options={[{ value: 'system', label: 'System audio' }]}
              value="system"
              onChange={() => undefined}
            />
          </div>
        </div>

        {canRecord && (
          // ADR-0082: no Record choice; recording starts from the call bars' Rec pill. Ticked, the pill
          // starts without asking again in this call.
          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-2.5 text-[15px] text-ui-text">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-[var(--ui-accent-fill)]"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>Everyone on the call has agreed to be recorded</span>
            </label>
            <p className="text-[13px] text-ui-muted">
              To record, press Rec on the call bar (or Ctrl+Alt+R). Recordings are saved on this
              computer only, in Documents › Paramount AI › Recordings.
            </p>
            {!saveTranscript && <p className="text-[13px] text-ui-warning">{NO_STEREO_WARNING}</p>}
          </div>
        )}

        <ul
          aria-label="Tips"
          className="flex flex-col divide-y divide-ui-border rounded-[14px] border border-ui-border"
        >
          <Tip
            icon={<TriangleAlert {...TIP_ICON} className="text-ui-warning" />}
            action={
              <button
                type="button"
                className={TIP_LINK}
                onClick={() => openDashboard('/help#zoom')}
              >
                How
              </button>
            }
          >
            On Zoom, update it and turn on advanced capture with window filtering.
          </Tip>
          <Tip
            icon={<ShieldCheck {...TIP_ICON} className="text-ui-muted" />}
            action={
              <button
                type="button"
                className={TIP_LINK}
                onClick={() => openDashboard('/help#private')}
              >
                Watch
              </button>
            }
          >
            Update your OS and call app, and test privacy before a real call.
          </Tip>
          <Tip
            icon={<Play {...TIP_ICON} className="text-ui-muted" />}
            action={
              <a href={MOCK_VIDEO_URL} target="_blank" rel="noreferrer" className={TIP_LINK}>
                Open
              </a>
            }
          >
            No call to test on? Share a mock video on YouTube.
          </Tip>
        </ul>

        {problem && (
          <p
            role="alert"
            className="rounded-[10px] bg-ui-danger-bg px-3 py-2 text-[14px] text-ui-danger"
          >
            {problem}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-[10px] border border-ui-border bg-ui-bg px-4 text-[15px] font-medium text-ui-heading hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] disabled:opacity-60"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-ui-primary px-4 text-[15px] font-semibold text-ui-on-primary hover:bg-ui-primary-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] disabled:opacity-70"
          >
            <Upload aria-hidden="true" size={18} strokeWidth={1.75} />
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>

        {loading && (
          <div className="flex flex-col gap-1.5" data-testid="model-progress">
            <ProgressBar
              value={loading.progress?.fraction ?? 0}
              label="Getting the speech model ready"
            />
            <p className="text-[13px] tabular-nums text-ui-muted">
              Getting the speech model ready
              {loading.progress ? ` · ${Math.round(loading.progress.fraction * 100)}%` : '…'}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 pb-2 text-[15px] text-ui-muted">
        <Tooltip content={SOON_TOOLTIP}>
          <span tabIndex={0} className="inline-flex items-center">
            Need it for&nbsp;
            <span className="text-ui-heading underline decoration-1 underline-offset-[6px]">
              macOS
            </span>
            ?
          </span>
        </Tooltip>
        <button
          type="button"
          onClick={() => openDashboard('/')}
          className="inline-flex items-center gap-1.5 rounded-control hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
