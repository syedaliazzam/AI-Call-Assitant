/**
 * File: apps/web/src/features/live/LivePage.tsx
 * Purpose: The live session screen flow: the Connect view first (instructions, model download,
 *          meters, sound check), then the live view (meters, the answer bar and panel, the
 *          transcript strip). It owns
 *          the speech-to-text engine, the call capture and the in-memory transcript, all through
 *          core/ (it never calls media APIs itself).
 * Used by: src/features/live/LiveSession.tsx (which loads the session first)
 * Depends on: src/core/stt/sttEngine.ts, src/core/stt/health.ts, src/core/audio/capture.ts,
 *             src/core/transcript (transcript, saver, endCall), src/core/answer/warm.ts,
 *             src/core/storage (sessions, utterances),
 *             src/platform (kind, for the instructions only),
 *             src/features/live/* (ConnectPanel, TranscriptStrip, AudioMeter, LiveAnswers)
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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  CallCaptureError,
  startCallCapture,
  type CallCapture,
  type ChannelLevels,
} from '@/core/audio/capture';
import { warmSession } from '@/core/answer/warm';
import { markSessionActive, updateSession } from '@/core/storage/sessions';
import type { Session, StoredDocument, StoredUtterance } from '@/core/storage/types';
import { listUtterances } from '@/core/storage/utterances';
import { listAnswers } from '@/core/storage/answers';
import { notesFailureText, type UnavailableReason } from '@/core/answer/unavailable';
import { generateNotes, type NotesLine } from '@/core/notes/generate';
import { SttHealthMonitor, type SttHealthStatus } from '@/core/stt/health';
import { createSttEngine, type SttEngine } from '@/core/stt/sttEngine';
import { TranscriptWatchdog } from '@/core/stt/watchdog';
import { getAccurateTranscription } from '@/core/storage/transcriptionPrefs';
import { refineLine } from '@/core/transcript/refine';
import { displayTerms } from '@/core/transcript/display';
import { isSound, themSilent } from '@/core/audio/silence';
import { ThemSilentNotice } from './ThemSilentNotice';
import { endCall } from '@/core/transcript/endCall';
import { startTranscriptSaver, type TranscriptSaver } from '@/core/transcript/saver';
import { createTranscript, type Speaker } from '@/core/transcript/transcript';
import { SESSION_TYPE_LABELS, sessionSummary } from '@/features/session-setup/labels';
import { getPlatform, type OtherSideSource } from '@/platform';
import { Button } from '@/ui/Button';
import { AudioMeter } from './AudioMeter';
import { LiveAnswers } from './LiveAnswers';
import { LiveCallLayout, type LiveCallStatus } from './LiveCallLayout';
import { BrowserCallLayout } from './BrowserCallLayout';
import { openOverlay } from './openOverlay';
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

/** How long the "Transcription restarted" note stays after a watchdog restart, in ms. */
const RESTART_NOTE_MS = 8_000;

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
  /** The session's documents (for the warm-up on Connect, and for answers). */
  documents: readonly StoredDocument[];
  /** The approved lessons for this session type (Day 5 Stage 7), for warm-ups and answers. */
  lessons: readonly string[];
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
export function LivePage({
  session,
  documents,
  lessons,
  hotwords,
  hotwordCount,
  savedLines,
}: LivePageProps) {
  // The session's own spellings for the transcript (sentence case, Day 6 Stage 4d), kept
  // stable so the memoised transcript strip does not re-render on every update.
  const terms = useMemo(() => displayTerms(session), [session]);
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
  // Day 6 Stage 4e: when "Them" last had sound (or the call connected), and whether it has been
  // silent for 20 s (then a notice suggests checking the shared tab or app).
  // Day 6: the desktop app never asks to restart for an update while a call is connected.
  useEffect(() => {
    const platformApi = getPlatform();
    platformApi.setCallActive(connection === 'connected');
    return () => platformApi.setCallActive(false);
  }, [connection]);
  const themSoundAt = useRef(0);
  const [themQuiet, setThemQuiet] = useState(false);
  useEffect(() => {
    if (connection !== 'connected') return;
    const timer = setInterval(
      () => setThemQuiet(themSilent(themSoundAt.current, Date.now())),
      1_000,
    );
    return () => clearInterval(timer);
  }, [connection]);
  const [channelErrors, setChannelErrors] = useState<Partial<Record<Speaker, string>>>({});
  const [themSource, setThemSource] = useState<OtherSideSource | null>(null);
  // The browser split view (live-ui-split): the shared-tab stream for the preview, the answer
  // language the control strip can change, and a transcript "clear" time (lines before it are
  // hidden, later ones still show).
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [language, setLanguage] = useState(session.preferences.language);
  const [transcriptClearedAt, setTranscriptClearedAt] = useState(0);
  const [soundCheck, setSoundCheck] = useState<SoundCheck | null>(null);
  const [health, setHealth] = useState<SttHealthStatus>('ok');
  // Unix ms, refreshed once a second while connected (for the echo note; render must stay pure).
  const [now, setNow] = useState(0);

  // Saved lines shown in the Connect view; refreshed after a call that saved its transcript.
  const [saved, setSaved] = useState<readonly StoredUtterance[]>(savedLines);
  const [saveFailed, setSaveFailed] = useState(false);
  // True while End waits for the last line (at most about a second); End and Reconnect wait.
  const [ending, setEnding] = useState(false);
  // When this call first connected (Unix ms); a reconnect keeps it. Answers time their lines
  // from here, and a new value starts a new conversation (core/answer/context.ts).
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  // The notes written after the last call (Day 5).
  const [notesStatus, setNotesStatus] = useState<'idle' | 'writing' | 'saved' | 'failed'>('idle');
  // Why the notes failed when Claude was unavailable (usage limit or overload), else null.
  const [notesUnavailable, setNotesUnavailable] = useState<UnavailableReason | null>(null);

  const engineRef = useRef<SttEngine | null>(null);
  const captureRef = useRef<CallCapture | null>(null);
  const saverRef = useRef<TranscriptSaver | null>(null);
  const monitor = useRef(new SttHealthMonitor());
  // Day 6 Stage 4: watches for a stuck engine (audio in, no transcript out) and a flag so a
  // restart cannot overlap with itself. restartedAt drives the "Transcription restarted" note.
  const watchdog = useRef(new TranscriptWatchdog());
  const restartingRef = useRef(false);
  const [restartedAt, setRestartedAt] = useState<number | null>(null);
  /** The running sound check: when it ends and what each channel said so far. */
  const checkRef = useRef<{ endsAt: number; heard: Record<Speaker, string> } | null>(null);

  /** Records text for the sound check while it runs. */
  const noteHeard = useCallback((speaker: Speaker, text: string) => {
    const check = checkRef.current;
    if (!check || !text || performance.now() > check.endsAt) return;
    check.heard = { ...check.heard, [speaker]: text };
    setSoundCheck((current) => (current ? { ...current, heard: check.heard } : current));
  }, []);

  // Builds the speech engine with the standard callbacks. The initial effect and a watchdog
  // restart share this, so a restarted engine behaves exactly like the first one. isActive() lets
  // a replaced or torn-down engine's late messages be ignored (dev double-mount; restart).
  const makeEngine = useCallback(
    (isActive: () => boolean): SttEngine => {
      // Accurate transcription (v1.0.1, ADR-0034): only in a desktop app that has the engine, and
      // only when the user turned it on in Settings. Otherwise no audio leaves the speech worker.
      const accurate = getAccurateTranscription() ? getPlatform().accurate : null;
      return createSttEngine({
        hotwords,
        keepAudio: accurate !== null,
        onProgress: (progress) => {
          if (isActive()) setModel((current) => ({ ...current, progress }));
        },
        onPartial: ({ channel, text, tStart }) => {
          if (!isActive()) return;
          transcript.addPartial(channel, text, tStart);
          noteHeard(channel, text);
          watchdog.current.noteProgress(performance.now());
        },
        onFinal: ({ channel, text, tStart, tEnd, audio }) => {
          if (!isActive()) return;
          const line = transcript.addFinal({ speaker: channel, text, tStart, tEnd });
          noteHeard(channel, text);
          watchdog.current.noteProgress(performance.now());
          // The second pass replaces the words a moment later; the live line is the fallback.
          if (accurate && audio) void refineLine(accurate, transcript, line.id, text, audio);
        },
        onStats: (stats) => {
          if (isActive()) monitor.current.push(stats, performance.now());
        },
      });
    },
    [hotwords, transcript, noteHeard],
  );

  // The engine: created when the page opens (so the model downloads while the user reads the
  // instructions), re-created on "Try again", stopped when the page closes.
  useEffect(() => {
    monitor.current.reset();
    // False once this engine is replaced or the page closes: React mounts effects twice in
    // development, and a stopped engine's late messages (or its 'aborted' rejection) must not
    // reach the screen.
    let active = true;
    const engine = makeEngine(() => active);
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
  }, [modelAttempt, makeEngine]);

  // Day 6 Stage 4: restart a stuck engine (audio arriving, no transcript) without ending the call.
  // A fresh engine is created, the call's existing streams are moved to it (capture.reattach), and
  // the old engine is stopped. The transcript, the session and the call all stay. The log carries
  // timings only, never transcript text, to help find the Connect hang.
  const restartEngine = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture || restartingRef.current) return;
    restartingRef.current = true;
    console.info('stt: transcription restarted', {
      sessionId: session.id,
      msSinceProgress: watchdog.current.msSinceProgress(performance.now()),
    });
    const old = engineRef.current;
    // The guard reads `next` only when a callback fires (after this line), so const is safe.
    const next: SttEngine = makeEngine(() => engineRef.current === next);
    engineRef.current = next;
    setRestartedAt(Date.now());
    try {
      await next.ready;
      await capture.reattach(next);
      monitor.current.reset();
      watchdog.current.start(performance.now());
      old?.stop();
    } catch (error) {
      // The replacement could not load or attach: fall back to a channel-lost message, as a lost
      // capture does. The old engine is already gone, so the call cannot continue silently.
      if (engineRef.current === next) {
        setChannelErrors((current) => ({ ...current, them: modelErrorMessage(error) }));
      }
      old?.stop();
    } finally {
      restartingRef.current = false;
    }
  }, [makeEngine, session.id]);

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
      // Day 6 Stage 4: if speech has been arriving with no transcript for 8 s, restart the engine.
      if (watchdog.current.isStuck(performance.now())) void restartEngine();
      const check = checkRef.current;
      if (check) {
        const left = Math.max(0, Math.ceil((check.endsAt - performance.now()) / 1000));
        setSoundCheck({ secondsLeft: left, heard: check.heard });
        if (left === 0) checkRef.current = null;
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [connection, restartEngine]);

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
        onLevels: (next) => {
          setLevels(next);
          if (isSound(next.them)) themSoundAt.current = Date.now();
          // Speech on either channel is audio the engine should be turning into text; the
          // watchdog uses it to notice a stuck engine (no transcript progress).
          if (isSound(next.you) || isSound(next.them))
            watchdog.current.noteSound(performance.now());
        },
        onEvent: (event) =>
          setChannelErrors((current) => ({
            ...current,
            [event.channel]: channelEndedMessage(event.channel, platform),
          })),
      });
      captureRef.current = capture;
      setThemSource(capture.themSource);
      // The shared-tab video for the browser split-view preview (no video on desktop system audio).
      setPreviewStream(capture.otherSideStream());
      themSoundAt.current = Date.now();
      // Start the stuck-engine watchdog for this connection (Day 6 Stage 4).
      watchdog.current.start(performance.now());
      setConnection('connected');
      setCallStartedAt((current) => current ?? Date.now());
      // Warm Claude's prompt cache again: the warm-up from when the page opened may have
      // expired (5 minutes) while the user read the instructions. If it is still warm this is
      // a cheap cache read. Not awaited; it never throws.
      void warmSession(session, documents, { lessons });
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
   * Ends the call: stops both channels, waits for the line still being spoken to become final
   * and be saved (when on; core/transcript/endCall.ts), clears the in-memory transcript (with
   * saving off, this discards it, architecture §7.4), marks the session ended, goes back to the
   * Connect view, and (Day 5) has the call's notes written in the background.
   */
  const end = async () => {
    if (ending) return;
    setEnding(true);
    checkRef.current = null;
    watchdog.current.stop();
    setRestartedAt(null);
    const saver = saverRef.current;
    saverRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    // The call's final lines, taken just before the transcript is cleared (after the line
    // still being spoken was flushed), for the notes.
    let finalLines: NotesLine[] = [];
    await endCall({
      stopCapture: () => capture?.stop(),
      engine: engineRef.current,
      saver,
      transcript: {
        clear: () => {
          finalLines = transcript
            .lines()
            .filter((line) => line.final)
            .map(({ speaker, text, tStart }) => ({ speaker, text, tStart }));
          transcript.clear();
        },
      },
    });
    const startedAt = callStartedAt;
    setConnection('idle');
    setLevels({ you: 0, them: 0 });
    setSoundCheck(null);
    setChannelErrors({});
    setView('connect');
    setCallStartedAt(null);
    setPreviewStream(null);
    setTranscriptClearedAt(0);
    setEnding(false);
    updateSession(session.id, { status: 'ended' }).catch(() => undefined);
    // The call's notes (Day 5): written after the call by the server, saved here. Not awaited:
    // End never waits for them.
    if (startedAt !== null && finalLines.length > 0) {
      setNotesStatus('writing');
      setNotesUnavailable(null);
      void listAnswers(session.id)
        .catch(() => [])
        .then((answers) =>
          generateNotes({
            session,
            documents,
            lines: finalLines,
            answers,
            callStartedAt: startedAt,
          }),
        )
        .then((outcome) => {
          setNotesStatus(outcome.status === 'saved' ? 'saved' : 'failed');
          setNotesUnavailable(outcome.status === 'failed' ? outcome.unavailable : null);
        });
    }
    // Show the lines just saved under "Saved transcript".
    if (saver) {
      listUtterances(session.id)
        .then(setSaved)
        .catch(() => undefined);
    }
  };

  /**
   * Re-picks the shared tab without ending the call (the control strip's Change tab). Runs straight
   * from the click so the browser allows getDisplayMedia. A cancelled picker keeps the current share.
   */
  const changeTab = async () => {
    const capture = captureRef.current;
    if (!capture) return;
    try {
      setThemSource(await capture.changeOtherSide());
      setPreviewStream(capture.otherSideStream());
      themSoundAt.current = Date.now();
    } catch {
      // The picker was cancelled or denied: the current share stays.
    }
  };

  /**
   * Changes the answer language for the rest of the call (the control strip's picker).
   *
   * @param code A language code from ANSWER_LANGUAGES.
   * @returns Nothing.
   */
  const changeLanguage = (code: string) => {
    setLanguage(code);
    const preferences = { ...session.preferences, language: code };
    updateSession(session.id, { preferences }).catch(() => undefined);
  };

  const echoStats = transcript.echoStats();
  const echoNoteVisible = echoStats.lastAt !== null && now - echoStats.lastAt < ECHO_NOTE_MS;
  // Shown for a few seconds after the watchdog restarted a stuck engine (Day 6 Stage 4).
  const restartNoteVisible = restartedAt !== null && now - restartedAt < RESTART_NOTE_MS;

  const call: CallInfo = {
    title: `${SESSION_TYPE_LABELS[session.type]} call`,
    company: session.company,
    role: session.role,
    summary: sessionSummary(session),
  };

  // The answer language the control strip can change takes effect from the next answer.
  // Memoised: useLiveAnswers treats a new session object as a new call and cancels the answer in
  // flight, and this page re-renders on every transcript line and meter tick. A fresh object here
  // aborted every answer within milliseconds (production check, v1.0.0 release, 3 Nov 2026).
  // Above the Connect view's early return: a hook must run on every render, in the same order.
  const liveSession = useMemo(
    () => ({ ...session, preferences: { ...session.preferences, language } }),
    [session, language],
  );

  if (view === 'connect') {
    return (
      // The Connect view is a call screen too: dark tokens (theme §2).
      <div className="k-dark min-h-screen bg-ui-bg pb-10 text-ui-text">
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
        {notesStatus !== 'idle' && (
          <p role="status" className="mx-auto mt-4 max-w-3xl px-8 text-[13px] text-ui-muted">
            {notesStatus === 'writing'
              ? 'Writing the call notes…'
              : notesStatus === 'saved'
                ? 'The call notes are saved on this computer.'
                : notesFailureText(notesUnavailable, session.saveTranscript)}
          </p>
        )}
        <SavedTranscript lines={saved} saving={session.saveTranscript} terms={terms} />
      </div>
    );
  }

  // The badge in the top bar: a lost channel first, then the connection.
  const lostChannel = channelErrors.you !== undefined || channelErrors.them !== undefined;
  const status: LiveCallStatus = lostChannel
    ? { tone: 'danger', label: 'Channel lost' }
    : connection === 'connected'
      ? { tone: 'success', label: 'Connected' }
      : connection === 'connecting'
        ? { tone: 'warning', label: 'Connecting' }
        : { tone: 'neutral', label: 'Not connected' };

  const themQuietShown = connection === 'connected' && themQuiet && !channelErrors.them;
  // The transcript hides lines from before a "Clear" on the control strip; new lines still show.
  const shownLines =
    transcriptClearedAt > 0 ? lines.filter((line) => line.tStart >= transcriptClearedAt) : lines;
  const meters = (['you', 'them'] as const).map((speaker) => (
    <AudioMeter
      key={speaker}
      speaker={speaker}
      level={levels[speaker]}
      inactive={connection !== 'connected' || channelErrors[speaker] !== undefined}
      compact
    />
  ));
  const transcriptNode = <TranscriptStrip lines={shownLines} health={health} terms={terms} />;
  const answersNode =
    callStartedAt !== null ? (
      <LiveAnswers
        session={liveSession}
        documents={documents}
        lessons={lessons}
        transcript={transcript}
        callStartedAt={callStartedAt}
        audio={{
          you: connection === 'connected' && !channelErrors.you,
          them: connection === 'connected' && !channelErrors.them,
        }}
        ending={ending}
        onEnd={() => void end()}
      />
    ) : (
      <div className="flex justify-end">
        <Button variant="danger" onClick={() => void end()} disabled={ending}>
          {ending ? 'Ending…' : 'End'}
        </Button>
      </div>
    );
  const notices =
    lostChannel || saveFailed || echoNoteVisible || themQuietShown || restartNoteVisible ? (
      <>
        {restartNoteVisible && (
          <p
            role="status"
            className="rounded-control border border-ui-border bg-ui-surface px-3 py-2 text-[13px] text-ui-muted"
          >
            Transcription restarted.
          </p>
        )}
        {(['you', 'them'] as const).map(
          (speaker) =>
            channelErrors[speaker] && (
              <div
                key={speaker}
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-ui-danger bg-ui-danger-bg px-3 py-2 text-[13px] text-ui-text"
              >
                <span>{channelErrors[speaker]}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void connect()}
                  disabled={ending}
                >
                  Reconnect
                </Button>
              </div>
            ),
        )}
        {themQuietShown && <ThemSilentNotice />}
        {saveFailed && (
          <p
            role="alert"
            className="rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
          >
            Some transcript lines could not be saved on this computer (is the disk full?). The call
            continues; Kite keeps trying.
          </p>
        )}
        {/* Echo lines (the other side's voice from the speakers, picked up by the
                microphone) are hidden from the transcript (core/transcript/echo.ts); say so while
                it is happening. */}
        {echoNoteVisible && (
          <p role="status" className="bg-ui-surface px-3 py-2 text-[13px] text-ui-muted">
            Hiding echo from your speakers ({echoStats.count}{' '}
            {echoStats.count === 1 ? 'line' : 'lines'} so far). Headphones work best.
          </p>
        )}
      </>
    ) : null;

  // In a browser the live view is a split screen: the shared-tab preview and transcript on the
  // left, the answers on the right (live-ui-split). On the desktop the other side is system audio
  // with no tab to show, so it keeps the two-column LiveCallLayout.
  if (platform === 'browser') {
    return (
      <BrowserCallLayout
        title={call.title}
        name={call.company}
        status={status}
        meters={meters}
        callStartedAt={callStartedAt}
        notices={notices}
        preview={{
          stream: previewStream,
          themLabel: themSource ? THEM_SOURCE_LABEL[themSource] : null,
          micOn: connection === 'connected' && !channelErrors.you,
          language,
          onLanguage: changeLanguage,
          onStop: () => void end(),
          onClear: () => setTranscriptClearedAt(Date.now()),
          onMinimize: () => void openOverlay(session.id).catch(() => undefined),
          onChangeTab: () => void changeTab(),
        }}
        transcript={transcriptNode}
        answers={answersNode}
        onExit={() => void end()}
        onOverlay={() => void openOverlay(session.id).catch(() => undefined)}
      />
    );
  }

  return (
    <LiveCallLayout
      title={call.title}
      name={call.company}
      themSource={themSource ? THEM_SOURCE_LABEL[themSource] : null}
      status={status}
      meters={meters}
      notices={notices}
      transcript={transcriptNode}
      answers={answersNode}
    />
  );
}
