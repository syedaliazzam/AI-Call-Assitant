/**
 * File: apps/web/src/features/live/LivePage.tsx
 * Purpose: The live session screen flow: the Connect view first (instructions, model download,
 *          the microphone meter), then, as soon as Connect succeeds, the live view (meters, the
 *          answer bar and panel, the transcript strip; ADR-0053: no second "Go live" step). It owns
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
 * v1.1.0: one call at a time on a device (core/live/callLock.ts); Accurate transcription follows the
 * power source on Auto (ADR-0044); listening pauses when a call was left running (core/live/hygiene.ts).
 *
 * ADR-0055: in a desktop app with the home panel and account sync, the Connect card is in the small
 * window (features/home/LauncherConnect.tsx). This page runs the call it starts (core/live/callStart.ts):
 * it connects without a card of its own, reports how it went, shows only a status
 * (BackgroundCallStatus.tsx), and after End closes its window once the notes are saved.
 *
 * ADR-0053: Connect opens the overlay first (when calls start in it), inside the click, because a
 * browser's picture-in-picture window needs the click and the share picker does not (measured in
 * Chrome 156: the picker still opens after picture-in-picture used the click). Then the capture,
 * then the live view. A capture that fails closes that overlay again and keeps the Connect card.
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
import { clearTranscript, listUtterances } from '@/core/storage/utterances';
import { flushAccountSync } from '@/core/sync/client';
import { listAnswers } from '@/core/storage/answers';
import { notesFailureText, type UnavailableReason } from '@/core/answer/unavailable';
import { generateNotes, type NotesLine } from '@/core/notes/generate';
import { SttHealthMonitor, type SttHealthStatus } from '@/core/stt/health';
import { createSttEngine, type SttEngine } from '@/core/stt/sttEngine';
import { TranscriptWatchdog } from '@/core/stt/watchdog';
import { accurateWanted, getTranscriptionMode } from '@/core/storage/transcriptionPrefs';
import { takeCallLock } from '@/core/live/callLock';
import { hygieneState, type HygieneState } from '@/core/live/hygiene';
import { getMicDevice, setMicDevice } from '@/core/storage/overlayPrefs';
import { createPunctuator, punctuateLine } from '@/core/punctuation/punctuator';
import { refineLine } from '@/core/transcript/refine';
import { displayTerms } from '@/core/transcript/display';
import { isSound, themSilent } from '@/core/audio/silence';
import { ThemSilentNotice } from './ThemSilentNotice';
import { endCall } from '@/core/transcript/endCall';
import { reportCallStart, takeCallStart, watchCallStart } from '@/core/live/callStart';
import { useSyncAccount } from '@/features/sync/SyncScope';
import { useAccountName } from '@/features/shell/AccountName';
import { BackgroundCallStatus, type BackgroundCallState } from './BackgroundCallStatus';
import { startTranscriptSaver, type TranscriptSaver } from '@/core/transcript/saver';
import { createTranscript, type Speaker } from '@/core/transcript/transcript';
import { SESSION_TYPE_LABELS, sessionSummary } from '@/features/session-setup/labels';
import { getPlatform, type OtherSideSource } from '@/platform';
import { Button } from '@/ui/Button';
import { AudioMeter } from './AudioMeter';
import { LiveAnswers, type AnswerThisBridge } from './LiveAnswers';
import { LiveCallLayout, type LiveCallStatus } from './LiveCallLayout';
import { BrowserCallLayout } from './BrowserCallLayout';
import { openOverlay, startsCallsInOverlay, type OverlayAtStart } from './openOverlay';
import { ConnectPanel, type CallInfo, type ConnectionState, type ModelState } from './ConnectPanel';
import { useMicPreview } from './useMicPreview';
import { SavedTranscript } from './SavedTranscript';
import { TranscriptStrip } from './TranscriptStrip';
import { groupWords, type TranscriptGroup } from '@/core/transcript/group';
import { useCallDictation } from './useCallDictation';

/**
 * How often a running call refreshes the session's lastActiveAt, in ms. Well under the 12-hour
 * limit after which the dashboard shows a "live" session as ended (core/storage/sessions.ts).
 */
const ACTIVE_REFRESH_MS = 60_000;

/** How long the echo note stays after the latest hidden echo line, in ms. */
const ECHO_NOTE_MS = 60_000;

/** How long the "Transcription restarted" note stays after a watchdog restart, in ms. */
const RESTART_NOTE_MS = 8_000;

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
      return 'Paramount AI couldn’t download the speech model. Check your internet connection, then try again.';
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
    ? 'Sharing stopped, so Paramount AI can’t hear the meeting. Reconnect and share the meeting tab again.'
    : 'Paramount AI stopped hearing your computer’s sound. Reconnect to continue.';
}

/** Why a second call cannot start (shown on the Connect card, or sent to the desktop's card). */
const LOCKED_OUT_TEXT = 'A call is already running in another Paramount AI window. End it first.';

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
  // v1.1.0: the terms as the user wrote them, for the accurate pass (keyTermFix.ts).
  const plainTerms = useMemo(
    () => terms.filter((term): term is string => typeof term === 'string'),
    [terms],
  );
  // Display only (instructions and messages); behaviour differences live in src/platform.
  // The server snapshot is 'browser'; the desktop app switches after hydration.
  const platform = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().kind,
    () => 'browser' as const,
  );
  // ADR-0055: a desktop app with the home panel and account sync starts calls from its Connect card;
  // this page then runs the call in the background. The server snapshot is false, like the platform's.
  const panelApp = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().hasHomePanel(),
    () => false,
  );
  const synced = useSyncAccount() !== null;
  // v1.3.2: the user's own turns show the account's display name.
  const accountName = useAccountName();
  const launcherCall = platform === 'desktop' && panelApp && synced;
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
  // Item 8 (ADR-0038): talking to Kite during the call uses the "You" channel; words dictated to
  // Kite are routed away from the transcript in the engine callbacks below (route is stable).
  const { dictation, route: dictationRoute } = useCallDictation({
    available: connection === 'connected',
  });
  // v1.0.2: the transcript's "Answer this" buttons use the answers panel's guarded ask, and show
  // which questions were answered; the panel hands both over once it is mounted.
  const [answerBridge, setAnswerBridge] = useState<AnswerThisBridge | null>(null);
  // v1.0.4: the layouts' full-width band the answers panel renders the call's top bar into.
  const [topBarSlot, setTopBarSlot] = useState<HTMLDivElement | null>(null);
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
  // v1.1.0 (ADR-0044): the last sign of a real call, and what follows from it. A ref so meter ticks
  // can update it without rendering; the once-a-second timer below turns it into a state.
  const lastActivityAt = useRef(0);
  const [hygiene, setHygiene] = useState<HygieneState>('ok');
  // v1.1.0: releases the one-call-at-a-time lock (core/live/callLock.ts).
  const releaseLock = useRef<(() => void) | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  // v1.1.0 (ADR-0044): whether the accurate engine should run now. A ref, because the speech engine's
  // callbacks read it for each line; on Auto it follows the power source during the call.
  const accurateOn = useRef(false);
  // v1.1.0 (ADR-0044): marks and capitals for the live engine's lines, offline, in a worker of its own.
  const [punctuator] = useState(() => createPunctuator());
  useEffect(() => () => punctuator.dispose(), [punctuator]);
  // The saved microphone (v1.1.0). This page only renders in the browser (LiveSession loads the
  // session from IndexedDB first), so reading local storage here cannot differ from a server render.
  const [micDeviceId, setMicDeviceId] = useState(() => getMicDevice());
  const [channelErrors, setChannelErrors] = useState<Partial<Record<Speaker, string>>>({});
  const [themSource, setThemSource] = useState<OtherSideSource | null>(null);
  // The browser split view (live-ui-split): the shared-tab stream for the preview, the answer
  // language the control strip can change, and a transcript "clear" time (lines before it are
  // hidden, later ones still show).
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [language, setLanguage] = useState(session.preferences.language);
  const [transcriptClearedAt, setTranscriptClearedAt] = useState(0);
  // ADR-0053: what Connect did with the overlay, for the answers panel (null before a call).
  const [overlayAtStart, setOverlayAtStart] = useState<OverlayAtStart | null>(null);
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
  // ADR-0055: the background window's status, and why a start failed (a fixed sentence).
  const [launcherState, setLauncherState] = useState<BackgroundCallState>('waiting');
  const [launcherProblem, setLauncherProblem] = useState<string | null>(null);

  /**
   * A call from the Connect card could not start: tells the card and shows it here.
   *
   * @param message What to tell the person (the app's own sentence).
   */
  const failLauncherCall = useCallback(
    (message: string) => {
      setLauncherState('failed');
      setLauncherProblem(message);
      reportCallStart(session.id, 'failed', message);
    },
    [session.id],
  );

  const engineRef = useRef<SttEngine | null>(null);
  const captureRef = useRef<CallCapture | null>(null);
  const saverRef = useRef<TranscriptSaver | null>(null);
  const monitor = useRef(new SttHealthMonitor());
  // Day 6 Stage 4: watches for a stuck engine (audio in, no transcript out) and a flag so a
  // restart cannot overlap with itself. restartedAt drives the "Transcription restarted" note.
  const watchdog = useRef(new TranscriptWatchdog());
  const restartingRef = useRef(false);
  const [restartedAt, setRestartedAt] = useState<number | null>(null);
  // The Connect card's microphone meter (ADR-0053): only while the card is idle, so it never holds
  // the microphone during a call.
  const micPreview = useMicPreview({
    deviceId: micDeviceId,
    // Never in the background window: its card is in the small window, and the meter would hold the
    // microphone for nothing.
    enabled: !launcherCall && view === 'connect' && connection === 'idle' && !ending,
  });

  // Builds the speech engine with the standard callbacks. The initial effect and a watchdog
  // restart share this, so a restarted engine behaves exactly like the first one. isActive() lets
  // a replaced or torn-down engine's late messages be ignored (dev double-mount; restart).
  const makeEngine = useCallback(
    (isActive: () => boolean): SttEngine => {
      // Accurate transcription (v1.0.1, ADR-0034; Auto since v1.1.0, ADR-0044): only in a desktop app
      // that has the engine, and not when it is set to Off. Otherwise no audio leaves the speech
      // worker. Each line then asks whether it should run now, because Auto follows the power source.
      const accurate = getTranscriptionMode() !== 'off' ? getPlatform().accurate : null;
      punctuator.warm();
      return createSttEngine({
        hotwords,
        keepAudio: accurate !== null,
        onProgress: (progress) => {
          if (isActive()) setModel((current) => ({ ...current, progress }));
        },
        onPartial: ({ channel, text, tStart }) => {
          if (!isActive()) return;
          if (channel === 'you' && dictationRoute.partial(text)) {
            // Words for Kite, not the call: clear any grey "You" line and show nothing.
            transcript.addPartial(channel, '', null);
            watchdog.current.noteProgress(performance.now());
            return;
          }
          transcript.addPartial(channel, text, tStart);
          watchdog.current.noteProgress(performance.now());
        },
        onFinal: ({ channel, text, tStart, tEnd, audio }) => {
          if (!isActive()) return;
          if (channel === 'you' && dictationRoute.final(text)) {
            // A question dictated to Kite: never a transcript line, never saved or sent later.
            transcript.addPartial(channel, '', null);
            watchdog.current.noteProgress(performance.now());
            return;
          }
          const line = transcript.addFinal({ speaker: channel, text, tStart, tEnd });
          watchdog.current.noteProgress(performance.now());
          // The second pass replaces the words a moment later; the live line is the fallback. The
          // accurate engine writes its own marks; the live engine's lines get theirs from the
          // punctuation pass, as do lines the accurate engine could not do.
          if (accurate && audio && accurateOn.current) {
            void refineLine(accurate, transcript, line.id, text, audio, plainTerms).then((done) => {
              if (!done) void punctuateLine(punctuator, transcript, line.id, text);
            });
          } else {
            void punctuateLine(punctuator, transcript, line.id, text);
          }
        },
        onStats: (stats) => {
          if (isActive()) monitor.current.push(stats, performance.now());
        },
      });
    },
    [hotwords, transcript, dictationRoute, plainTerms, punctuator],
  );

  // v1.1.0 (ADR-0044): Accurate transcription follows the setting and the power source, and only uses
  // a model that is already on this computer: nothing here ever starts its download.
  useEffect(() => {
    const engine = getPlatform().accurate;
    if (!engine) return;
    let ready = false;
    let onBattery: boolean | null = null;
    const apply = () => {
      accurateOn.current = ready && accurateWanted(getTranscriptionMode(), onBattery);
    };
    let active = true;
    engine
      .status()
      .then((status) => {
        if (!active) return;
        ready = status.state === 'ready';
        apply();
      })
      .catch(() => undefined);
    const stop = getPlatform().watchBattery((next) => {
      onBattery = next;
      apply();
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

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

  // Health, the echo note's clock and the call checks, once a second while connected.
  useEffect(() => {
    if (connection !== 'connected') return;
    const timer = setInterval(() => {
      setHealth(monitor.current.status(performance.now()));
      setNow(Date.now());
      // v1.1.0 (ADR-0044): a call left running. Once paused it stays paused until Resume.
      setHygiene((current) =>
        current === 'paused' ? 'paused' : hygieneState(lastActivityAt.current, Date.now()),
      );
      // Day 6 Stage 4: if speech has been arriving with no transcript for 8 s, restart the engine.
      if (watchdog.current.isStuck(performance.now())) void restartEngine();
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
   * Opens both channels (stopping any earlier capture first). Runs straight from the click.
   * From the Connect card (ADR-0053) it first opens the overlay when calls start in it, while the
   * click still counts (a browser's picture-in-picture window needs it), and once both channels
   * run it shows the live view: Connect starts the call. From the live view (Reconnect) it only
   * reopens the channels.
   *
   * @param fromCard True for the Connect card's Connect and Try again.
   */
  const connect = async (fromCard: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    // The meter's microphone is released first, so the call's capture is the only one using it.
    micPreview.stop();
    // v1.1.0 (ADR-0041): another window may already be running a call (the desktop app's side window
    // can reach this page during one). Two would compete for the microphone and the shortcuts.
    if (!releaseLock.current) {
      const release = await takeCallLock();
      if (!release) {
        setLockedOut(true);
        if (launcherCall) failLauncherCall(LOCKED_OUT_TEXT);
        return;
      }
      releaseLock.current = release;
      setLockedOut(false);
    }
    captureRef.current?.stop();
    captureRef.current = null;
    setChannelErrors({});
    setConnection('connecting');
    // ADR-0053: the overlay first, inside the click. Picture-in-picture uses the click up, and the
    // share picker still opens afterwards (Chrome 156, measured); the other order would leave the
    // overlay without a click once the picker closes. The desktop app opens its overlay window over
    // IPC, which needs no click, so one order serves both.
    let overlay: OverlayAtStart = 'off';
    if (fromCard && startsCallsInOverlay()) {
      overlay = await openOverlay(session.id).then(
        () => 'opened' as const,
        () => 'failed' as const,
      );
    }
    try {
      const chosenMic = getMicDevice();
      setMicDeviceId(chosenMic);
      const capture = await startCallCapture({
        engine,
        ...(chosenMic ? { micDeviceId: chosenMic } : {}),
        onLevels: (next) => {
          setLevels(next);
          if (isSound(next.them)) {
            themSoundAt.current = Date.now();
            lastActivityAt.current = Date.now();
          }
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
      lastActivityAt.current = Date.now();
      setHygiene('ok');
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
      // ADR-0053: Connect starts the call. The answers panel learns what happened to the overlay
      // (the main window steps aside when it opened).
      if (fromCard) {
        setOverlayAtStart(overlay);
        setView('live');
      }
      // ADR-0055: the Connect card in the small window learns that the call runs.
      if (launcherCall) reportCallStart(session.id, 'connected');
    } catch (error) {
      setConnection('idle');
      setLevels({ you: 0, them: 0 });
      releaseLock.current?.();
      releaseLock.current = null;
      // The overlay opened for this call is closed again: there is no call to follow.
      if (overlay === 'opened')
        void getPlatform()
          .closeCompactView()
          .catch(() => undefined);
      if (error instanceof CallCaptureError) {
        setChannelErrors({ [error.channel]: error.message });
      } else if (model.status !== 'error') {
        setChannelErrors({ them: 'Paramount AI could not connect. Try again.' });
      }
      // The capture's messages are the app's own sentences (never call text).
      if (launcherCall) {
        failLauncherCall(
          error instanceof CallCaptureError
            ? error.message
            : 'Paramount AI could not connect. Try again.',
        );
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
    releaseLock.current?.();
    releaseLock.current = null;
    setHygiene('ok');
    setConnection('idle');
    setLevels({ you: 0, them: 0 });
    setOverlayAtStart(null);
    setChannelErrors({});
    setView('connect');
    setCallStartedAt(null);
    setPreviewStream(null);
    setTranscriptClearedAt(0);
    setEnding(false);
    const saving = updateSession(session.id, {
      status: 'ended',
      // v1.1.0: for the session cards.
      ...(startedAt !== null ? { lastCallMs: Date.now() - startedAt } : {}),
    })
      // Spec §6: with Save transcript off, no line stays. Read from storage, not this page's copy:
      // the setting can be changed during the call. Notes and answers are kept.
      .then((saved) => (saved.saveTranscript ? undefined : clearTranscript(session.id)))
      // ADR-0049: with account sync, the call's last lines, answers and status reach the account
      // now, before the window may close (does nothing without account sync).
      .then(() => flushAccountSync())
      .catch(() => undefined);
    // The call's notes (Day 5): written after the call by the server, saved here. Not awaited:
    // End never waits for them.
    let notesDone: Promise<unknown> = Promise.resolve();
    if (startedAt !== null && finalLines.length > 0) {
      setNotesStatus('writing');
      setNotesUnavailable(null);
      notesDone = listAnswers(session.id)
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
    // ADR-0055: a call started from the Connect card: the small window comes back (the shell shows it
    // when the call ends), and this window closes once the call's data and notes are saved.
    if (launcherCall) {
      setLauncherState('ended');
      reportCallStart(session.id, 'ended');
      void Promise.allSettled([saving, notesDone]).then(() => getPlatform().windowControl('close'));
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

  /**
   * Switches the microphone without ending the call (the overlay's device list) and remembers it.
   *
   * @param deviceId The device's id ('' for the system's default).
   */
  const changeMic = useCallback((deviceId: string) => {
    setMicDevice(deviceId);
    setMicDeviceId(deviceId);
    captureRef.current?.changeMic(deviceId).catch((error: unknown) => {
      if (error instanceof CallCaptureError) {
        setChannelErrors((current) => ({ ...current, you: error.message }));
      }
    });
  }, []);

  /** Yes, still in a call: the quiet time starts again (ADR-0044). */
  const stillHere = useCallback(() => {
    lastActivityAt.current = Date.now();
    setHygiene('ok');
  }, []);

  /** Listens again after a pause (ADR-0044). */
  const resumeListening = useCallback(() => {
    lastActivityAt.current = Date.now();
    watchdog.current.start(performance.now());
    setHygiene('ok');
    captureRef.current?.resume().catch(() => undefined);
  }, []);

  /** An answer was asked for: someone is on the call (ADR-0044). */
  const noteActivity = useCallback(() => {
    lastActivityAt.current = Date.now();
  }, []);

  // ADR-0055: the Connect card asks this page to connect: a note read as the page opens, or a message
  // to a page already open (Try again). The call connects once the speech model is ready.
  const [startWanted, setStartWanted] = useState(false);
  useEffect(() => {
    if (!launcherCall) return;
    const stop = watchCallStart(session.id, 'start', () => setStartWanted(true));
    // Read after listening, so a request in between is not lost; a microtask keeps setState out of
    // the effect's own run.
    void Promise.resolve().then(() => {
      if (takeCallStart(session.id)) setStartWanted(true);
    });
    return stop;
  }, [launcherCall, session.id]);
  // The latest connect(), for the effect below (it is a new function on every render).
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  });
  useEffect(() => {
    if (!startWanted || !launcherCall) return;
    if (model.status === 'error') {
      void Promise.resolve().then(() => {
        setStartWanted(false);
        failLauncherCall(model.error ?? 'The speech model could not load. Try again.');
      });
      return;
    }
    if (model.status !== 'ready' || view !== 'connect' || connection !== 'idle' || ending) return;
    void Promise.resolve().then(() => {
      setStartWanted(false);
      setLauncherState('connecting');
      reportCallStart(session.id, 'connecting');
      void connectRef.current(true);
    });
  }, [
    startWanted,
    launcherCall,
    model.status,
    model.error,
    view,
    connection,
    ending,
    session.id,
    failLauncherCall,
  ]);

  // Pausing stops feeding the speech engine, and the watchdog with it, which would otherwise take
  // the silence for a stuck engine. The streams stay open, so Resume asks for nothing again.
  useEffect(() => {
    if (hygiene !== 'paused') return;
    watchdog.current.stop();
    captureRef.current?.pause();
  }, [hygiene]);

  const echoStats = transcript.echoStats();
  const echoNoteVisible = echoStats.lastAt !== null && now - echoStats.lastAt < ECHO_NOTE_MS;
  const clearTranscriptNow = () => setTranscriptClearedAt(Date.now());
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

  if (view === 'connect' && launcherCall) {
    return (
      <BackgroundCallStatus
        state={launcherState}
        problem={launcherProblem}
        progress={model.status === 'loading' ? model.progress : null}
        notes={notesStatus}
      />
    );
  }

  if (view === 'connect') {
    return (
      // The Connect card follows the app's theme (spec S11).
      <div className="min-h-full bg-ui-bg pb-10 text-ui-text">
        {lockedOut && (
          <p
            role="alert"
            className="mx-auto mt-4 max-w-3xl rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
          >
            {LOCKED_OUT_TEXT}
          </p>
        )}
        <ConnectPanel
          call={call}
          hotwordCount={hotwordCount}
          platform={platform}
          model={model}
          connection={connection}
          mic={micPreview.state}
          onTestMic={micPreview.start}
          channelErrors={channelErrors}
          health={health}
          micDeviceId={micDeviceId}
          onMic={changeMic}
          onConnect={() => void connect(true)}
          onRetryModel={retryModel}
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
  const transcriptNode = (
    <TranscriptStrip
      lines={shownLines}
      health={health}
      terms={terms}
      themName={session.contactName}
      youName={accountName}
      startedAt={callStartedAt ?? undefined}
      flush={platform === 'browser'}
      {...(answerBridge
        ? {
            onAnswerThis: (group: TranscriptGroup) =>
              answerBridge.answerThis(groupWords(group), { start: group.tStart, end: group.tEnd }),
            answeredSpans: answerBridge.answeredSpans,
          }
        : {})}
    />
  );
  const answersNode =
    callStartedAt !== null ? (
      <LiveAnswers
        session={liveSession}
        documents={documents}
        lessons={lessons}
        transcript={transcript}
        callStartedAt={callStartedAt}
        {...(overlayAtStart !== null ? { overlayAtStart } : {})}
        audio={{
          you: connection === 'connected' && !channelErrors.you,
          them: connection === 'connected' && !channelErrors.them,
        }}
        ending={ending}
        onEnd={() => void end()}
        dictation={dictation}
        onAnswerThis={setAnswerBridge}
        topBarSlot={topBarSlot}
        slimTopBar={platform === 'browser'}
        levels={levels}
        transcriptClearedAt={transcriptClearedAt}
        onClearTranscript={clearTranscriptNow}
        onLanguage={changeLanguage}
        onMic={changeMic}
        micDeviceId={micDeviceId}
        themSourceLabel={themSource ? THEM_SOURCE_LABEL[themSource] : null}
        hygiene={hygiene}
        onStillHere={stillHere}
        onResume={resumeListening}
        onActivity={noteActivity}
        echoCount={echoStats.count}
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
                  onClick={() => void connect(false)}
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
            continues; Paramount AI keeps trying.
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
        notices={notices}
        preview={{
          stream: previewStream,
          themLabel: themSource ? THEM_SOURCE_LABEL[themSource] : null,
          micOn: connection === 'connected' && !channelErrors.you,
          language,
          onLanguage: changeLanguage,
          onStop: () => void end(),
          onClear: clearTranscriptNow,
          onMinimize: () => void openOverlay(session.id).catch(() => undefined),
          onChangeTab: () => void changeTab(),
        }}
        transcript={transcriptNode}
        answers={answersNode}
        topBarSlot={setTopBarSlot}
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
      topBarSlot={setTopBarSlot}
    />
  );
}
