/**
 * File: apps/web/src/features/home/LauncherConnect.tsx
 * Purpose: The desktop app's "Connect Call Session" card (reference "connect call session card",
 *          ADR-0055): the title and "Your session is ready. Connect to start transcribing.", "Audio
 *          source" with "System audio", three tips (Zoom's window filtering, testing privacy, a mock
 *          video), then Back and Connect; under the card "Need it for macOS?" and "← Back to dashboard".
 *          The microphone is chosen on the call bar (▾), not here. Connect checks that the speech model
 *          is on this computer: if not, a small dialog offers the one-time download (about 204 MB) with
 *          a progress bar, then connects. Connecting starts the call in the main window
 *          (core/live/callStart.ts); the shell then hides this window and the call bars appear. A call
 *          that fails to start says why here, with Connect to try again.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: lucide-react, src/core/live/callStart.ts, src/core/stt/modelCache.ts,
 *             src/core/stt/download.ts (types), src/features/sync/dashboardLink.ts, src/platform,
 *             src/ui (Dialog, ProgressBar, Select, Tooltip, Chip)
 * Architecture: ADR-0053 (Connect starts the call), ADR-0055
 */
'use client';

import { ArrowLeft, Play, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { requestCallStart, watchCallStart } from '@/core/live/callStart';
import type { DownloadProgress } from '@/core/stt/download';
import { downloadSpeechModel, speechModelBytes, speechModelCached } from '@/core/stt/modelCache';
import { openDashboard } from '@/features/sync/dashboardLink';
import { getPlatform } from '@/platform';
import { SOON_TOOLTIP } from '@/ui/Chip';
import { Dialog } from '@/ui/Dialog';
import { ProgressBar } from '@/ui/ProgressBar';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';

/** Props for LauncherConnect. */
export interface LauncherConnectProps {
  /** The session to connect. */
  sessionId: string;
  /** Back to the Start card. */
  onBack: () => void;
  /** The call is running (the shell hides this window; the card goes back to the sessions). */
  onConnected: () => void;
}

/** A public search for mock interviews, for trying the app without a real call. */
export const MOCK_VIDEO_URL = 'https://www.youtube.com/results?search_query=mock+interview';

/** How long Connect waits for the main window to report, in ms (the speech model loads first). */
const START_TIMEOUT_MS = 60_000;

/** Where Connect is. */
type Phase = 'idle' | 'checking' | 'model-needed' | 'downloading' | 'connecting' | 'failed';

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
 * Formats bytes as whole megabytes.
 *
 * @param bytes Bytes.
 * @returns For example "204 MB".
 */
function mb(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

/**
 * The card.
 *
 * @param props See LauncherConnectProps.
 * @returns The card, the links under it, and the speech model dialog when needed.
 * Rendered by: Launcher.tsx
 */
export function LauncherConnect({ sessionId, onBack, onConnected }: LauncherConnectProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const download = useRef<AbortController | null>(null);
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

  // Leaving the card stops a download and the wait.
  useEffect(
    () => () => {
      download.current?.abort();
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  /** Asks the main window to start the call, and waits for its answer. */
  const start = () => {
    setPhase('connecting');
    setProblem(null);
    requestCallStart(sessionId);
    getPlatform().openCallWindow(sessionId);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      setPhase('failed');
      setProblem('The call did not start. Try again.');
    }, START_TIMEOUT_MS);
  };

  /** Connect: the speech model first (a dialog when it must be downloaded), then the call. */
  const connect = async () => {
    setPhase('checking');
    setProblem(null);
    if (await speechModelCached(globalThis.location.origin)) start();
    else setPhase('model-needed');
  };

  /** "Download and connect": the one-time download, then the call. */
  const downloadThenConnect = async () => {
    const controller = new AbortController();
    download.current = controller;
    setPhase('downloading');
    setProgress(null);
    try {
      await downloadSpeechModel(globalThis.location.origin, setProgress, controller.signal);
      download.current = null;
      start();
    } catch {
      download.current = null;
      if (controller.signal.aborted) {
        setPhase('idle');
        return;
      }
      setPhase('failed');
      setProblem('The speech model could not be downloaded. Check the connection and try again.');
    }
  };

  /** Cancel in the dialog: stops a download. */
  const cancelDownload = () => {
    download.current?.abort();
    download.current = null;
    setPhase('idle');
  };

  const busy = phase === 'checking' || phase === 'connecting';
  const dialogOpen = phase === 'model-needed' || phase === 'downloading';

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
      <div className="flex flex-col gap-5 rounded-[16px] border border-ui-border bg-ui-bg p-5">
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
            disabled={busy || dialogOpen}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-ui-primary px-4 text-[15px] font-semibold text-ui-on-primary hover:bg-ui-primary-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] disabled:opacity-70"
          >
            <Upload aria-hidden="true" size={18} strokeWidth={1.75} />
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
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

      <Dialog
        open={dialogOpen}
        onClose={cancelDownload}
        title="Speech model needed"
        footer={
          <>
            <button
              type="button"
              onClick={cancelDownload}
              className="inline-flex h-10 items-center justify-center rounded-[10px] border border-ui-border px-4 text-[15px] font-medium text-ui-heading hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void downloadThenConnect()}
              disabled={phase === 'downloading'}
              className="inline-flex h-10 items-center justify-center rounded-[10px] bg-ui-primary px-4 text-[15px] font-semibold text-ui-on-primary hover:bg-ui-primary-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] disabled:opacity-70"
            >
              {phase === 'downloading' ? 'Downloading…' : 'Download and connect'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[15px] text-ui-text">
            One-time download, about {mb(speechModelBytes(globalThis.location.origin))}. It stays on
            this computer for every call.
          </p>
          {phase === 'downloading' && (
            <div className="flex flex-col gap-1.5">
              <ProgressBar value={progress?.fraction ?? 0} label="Speech model download" />
              <p className="text-[13px] tabular-nums text-ui-muted">
                {progress
                  ? `${mb(progress.loadedBytes)} of ${mb(progress.totalBytes)} · ${Math.round(progress.fraction * 100)}%`
                  : 'Starting…'}
              </p>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
