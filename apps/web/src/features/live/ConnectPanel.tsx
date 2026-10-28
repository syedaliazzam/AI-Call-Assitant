/**
 * File: apps/web/src/features/live/ConnectPanel.tsx
 * Purpose: The Connect view (first view of /live/[id]): the call's details, how to connect on
 *          this platform, the speech-model download progress, a "Connect" button, live audio
 *          meters for You and Them with any capture error (and a retry button) next to the right
 *          meter, a 5-second sound check that shows what each channel heard, the headphones tip
 *          and the speech-to-text health notice. Display only: LivePage owns the engine and the
 *          capture and passes their state in.
 * Used by: src/features/live/LivePage.tsx
 * Depends on: src/ui/Button.tsx, src/ui/ProgressBar.tsx, src/features/live/AudioMeter.tsx,
 *             src/features/live/HealthNotice.tsx, src/features/live/speakers.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (desktop vs browser), §5 (Connect)
 */
'use client';

import type { ChannelLevels } from '@/core/audio/capture';
import type { SttHealthStatus } from '@/core/stt/health';
import type { DownloadProgress } from '@/core/stt/download';
import type { Speaker } from '@/core/transcript/transcript';
import { Button } from '@/ui/Button';
import { ProgressBar } from '@/ui/ProgressBar';
import { AudioMeter } from './AudioMeter';
import type { DemoCall } from './demoHotwords';
import { HealthNotice } from './HealthNotice';
import { SPEAKER_STYLE } from './speakers';

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
  call: DemoCall;
  /** Which platform the page runs on (decides the instructions only). */
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
  /** "Connect" / "Try again": opens both channels (must run from the click: browsers require it). */
  onConnect: () => void;
  /** Retries loading the speech model. */
  onRetryModel: () => void;
  /** "Go live": switches to the transcript view. */
  onContinue: () => void;
}

/** Meeting apps named in the desktop instructions. */
const DESKTOP_APPS = 'Zoom, Microsoft Teams, Google Meet, Webex or a phone app';

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
 * How to connect, for the platform the page runs on.
 *
 * @param props.platform Desktop app or browser.
 * @returns The instructions.
 */
function HowToConnect({ platform }: { platform: 'desktop' | 'browser' }) {
  if (platform === 'desktop') {
    return (
      <div className="text-sm text-slate-700">
        <p className="font-medium text-slate-900">
          Kite hears your microphone and your computer&apos;s sound. Join your call in any app.
        </p>
        <p className="mt-1 text-slate-500">
          Works with {DESKTOP_APPS}. Start or join the call, then click Connect.
        </p>
      </div>
    );
  }
  return (
    <div className="text-sm text-slate-700">
      <p className="font-medium text-slate-900">Share your meeting tab with its sound:</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Open your meeting in another Chrome or Edge tab (Google Meet, Teams or Zoom on the web).
        </li>
        <li>
          Click <strong>Connect</strong>. In the window that opens, choose the{' '}
          <strong>Chrome Tab</strong> pane and pick the meeting tab.
        </li>
        <li>
          Turn on <strong>Also share tab audio</strong>, then click <strong>Share</strong>.
        </li>
        <li>Allow the microphone when Chrome asks.</li>
      </ol>
      <p className="mt-2 text-xs text-slate-500">
        Chrome or Edge only: Safari and Firefox cannot share a tab&apos;s sound.
      </p>
    </div>
  );
}

/**
 * The Connect view: call details, how to connect on this platform, the speech-model download
 * progress, the Connect button, audio meters with any capture error, and the sound check.
 *
 * @param props See ConnectPanelProps.
 * @returns The panel.
 * Rendered by: LivePage.tsx (until the call is connected)
 */
export function ConnectPanel({
  call,
  platform,
  model,
  connection,
  levels,
  channelErrors,
  soundCheck,
  health,
  onConnect,
  onRetryModel,
  onContinue,
}: ConnectPanelProps) {
  const progress = model.progress;
  const downloading = model.status === 'loading' && progress !== null && progress.fraction < 1;
  const anyError = channelErrors.you !== undefined || channelErrors.them !== undefined;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-10">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{call.title}</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{call.company}</h1>
        <p className="mt-1 text-sm text-slate-500">{call.role}</p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium text-slate-900">How to connect</h2>
        <HowToConnect platform={platform} />
        {/* Speakers leak the other person's voice into the microphone, where it would be
            transcribed a second time as "You" (measured on Day 2). Headphones prevent it. */}
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Use headphones for best results: sound from your speakers can reach the microphone and
          show up as You.
        </p>
      </section>

      <section className="flex flex-col gap-2" aria-live="polite">
        {model.status === 'error' ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <span>{model.error}</span>
            <Button size="sm" variant="secondary" onClick={onRetryModel}>
              Try again
            </Button>
          </div>
        ) : downloading ? (
          <>
            <p className="text-sm text-slate-600 tabular-nums">
              Downloading the speech model (one time only): {mb(progress.loadedBytes)} of{' '}
              {mb(progress.totalBytes)} · {Math.round(progress.fraction * 100)}%
            </p>
            <ProgressBar value={progress.fraction} label="Speech model download" />
          </>
        ) : model.status === 'loading' ? (
          <p className="text-sm text-slate-600">Starting the speech model…</p>
        ) : (
          <p className="text-sm font-medium text-emerald-700">Speech model ready</p>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium text-slate-900">Audio</h2>
          {connection !== 'connected' && (
            <Button onClick={onConnect} disabled={connection === 'connecting'}>
              {connection === 'connecting' ? 'Connecting…' : anyError ? 'Try again' : 'Connect'}
            </Button>
          )}
        </div>

        {(['you', 'them'] as const).map((speaker) => (
          <div key={speaker} className="flex flex-col gap-1">
            <AudioMeter
              speaker={speaker}
              level={levels[speaker]}
              inactive={connection !== 'connected' || channelErrors[speaker] !== undefined}
            />
            {channelErrors[speaker] && (
              <div
                role="alert"
                className="ml-14 flex items-start justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                <span>{channelErrors[speaker]}</span>
                <Button size="sm" variant="secondary" onClick={onConnect}>
                  Try again
                </Button>
              </div>
            )}
          </div>
        ))}

        {soundCheck && (
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-900">
              {soundCheck.secondsLeft > 0
                ? `Sound check: ${soundCheck.secondsLeft} s — say a few words, and let the other side (or any video) play.`
                : 'Sound check done.'}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {(['you', 'them'] as const).map((speaker) => {
                const heard = soundCheck.heard[speaker];
                const style = SPEAKER_STYLE[speaker];
                return (
                  <li key={speaker} className="flex gap-3">
                    <span className={`w-12 shrink-0 font-medium ${style.label}`}>{style.name}</span>
                    {heard ? (
                      <span className="text-slate-700">“{heard}”</span>
                    ) : (
                      <span className="text-slate-400">
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

        {connection === 'connected' && (
          <div className="flex justify-end">
            <Button onClick={onContinue}>Go live</Button>
          </div>
        )}
      </section>
    </div>
  );
}
