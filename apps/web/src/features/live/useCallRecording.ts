/**
 * File: apps/web/src/features/live/useCallRecording.ts
 * Purpose: The meeting recording of one call (desktop 1.5.0, ADR-0068), for the live page: start (after
 *          the person said everyone agreed), stop, and a new part each time it starts again in the same
 *          call. It keeps the account's small record of each part up to date (when, how long, how big,
 *          which computer), turns Private on when a screen recording starts (so Paramount AI's windows
 *          stay out of the video; the person can turn it off), says when the drive is getting full, and
 *          stops by itself when it is full. The streams it records are the call's own ("You" and "Them").
 *          Batch C (P1-6; investigation H): a recording never costs the call its speech. Without a hardware
 *          video encoder a screen recording becomes a sound-only one (never software video); while the
 *          computer is under CPU pressure, or speech is being transcribed on it and needs the room, the
 *          screen's frame rate drops to 5 a second, and comes back after 30 s of calm (frameYield.ts); the
 *          sound is never touched. The timing trace gets the format, the yields, and the frames delivered and
 *          dropped every 10 s.
 * Used by: src/features/live/LivePage.tsx
 * Depends on: src/core/recording/recorder.ts, src/core/storage/recordings.ts,
 *             src/core/storage/recordingPrefs.ts, src/features/privacy/usePrivate.ts, src/platform
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
'use client';

import type { RecordingDisplay, RecordingKind } from '@kite/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RecordingStartError,
  START_FAILURE_TEXT,
  startRecording,
  type ActiveRecording,
  type RecordingStopReason,
} from '@/core/recording/recorder';
import {
  getRecordingKind,
  getRecordingQuality,
  setRecordingKind,
} from '@/core/storage/recordingPrefs';
import { saveRecording, updateRecording } from '@/core/storage/recordings';
import type { CompactRecording } from '@/core/live/liveChannel';
import { turnPrivateOnForRecording } from '@/features/privacy/usePrivate';
import { callTimings } from '@/core/live/callTimings';
import { FrameRateGovernor, type PressureState } from '@/core/recording/frameYield';
import { watchCpuPressure } from '@/core/recording/pressure';

/** Batch C (P1-6): how often the yield rule is checked while a screen recording runs, ms. */
export const YIELD_CHECK_MS = 1_000;

/** Batch C (P1-6): how often the frames delivered and dropped go into the timing trace, ms. */
export const FRAME_SAMPLE_MS = 10_000;
import { getPlatform } from '@/platform';

/** The notice when Private was turned on for a screen recording. */
export const PRIVATE_ON_NOTICE =
  "Private is on, so Paramount AI's windows stay out of the recording. You can turn it off in ⋮.";

/** The notice when the drive is getting full. */
export const LOW_DISK_NOTICE =
  'Space is running low. The recording stops by itself when less than 300 MB is left.';

/** What each automatic stop says. */
export const STOP_NOTICES: Readonly<Record<RecordingStopReason, string>> = {
  'disk-full': 'Recording stopped: the drive is almost full. What was recorded is saved.',
  'write-failed': 'Recording stopped: the file could not be written. What was recorded is saved.',
  'screen-ended':
    'Recording stopped: the screen is no longer available. What was recorded is saved.',
};

/** What the hook needs from the live page. */
export interface CallRecordingOptions {
  /** The session. */
  sessionId: string;
  /** True when the session saves its transcript (the stereo file is kept only then). */
  saveTranscript: boolean;
  /** True while the call is connected. */
  connected: boolean;
  /** The call's streams now ("You", "Them"), or null when it is not connected. */
  streams: () => { you: MediaStream; them: MediaStream } | null;
  /**
   * ADR-0077: the call's record id: the recording's meeting is the call (its parts carry it as meetingId).
   * Read when a part starts (a function, so a recording started in the same moment as Connect gets it);
   * without one, a random meeting id is made as before.
   */
  callId?: () => string | null;
  /**
   * ADR-0077: called when a part starts recording, with its type (the call record says what was recorded).
   * @param kind 'screen' or 'audio'.
   */
  onPartStarted?: (kind: RecordingKind) => void;
  /**
   * Batch C (P1-6): whether the call's speech is being transcribed on this computer and needs the room
   * now (a cloud call's channel on the on-device fallback, or the on-device engine falling behind). The
   * screen's frame rate gives way while it is true.
   */
  underLoad?: () => boolean;
}

/** What the hook gives the live page. */
export interface CallRecording {
  /** True when this app can record (desktop 1.5.0). */
  available: boolean;
  /** What the call bars show, or undefined where recording is not available. */
  compact: CompactRecording | undefined;
  /**
   * Starts recording (consent was given in the question that called this).
   * @param choice The type (default: the ⋮ menu's) and display (default: the picked one).
   * @returns When it is recording (or failed, with a notice).
   */
  start: (choice?: { kind?: RecordingKind; displayId?: string | null }) => Promise<void>;
  /**
   * Stops recording and finalises the files.
   * @returns When done.
   */
  stop: () => Promise<void>;
  /**
   * Sets the type later recordings in this call use (remembered on this device).
   * @param kind The type.
   */
  setKind: (kind: RecordingKind) => void;
  /** Ctrl+Alt+R: the bars ask "Start?" or "Stop?". */
  prompt: () => void;
  /** Closes the notice. */
  clearNotice: () => void;
  /**
   * The call's microphone or other side changed: the recording's mix follows.
   * @param channel Which side.
   * @param stream  The new stream.
   */
  replaceSource: (channel: 'you' | 'them', stream: MediaStream) => void;
  /**
   * End: stops any recording (and waits for its files).
   * @returns True when this call recorded anything.
   */
  finish: () => Promise<boolean>;
}

/**
 * The recording of one call.
 * @param options See CallRecordingOptions.
 * @returns See CallRecording.
 * Called from: LivePage.tsx
 */
export function useCallRecording(options: CallRecordingOptions): CallRecording {
  const host = getPlatform().recording;
  const [state, setState] = useState<CompactRecording['state']>('off');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [kind, setKindState] = useState<RecordingKind>(() => getRecordingKind());
  const [displays, setDisplays] = useState<RecordingDisplay[]>([]);
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [promptCount, setPromptCount] = useState(0);
  const [parts, setParts] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef<ActiveRecording | null>(null);
  const busy = useRef(false);
  // One meeting per call: its parts share this id.
  const meetingId = useRef<string | null>(null);
  const partCount = useRef(0);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // The displays, read once per call (a picker shows when there are several).
  useEffect(() => {
    if (!host || !options.connected) return;
    let live = true;
    host
      .displays()
      .then((list) => {
        if (live) setDisplays(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [host, options.connected]);

  /** Stops the running part, if any, and brings its record up to date. */
  const stopPart = useCallback(async () => {
    const running = active.current;
    if (!running) return;
    active.current = null;
    setState('stopping');
    const local = await running.stop().catch(() => null);
    await updateRecording(running.id, {
      status: local?.status === 'recovered' ? 'recovered' : 'complete',
      durationMs: local?.durationMs || Date.now() - running.startedAt,
      bytes: local?.bytes ?? 0,
      ...(local ? { fileName: local.fileName } : {}),
    }).catch(() => undefined);
    setState('off');
    setStartedAt(null);
  }, []);

  const start = useCallback(
    // Named, so the sound-only fallback below can start again with the same settings.
    async function startPart(choice?: {
      kind?: RecordingKind;
      displayId?: string | null;
    }): Promise<void> {
      const streams = optionsRef.current.streams();
      if (!host || !streams || active.current || busy.current) return;
      busy.current = true;
      // Batch C (P1-6): set when this computer cannot record screen video without slowing the call.
      let soundOnly = false;
      const partKind = choice?.kind ?? kind;
      const partDisplay = choice?.displayId !== undefined ? choice.displayId : displayId;
      setState('starting');
      setNotice(null);
      try {
        const device = await host.device();
        meetingId.current ??= optionsRef.current.callId?.() ?? crypto.randomUUID();
        const part = partCount.current + 1;
        const id = crypto.randomUUID();
        const quality = getRecordingQuality();
        const stereo = optionsRef.current.saveTranscript;
        const recording = await startRecording(
          host,
          {
            id,
            sessionId: optionsRef.current.sessionId,
            meetingId: meetingId.current,
            part,
            kind: partKind,
            quality,
            displayId: partKind === 'screen' ? partDisplay : null,
            stereo,
            you: streams.you,
            them: streams.them,
          },
          {
            onDisk: (disk) => setNotice(disk === 'low' ? LOW_DISK_NOTICE : null),
            onStopped: (reason) => {
              setNotice(STOP_NOTICES[reason]);
              void stopPart();
            },
          },
        );
        active.current = recording;
        partCount.current = part;
        setParts(part);
        setStartedAt(recording.startedAt);
        setState('on');
        // The account's record, from the first second: the Meetings page shows it as recording.
        await saveRecording({
          id,
          sessionId: optionsRef.current.sessionId,
          meetingId: meetingId.current,
          part,
          kind: partKind,
          ...(recording.quality ? { quality: recording.quality } : {}),
          startedAt: recording.startedAt,
          durationMs: 0,
          bytes: 0,
          fileName: recording.fileName,
          hasStereo: stereo,
          deviceId: device.id,
          deviceName: device.name,
          status: 'recording',
          updatedAt: Date.now(),
        }).catch(() => undefined);
        console.info('recording: started', { id, part, kind: partKind });
        // Batch C (P1-6): the format chosen (a type name and numbers only).
        callTimings.noteTrace('rec-format', {
          kind: partKind,
          mime: recording.mimeType,
          fps: recording.frameRate,
        });
        optionsRef.current.onPartStarted?.(partKind);
        // Decision 10 Nov 2026: Private comes on with a screen recording, with a short notice.
        if (partKind === 'screen' && (await turnPrivateOnForRecording())) {
          setNotice(PRIVATE_ON_NOTICE);
        }
      } catch (error) {
        setState('off');
        if (error instanceof RecordingStartError && error.reason === 'no-hardware-video') {
          soundOnly = true;
        } else {
          setNotice(
            error instanceof RecordingStartError
              ? error.message
              : 'The recording could not start. Try again.',
          );
        }
      } finally {
        busy.current = false;
      }
      if (soundOnly) {
        // Batch C (P1-6): sound only instead (everyone agreed to the recording; it just has no video), and
        // later recordings on this computer start as sound only too. The notice says why.
        setKindState('audio');
        setRecordingKind('audio');
        callTimings.noteTrace('rec-format', {
          kind: 'screen',
          mime: 'none',
          reason: 'no-hardware',
        });
        await startPart({ kind: 'audio', displayId: null });
        setNotice(START_FAILURE_TEXT['no-hardware-video']);
      }
    },
    [host, kind, displayId, stopPart],
  );

  // Batch C (P1-6): while a screen recording runs, its frame rate gives way under load, and the trace gets
  // its frames every 10 s. The sound is never touched.
  useEffect(() => {
    const running = active.current;
    if (state !== 'on' || !running || running.frameRate === null) return;
    const full = running.frameRate;
    const governor = new FrameRateGovernor(full);
    let pressure: PressureState | null = null;
    const stopPressure = watchCpuPressure((next) => {
      pressure = next;
    });
    let cap = full;
    const check = setInterval(() => {
      const change = governor.update(
        { pressure, localLoad: optionsRef.current.underLoad?.() ?? false },
        Date.now(),
      );
      if (!change) return;
      cap = change.fps;
      void running.capFrameRate(change.fps);
      callTimings.noteTrace('rec-yield', { fps: change.fps, reason: change.reason, pressure });
    }, YIELD_CHECK_MS);
    let last = running.frameStats();
    let lastAt = Date.now();
    const sample = setInterval(() => {
      const now = Date.now();
      const stats = running.frameStats();
      if (stats && last && now > lastAt) {
        const delivered = stats.delivered - last.delivered;
        callTimings.noteTrace('rec-frames', {
          delivered,
          discarded: stats.discarded - last.discarded,
          fps: Math.round((delivered * 10_000) / (now - lastAt)) / 10,
          cap,
        });
      }
      last = stats;
      lastAt = now;
    }, FRAME_SAMPLE_MS);
    return () => {
      clearInterval(check);
      clearInterval(sample);
      stopPressure();
    };
  }, [state, parts]);

  const setKind = useCallback((next: RecordingKind) => {
    setKindState(next);
    setRecordingKind(next);
  }, []);

  const replaceSource = useCallback((channel: 'you' | 'them', stream: MediaStream) => {
    active.current?.replaceSource(channel, stream);
  }, []);

  const finish = useCallback(async () => {
    await stopPart();
    const recorded = partCount.current > 0;
    // The next call starts a new meeting.
    meetingId.current = null;
    partCount.current = 0;
    setParts(0);
    setNotice(null);
    return recorded;
  }, [stopPart]);

  const compact = useMemo<CompactRecording | undefined>(
    () =>
      host
        ? {
            state,
            startedAt,
            kind,
            displays,
            displayId,
            stereo: options.saveTranscript,
            promptCount,
            parts,
            notice,
          }
        : undefined,
    [
      host,
      state,
      startedAt,
      kind,
      displays,
      displayId,
      options.saveTranscript,
      promptCount,
      parts,
      notice,
    ],
  );

  return {
    available: host !== null,
    compact,
    start: async (choice) => {
      if (choice?.displayId !== undefined) setDisplayId(choice.displayId);
      await start(choice);
    },
    stop: stopPart,
    setKind,
    prompt: () => setPromptCount((count) => count + 1),
    clearNotice: () => setNotice(null),
    replaceSource,
    finish,
  };
}
