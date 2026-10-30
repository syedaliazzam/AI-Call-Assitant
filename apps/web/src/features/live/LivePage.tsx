/**
 * File: apps/web/src/features/live/LivePage.tsx
 * Purpose: The live session screen flow: the Connect view first (instructions, model download,
 *          meters, sound check), then the live view (meters, the transcript strip, End). It owns
 *          the speech-to-text engine, the call capture and the in-memory transcript, all through
 *          core/ (it never calls media APIs itself).
 * Used by: src/features/live/LiveSession.tsx (which loads the session first)
 * Depends on: src/core/stt/sttEngine.ts, src/core/stt/health.ts, src/core/audio/capture.ts,
 *             src/core/transcript (transcript, saver), src/core/storage (sessions, utterances),
 *             src/platform (kind, for the instructions only),
 *             src/features/live/* (ConnectPanel, TranscriptStrip, AudioMeter)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect, Live session), §6.1,
 *               §7.4 (save-transcript toggle); day-03-sessions.md Stage 4
 *
 * The session's hotwords are given to the engine when it is created, as the page opens: before
 * Connect, and without the ~2 s recognizer rebuild a later setHotwords() would cost. With "save
 * transcript" on, final lines are saved as they arrive (core/transcript/saver.ts; never echo
 * lines); with it off, they stay in memory and are discarded at End. Transcript text is never
 * logged.
 */
'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CallCaptureError,
  startCallCapture,
  type CallCapture,
  type ChannelLevels,
} from '@/core/audio/capture';
import { markSessionActive, updateSession } from '@/core/storage/sessions';
import type { Session, StoredUtterance } from '@/core/storage/types';
import { listUtterances } from '@/core/storage/utterances';
import { SttHealthMonitor, type SttHealthStatus } from '@/core/stt/health';
import { createSttEngine, type SttEngine } from '@/core/stt/sttEngine';
import { startTranscriptSaver, type TranscriptSaver } from '@/core/transcript/saver';
import { createTranscript, type Speaker } from '@/core/transcript/transcript';
import { SESSION_TYPE_LABELS } from '@/features/session-setup/labels';
import { getPlatform, type OtherSideSource } from '@/platform';
import { Button } from '@/ui/Button';
import { AudioMeter } from './AudioMeter';
import {
  ConnectPanel,
  type CallInfo,
  type ConnectionState,
  type ModelState,
  type SoundCheck,
} from './ConnectPanel';
import { SavedTranscript } from './SavedTranscript';
import { TranscriptStrip } from './TranscriptStrip';

/**
 * How often a running call refreshes the session's lastActiveAt, in ms. Well under the 12-hour
 * limit after which the dashboard shows a "live" session as ended (core/storage/sessions.ts).
 */
const ACTIVE_REFRESH_MS = 60_000;

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
  /** The session, loaded from this computer by LiveSession. */
  session: Session;
  /**
   * The session's hotwords in the engine's text format ("PHRASE :score" per line; '' = none),
   * from buildHotwords() in core/stt/sessionHotwords.ts.
   */
  hotwords: string;
  /** How many hotwords that is (shown as "Listening for N key terms"). */
  hotwordCount: number;
  /** Transcript lines saved by earlier calls of this session (oldest first). */
  savedLines: readonly StoredUtterance[];
}

/**
 * No-op subscription for useSyncExternalStore: the platform kind never changes while the page
 * is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
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
 * The live session screen: the Connect view first, then the live transcript of both channels.
 * It owns the speech-to-text engine and the call capture for the session.
 *
 * @param props See LivePageProps.
 * @returns The Connect view or the live view.
 * Rendered by: app/(app)/live/[id]/page.tsx
 */
export function LivePage({ session, hotwords, hotwordCount, savedLines }: LivePageProps) {
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

  // Saved lines shown in the Connect view; refreshed after a call that saved its transcript.
  const [saved, setSaved] = useState<readonly StoredUtterance[]>(savedLines);
  const [saveFailed, setSaveFailed] = useState(false);

  const engineRef = useRef<SttEngine | null>(null);
  const captureRef = useRef<CallCapture | null>(null);
  const saverRef = useRef<TranscriptSaver | null>(null);
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
      hotwords,
      onProgress: (progress) => {
        if (active) setModel((current) => ({ ...current, progress }));
      },
      onPartial: ({ channel, text, tStart }) => {
        if (!active) return;
        transcript.addPartial(channel, text, tStart);
        noteHeard(channel, text);
      },
      onFinal: ({ channel, text, tStart, tEnd }) => {
        if (!active) return;
        transcript.addFinal({ speaker: channel, text, tStart, tEnd });
        noteHeard(channel, text);
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
      saverRef.current?.stop();
      saverRef.current = null;
      captureRef.current?.stop();
      captureRef.current = null;
      engine.stop();
      engineRef.current = null;
    };
  }, [modelAttempt, transcript, noteHeard, hotwords]);

  // While connected: keep the session's lastActiveAt fresh, so the dashboard shows it as live
  // (and as ended once a crash or a closed window stops the refreshes for 12 hours).
  useEffect(() => {
    if (connection !== 'connected') return;
    const timer = setInterval(() => {
      markSessionActive(session.id).catch(() => undefined);
    }, ACTIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [connection, session.id]);

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
      // The status and activity time are bookkeeping: a failure must not stop the call.
      markSessionActive(session.id).catch(() => undefined);
      // "Save transcript" on: save final lines as they arrive (one saver per call; a
      // reconnect keeps the running one).
      if (session.saveTranscript && !saverRef.current) {
        saverRef.current = startTranscriptSaver(transcript, session.id, {
          onError: () => setSaveFailed(true),
        });
      }
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

  /**
   * Ends the call: stops both channels, finishes saving (when on), marks the session ended,
   * clears the in-memory transcript (with saving off, this discards it, architecture §7.4), and
   * goes back to the Connect view.
   */
  const end = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    checkRef.current = null;
    const saver = saverRef.current;
    saverRef.current = null;
    saver?.stop();
    transcript.clear();
    setConnection('idle');
    setLevels({ you: 0, them: 0 });
    setSoundCheck(null);
    setChannelErrors({});
    setView('connect');
    updateSession(session.id, { status: 'ended' }).catch(() => undefined);
    if (saver) {
      // Show the lines just saved under "Saved transcript" once the last writes are done.
      void saver
        .flush()
        .then(() => listUtterances(session.id))
        .then(setSaved)
        .catch(() => undefined);
    }
  };

  const echoStats = transcript.echoStats();
  const echoNoteVisible = echoStats.lastAt !== null && now - echoStats.lastAt < ECHO_NOTE_MS;

  const call: CallInfo = {
    title: `${SESSION_TYPE_LABELS[session.type]} call`,
    company: session.company,
    role: session.role,
  };

  if (view === 'connect') {
    return (
      <>
        <ConnectPanel
          call={call}
          hotwordCount={hotwordCount}
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
        <SavedTranscript lines={saved} saving={session.saveTranscript} />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col gap-4 px-8 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{call.title}</p>
          <h1 className="text-xl font-semibold text-slate-900">{call.company}</h1>
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

      {saveFailed && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Some transcript lines could not be saved on this computer (is the disk full?). The call
          continues; Kite keeps trying.
        </p>
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
