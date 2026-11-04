/**
 * File: apps/web/src/features/live/ConnectPanel.tsx
 * Purpose: The "Connect call session" card, the first view of /live/[id] (spec S11): the audio source
 *          and the microphone, the speech model's state, level bars for You and Them with any capture
 *          error and the inline sound check, a list of tips, and Back with Connect (then Go live).
 *          Display only: LivePage owns the engine and the capture and passes their state in.
 * Used by: src/features/live/LivePage.tsx
 * Depends on: lucide-react, src/platform (listMicrophones), src/ui (Button, Dialog, LinkButton,
 *             ProgressBar, Select, Tooltip), src/features/live (AudioMeter, ConnectGuide, HealthNotice,
 *             speakers)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S11); docs/architecture/kite-architecture-v3.1.md
 *               §4, §5 (Connect)
 */
'use client';

import { ArrowLeft, Headphones, PlayCircle, Plug, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { ChannelLevels } from '@/core/audio/capture';
import type { DownloadProgress } from '@/core/stt/download';
import type { SttHealthStatus } from '@/core/stt/health';
import type { Speaker } from '@/core/transcript/transcript';
import { getPlatform, type MicDevice } from '@/platform';
import { Button } from '@/ui/Button';
import { SOON_TOOLTIP } from '@/ui/Chip';
import { Dialog } from '@/ui/Dialog';
import { LinkButton } from '@/ui/LinkButton';
import { ProgressBar } from '@/ui/ProgressBar';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { AudioMeter } from './AudioMeter';
import { ConnectGuide } from './ConnectGuide';
import { HealthNotice } from './HealthNotice';
import { SPEAKER_STYLE } from './speakers';

/** The call's details shown at the top of the Connect view. */
export interface CallInfo {
  /** Small heading above the company, for example "Interview call". */
  title: string;
  /** Company the call is with. */
  company: string;
  /** Role (interview) or topic. */
  role: string;
  /** One sentence saying what this session is, for example "This is an Interview session…". */
  summary: string;
}

/** State of the speech model, as LivePage sees it. */
export interface ModelState {
  /** 'loading' while downloading or starting; 'ready'; 'error' when loading failed. */
  status: 'loading' | 'ready' | 'error';
  /** Download progress (null before the first report). */
  progress: DownloadProgress | null;
  /** The failure message when status is 'error'. */
  error: string | null;
}

/** Where the connection is. */
export type ConnectionState = 'idle' | 'connecting' | 'connected';

/** The 5-second sound check. */
export interface SoundCheck {
  /** Seconds left (0 = finished). */
  secondsLeft: number;
  /** The latest text heard on each channel during the check ('' = nothing yet). */
  heard: Record<Speaker, string>;
}

/** Props for ConnectPanel. */
export interface ConnectPanelProps {
  /** The call's details. */
  call: CallInfo;
  /**
   * How many key terms (hotwords) speech-to-text listens for in this session: the session's key
   * terms, company, role and names found in its documents.
   */
  hotwordCount: number;
  /** Which platform the page runs on (decides the audio source's words and the instructions). */
  platform: 'desktop' | 'browser';
  /** The speech model. */
  model: ModelState;
  /** Connection progress. */
  connection: ConnectionState;
  /** Meter levels. */
  levels: ChannelLevels;
  /** A message per channel that failed or stopped (shown under its meter). */
  channelErrors: Partial<Record<Speaker, string>>;
  /** The sound check, once connected. */
  soundCheck: SoundCheck | null;
  /** Speech-to-text health. */
  health: SttHealthStatus;
  /** The chosen microphone's id ('' = the system's default). */
  micDeviceId?: string;
  /** Chooses a microphone. */
  onMic?: (deviceId: string) => void;
  /** "Connect" / "Try again": opens both channels (must run from the click: browsers require it). */
  onConnect: () => void;
  /** Retries loading the speech model. */
  onRetryModel: () => void;
  /** "Go live": switches to the transcript view. */
  onContinue: () => void;
}

/** A public search for practice interviews, for trying the app without a real call. */
const MOCK_VIDEO_URL = 'https://www.youtube.com/results?search_query=mock+job+interview';

/** The tips' icons. */
const TIP_ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** The look of the link at the end of a tip. */
const TIP_LINK =
  'shrink-0 rounded-[4px] text-[14px] font-medium text-ui-heading underline underline-offset-4 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

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
 * One tip: an icon, the words and a link at the end.
 *
 * @param props.icon     The icon.
 * @param props.children The words.
 * @param props.action   The link.
 * @returns The row.
 * Rendered by: ConnectPanel
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
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="shrink-0 text-ui-muted">{icon}</span>
      <span className="min-w-0 flex-1 text-[14px] text-ui-text">{children}</span>
      {action}
    </li>
  );
}

/**
 * The Connect card.
 *
 * @param props See ConnectPanelProps.
 * @returns The card.
 * Rendered by: LivePage.tsx (until the call is connected)
 */
export function ConnectPanel({
  call,
  hotwordCount,
  platform,
  model,
  connection,
  levels,
  channelErrors,
  soundCheck,
  health,
  micDeviceId = '',
  onMic,
  onConnect,
  onRetryModel,
  onContinue,
}: ConnectPanelProps) {
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [why, setWhy] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const progress = model.progress;
  const downloading = model.status === 'loading' && progress !== null && progress.fraction < 1;
  const anyError = channelErrors.you !== undefined || channelErrors.them !== undefined;
  const connected = connection === 'connected';

  // Devices get their names once the microphone is allowed, so this asks again after connecting.
  useEffect(() => {
    let active = true;
    getPlatform()
      .listMicrophones()
      .then((found) => {
        if (active) setMics(found);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [connection]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-modal-title text-ui-heading">Connect call session</h1>
        <p className="text-modal-subtitle text-ui-muted">
          Ready when you are. Connect to start the transcript.
        </p>
      </header>
      <p className="text-center text-helper text-ui-muted">{call.summary}</p>

      <section className="flex flex-col gap-3" aria-label="Audio">
        <div className="flex items-center justify-between gap-4">
          <span className="text-label text-ui-heading">Audio source</span>
          <div className="w-56">
            <Select
              label="Audio source"
              hideLabel
              align="end"
              options={[
                platform === 'desktop'
                  ? { value: 'system', label: 'System audio' }
                  : { value: 'system', label: 'A shared tab' },
              ]}
              value="system"
              onChange={() => undefined}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-label text-ui-heading">Microphone</span>
          <div className="w-56">
            <Select
              label="Microphone"
              hideLabel
              align="end"
              options={[
                { value: '', label: 'System default' },
                ...mics
                  .filter((mic) => mic.id !== 'default')
                  .map((mic) => ({ value: mic.id, label: mic.label })),
              ]}
              value={micDeviceId}
              onChange={(deviceId) => onMic?.(deviceId)}
            />
          </div>
        </div>

        <div aria-live="polite">
          {model.status === 'error' ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-control bg-ui-danger-bg px-3 py-2 text-helper text-ui-danger"
            >
              <span>{model.error}</span>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                onClick={onRetryModel}
              >
                Try again
              </Button>
            </div>
          ) : downloading ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-helper text-ui-muted tabular-nums">
                Downloading the speech model (one time only): {mb(progress.loadedBytes)} of{' '}
                {mb(progress.totalBytes)} · {Math.round(progress.fraction * 100)}%
              </p>
              <ProgressBar value={progress.fraction} label="Speech model download" />
            </div>
          ) : model.status === 'loading' ? (
            <p className="text-helper text-ui-muted">Starting the speech model…</p>
          ) : (
            <p className="text-helper text-ui-success">Speech model ready</p>
          )}
        </div>

        {(['you', 'them'] as const).map((speaker) => (
          <div key={speaker} className="flex flex-col gap-1">
            <AudioMeter
              speaker={speaker}
              level={levels[speaker]}
              inactive={!connected || channelErrors[speaker] !== undefined}
            />
            {channelErrors[speaker] && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-control bg-ui-danger-bg px-3 py-2 text-helper text-ui-danger"
              >
                <span>{channelErrors[speaker]}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap"
                  onClick={onConnect}
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        ))}

        {soundCheck && (
          <div className="rounded-control bg-ui-panel p-3 text-helper">
            <p className="font-medium text-ui-heading">
              {soundCheck.secondsLeft > 0
                ? `Sound check: ${soundCheck.secondsLeft} s. Say a few words, and let the other side (or any video) play.`
                : 'Sound check done.'}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {(['you', 'them'] as const).map((speaker) => {
                const heard = soundCheck.heard[speaker];
                const style = SPEAKER_STYLE[speaker];
                return (
                  <li key={speaker} className="flex gap-3">
                    <span className={`w-12 shrink-0 font-semibold ${style.label}`}>
                      {style.name}
                    </span>
                    {heard ? (
                      <span className="text-ui-text">“{heard}”</span>
                    ) : (
                      <span className="text-ui-muted">
                        {soundCheck.secondsLeft > 0
                          ? 'Nothing heard yet…'
                          : speaker === 'you'
                            ? 'Nothing heard. Check your microphone, then try again.'
                            : platform === 'desktop'
                              ? 'Nothing heard. Make sure the call or a video is playing.'
                              : 'Nothing heard. Make sure the meeting tab is playing sound.'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <HealthNotice status={health} />
      </section>

      <ul
        aria-label="Tips"
        className="flex flex-col divide-y divide-ui-border rounded-card border border-ui-border"
      >
        <Tip
          icon={<Headphones {...TIP_ICON} />}
          action={
            <button
              type="button"
              aria-expanded={why}
              onClick={() => setWhy(!why)}
              className={TIP_LINK}
            >
              Why
            </button>
          }
        >
          Use headphones so your mic doesn’t pick up the other side.
          {/* Speakers leak the other person's voice into the microphone, where it would be
              transcribed a second time as "You" (measured on Day 2). */}
          {why && (
            <span className="mt-1 block text-helper text-ui-muted">
              Sound from your speakers can reach the microphone and show up as You.
            </span>
          )}
        </Tip>
        <Tip
          icon={<ShieldCheck {...TIP_ICON} />}
          action={
            <a href="/help" target="_blank" rel="noreferrer" className={TIP_LINK}>
              How
            </a>
          }
        >
          Test Private with your phone before a real call.
        </Tip>
        <Tip
          icon={<PlayCircle {...TIP_ICON} />}
          action={
            <a href={MOCK_VIDEO_URL} target="_blank" rel="noreferrer" className={TIP_LINK}>
              Open
            </a>
          }
        >
          No call to practise on? Play a mock interview on YouTube.
        </Tip>
      </ul>

      <p className="text-center text-helper text-ui-muted">
        {hotwordCount > 0
          ? `Listening for ${hotwordCount} key term${hotwordCount === 1 ? '' : 's'} (names and terms from this session).`
          : 'No key terms for this session. Add names to listen for under Edit → Key terms.'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <LinkButton href="/" variant="secondary" size="lg">
          Back
        </LinkButton>
        {connected ? (
          <Button size="lg" onClick={onContinue}>
            Go live
          </Button>
        ) : (
          <Button size="lg" onClick={onConnect} disabled={connection === 'connecting'}>
            <Plug aria-hidden="true" size={16} />
            {connection === 'connecting' ? 'Connecting…' : anyError ? 'Try again' : 'Connect'}
          </Button>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 text-helper text-ui-muted">
        <button
          type="button"
          onClick={() => setHowTo(true)}
          className="rounded-[4px] underline underline-offset-4 hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          Ways of calling
        </button>
        <Tooltip content={SOON_TOOLTIP}>
          <span tabIndex={0}>Need it for macOS?</span>
        </Tooltip>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-control hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          Back to dashboard
        </Link>
      </div>

      <Dialog open={howTo} onClose={() => setHowTo(false)} title="Ways of calling" size="lg">
        <ConnectGuide platform={platform} />
      </Dialog>
    </div>
  );
}
