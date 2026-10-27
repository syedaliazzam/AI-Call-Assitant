/**
 * File: apps/web/src/features/live/LivePage.tsx
 * Purpose: The live session screen flow: the Connect view first (instructions, model download,
 *          meters, sound check), then the live view (meters, the transcript strip, End). It owns
 *          the speech-to-text engine, the call capture and the in-memory transcript, all through
 *          core/ (it never calls media APIs itself).
 * Used by: app/(app)/live/[id]/page.tsx
 * Depends on: src/core/stt/sttEngine.ts, src/core/stt/health.ts, src/core/audio/capture.ts,
 *             src/core/transcript/transcript.ts, src/platform (kind, for the instructions only),
 *             src/features/live/* (ConnectPanel, TranscriptStrip, AudioMeter, demoHotwords)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session), §6.1
 *
 * Day 2: only the demo session exists (demoHotwords.ts). Day 3 loads the session (details,
 * documents, hotwords) from IndexedDB and saves final lines when "save transcript" is on.
 * Transcript text stays in this page's memory; it is never logged.
 */
'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CallCaptureError,
  startCallCapture,
  type CallCapture,
  type ChannelLevels,
} from '@/core/audio/capture';
import { SttHealthMonitor, type SttHealthStatus } from '@/core/stt/health';
import { createSttEngine, type SttEngine } from '@/core/stt/sttEngine';
import { createTranscript, type Speaker } from '@/core/transcript/transcript';
import { getPlatform, type OtherSideSource } from '@/platform';
import { Button } from '@/ui/Button';
import { AudioMeter } from './AudioMeter';
import {
  ConnectPanel,
  type ConnectionState,
  type ModelState,
  type SoundCheck,
} from './ConnectPanel';
import { DEMO_CALL, DEMO_HOTWORDS } from './demoHotwords';
import { TranscriptStrip } from './TranscriptStrip';

/** How long the echo note stays after the latest hidden echo line, in ms. */
const ECHO_NOTE_MS = 60_000;

/** Length of the sound check, in seconds. */
const SOUND_CHECK_SECONDS = 5;

/** How "Them" is described in the live view header. */
const THEM_SOURCE_LABEL: Record<OtherSideSource, string> = {
  'system-loopback': "your computer's sound",
  'tab-audio': 'the shared tab',
  'screen-audio': 'the shared screen',
};

/** Props for LivePage. */
export interface LivePageProps {
  /** The session id from the URL (Day 2: always 'demo'). */
  sessionId: string;
}

/** No-op subscription: the platform kind never changes while the page is open. */
const subscribeNever = () => () => {};

/**
 * A message for a model that failed to load, from the engine's error code.
 *
 * @param error What engine.ready rejected with.
 * @returns Text for the user.
 */
function modelErrorMessage(error: unknown): string {
  const code = (error as { code?: string }).code;
  switch (code) {
    case 'download-network':
      return 'Kite couldn’t download the speech model. Check your internet connection, then try again.';
    case 'download-checksum':
      return 'The speech model download was damaged or changed. Try again.';
    case 'download-quota':
      return error instanceof Error ? error.message : 'Not enough disk space for the speech model.';
    case 'download-aborted':
      return 'The speech model download was stopped. Try again.';
    default:
      return 'The speech engine failed to start. Reload the page and try again.';
  }
}

/**
 * The message shown when a channel stops during a call.
 *
 * @param speaker  Which channel ended.
 * @param platform Desktop app or browser.
 * @returns Text for the user.
 */
function channelEndedMessage(speaker: Speaker, platform: 'desktop' | 'browser'): string {
  if (speaker === 'you')
    return 'The microphone stopped (unplugged or taken by another app). Reconnect to continue.';
  return platform === 'browser'
    ? 'Sharing stopped, so Kite can’t hear the meeting. Reconnect and share the meeting tab again.'
    : 'Kite stopped hearing your computer’s sound. Reconnect to continue.';
}

/**
 * The live session screen.
 *
 * @param props See LivePageProps.
 * @returns The Connect view or the live view.
 */
export function LivePage({ sessionId }: LivePageProps) {
  // Display only (instructions and messages); behaviour differences live in src/platform.
  // The server snapshot is 'browser'; the desktop app switches after hydration.
  const platform = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().kind,
    () => 'browser' as const,
  );
  const [transcript] = useState(() => createTranscript());
  // What the strip shows: "You" lines that arrive while "Them" speaks are held back briefly, so
  // an echo does not flash up before it is recognised (transcript.ts). Answers (Day 4) use
  // transcript.lines()/window(), which are never held.
  const lines = useSyncExternalStore(
    transcript.subscribe,
    transcript.displayLines,
    transcript.displayLines,
  );

  const [view, setView] = useState<'connect' | 'live'>('connect');
  const [model, setModel] = useState<ModelState>({
    status: 'loading',
    progress: null,
    error: null,
  });
  const [modelAttempt, setModelAttempt] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [levels, setLevels] = useState<ChannelLevels>({ you: 0, them: 0 });
  const [channelErrors, setChannelErrors] = useState<Partial<Record<Speaker, string>>>({});
  const [themSource, setThemSource] = useState<OtherSideSource | null>(null);
  const [soundCheck, setSoundCheck] = useState<SoundCheck | null>(null);
  const [health, setHealth] = useState<SttHealthStatus>('ok');
  // Unix ms, refreshed once a second while connected (for the echo note; render must stay pure).
  const [now, setNow] = useState(0);

  const engineRef = useRef<SttEngine | null>(null);
  const captureRef = useRef<CallCapture | null>(null);
  const monitor = useRef(new SttHealthMonitor());
  /** The running sound check: when it ends and what each channel said so far. */
  const checkRef = useRef<{ endsAt: number; heard: Record<Speaker, string> } | null>(null);

  /** Records text for the sound check while it runs. */
  const noteHeard = useCallback((speaker: Speaker, text: string) => {
    const check = checkRef.current;
    if (!check || !text || performance.now() > check.endsAt) return;
    check.heard = { ...check.heard, [speaker]: text };
    setSoundCheck((current) => (current ? { ...current, heard: check.heard } : current));
  }, []);

  // The engine: created when the page opens (so the model downloads while the user reads the
  // instructions), re-created on "Try again", stopped when the page closes.
  useEffect(() => {
    monitor.current.reset();
    // False once this engine is replaced or the page closes: React mounts effects twice in
    // development, and a stopped engine's late messages (or its 'aborted' rejection) must not
    // reach the screen.
    let active = true;
    const engine = createSttEngine({
      hotwords: DEMO_HOTWORDS,
      onProgress: (progress) => {
        if (active) setModel((current) => ({ ...current, progress }));
      },
      onPartial: ({ channel, text, tStart }) => {
        if (!active) return;
        transcript.addPartial(channel, text, tStart);
        noteHeard(channel, text);
      },
      onFinal: ({ channel, text, tStart, tEnd, segmentId }) => {
        if (!active) return;
        transcript.addFinal({ speaker: channel, text, tStart, tEnd, segmentId });
        noteHeard(channel, text);
      },
      // Second pass (off until ADR-0020 adopts one): the line's text is replaced in place.
      onRefined: ({ segmentId, text, status }) => {
        if (active && status === 'refined') transcript.refine(segmentId, text);
      },
      onStats: (stats) => {
        if (active) monitor.current.push(stats, performance.now());
      },
    });
    engineRef.current = engine;
    engine.ready.then(
      () => {
        if (active) setModel((current) => ({ ...current, status: 'ready', error: null }));
      },
      (error: unknown) => {
        if (active) setModel({ status: 'error', progress: null, error: modelErrorMessage(error) });
      },
    );
    return () => {
      active = false;
      captureRef.current?.stop();
      captureRef.current = null;
      engine.stop();
      engineRef.current = null;
    };
  }, [modelAttempt, transcript, noteHeard]);

  // Health and the sound-check countdown, once a second while connected.
  useEffect(() => {
    if (connection !== 'connected') return;
    const timer = setInterval(() => {
      setHealth(monitor.current.status(performance.now()));
      setNow(Date.now());
      const check = checkRef.current;
      if (check) {
        const left = Math.max(0, Math.ceil((check.endsAt - performance.now()) / 1000));
        setSoundCheck({ secondsLeft: left, heard: check.heard });
        if (left === 0) checkRef.current = null;
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [connection]);

  /** Retries loading the speech model. */
  const retryModel = () => {
    setModel({ status: 'loading', progress: null, error: null });
    setConnection('idle');
    setModelAttempt((attempt) => attempt + 1);
  };

  /**
   * Opens both channels (stopping any earlier capture first). Runs straight from the click:
   * startCallCapture asks for the other side before anything else, while the click still counts
   * as a user gesture.
   */
  const connect = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    captureRef.current?.stop();
    captureRef.current = null;
    setChannelErrors({});
    setConnection('connecting');
    try {
      const capture = await startCallCapture({
        engine,
        onLevels: setLevels,
        onEvent: (event) =>
          setChannelErrors((current) => ({
            ...current,
            [event.channel]: channelEndedMessage(event.channel, platform),
          })),
      });
      captureRef.current = capture;
      setThemSource(capture.themSource);
      setConnection('connected');
      // Start the sound check.
      checkRef.current = {
        endsAt: performance.now() + SOUND_CHECK_SECONDS * 1000,
        heard: { you: '', them: '' },
      };
      setSoundCheck({ secondsLeft: SOUND_CHECK_SECONDS, heard: { you: '', them: '' } });
    } catch (error) {
      setConnection('idle');
      setLevels({ you: 0, them: 0 });
      if (error instanceof CallCaptureError) {
        setChannelErrors({ [error.channel]: error.message });
      } else if (model.status !== 'error') {
        setChannelErrors({ them: 'Kite could not connect. Try again.' });
      }
    }
  };

  /** Ends the call: stops both channels and goes back to the Connect view. */
  const end = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    checkRef.current = null;
    setConnection('idle');
    setLevels({ you: 0, them: 0 });
    setSoundCheck(null);
    setChannelErrors({});
    setView('connect');
  };

  const echoStats = transcript.echoStats();
  const echoNoteVisible = echoStats.lastAt !== null && now - echoStats.lastAt < ECHO_NOTE_MS;

  if (view === 'connect') {
    return (
      <ConnectPanel
        call={DEMO_CALL}
        platform={platform}
        model={model}
        connection={connection}
        levels={levels}
        channelErrors={channelErrors}
        soundCheck={soundCheck}
        health={health}
        onConnect={() => void connect()}
        onRetryModel={retryModel}
        onContinue={() => setView('live')}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col gap-4 px-8 py-6" data-session={sessionId}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {DEMO_CALL.title}
          </p>
          <h1 className="text-xl font-semibold text-slate-900">{DEMO_CALL.company}</h1>
          {themSource && (
            <p className="text-xs text-slate-500">Them = {THEM_SOURCE_LABEL[themSource]}</p>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1">
            {(['you', 'them'] as const).map((speaker) => (
              <AudioMeter
                key={speaker}
                speaker={speaker}
                level={levels[speaker]}
                inactive={connection !== 'connected' || channelErrors[speaker] !== undefined}
                compact
              />
            ))}
          </div>
          <Button variant="danger" onClick={end}>
            End
          </Button>
        </div>
      </header>

      {(['you', 'them'] as const).map(
        (speaker) =>
          channelErrors[speaker] && (
            <div
              key={speaker}
              role="alert"
              className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <span>{channelErrors[speaker]}</span>
              <Button size="sm" variant="secondary" onClick={() => void connect()}>
                Reconnect
              </Button>
            </div>
          ),
      )}

      {/* Echo lines (the other side's voice from the speakers, picked up by the microphone) are
          hidden from the transcript (core/transcript/echo.ts); say so while it is happening. */}
      {echoNoteVisible && (
        <p role="status" className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Hiding echo from your speakers ({echoStats.count}{' '}
          {echoStats.count === 1 ? 'line' : 'lines'} so far). Headphones work best.
        </p>
      )}

      <TranscriptStrip lines={lines} health={health} />
    </div>
  );
}
