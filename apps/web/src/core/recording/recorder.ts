/**
 * File: apps/web/src/core/recording/recorder.ts
 * Purpose: Records one part of a meeting (desktop 1.5.0, ADR-0068). For a screen recording it opens the
 *          screen's video (the platform's recording host), mixes the call's two sides ("You" and "Them",
 *          the same streams the transcript uses) into the main file's sound with Web Audio, and, when
 *          the session saves its transcript, also builds a stereo track (You left, Them right) for
 *          later re-transcription. Two MediaRecorders hand over encoded pieces every second; each is
 *          sent to the desktop shell in order, which appends it to the file at once, so a crash keeps
 *          what was recorded. The shell's answers say how full the drive is; at the limit the recording
 *          stops by itself. Nothing is sent anywhere but the shell.
 * Used by: src/features/live/useCallRecording.ts
 * Depends on: src/platform (RecordingHost), src/core/recording/format.ts, @kite/shared, Web Audio,
 *             MediaRecorder (injectable)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §6.1 (audio stays on the
 *               computer)
 * The main sound is a mix only in the file: the transcript still gets "You" and "Them" separately.
 */
import {
  RECORDING_AUDIO_BITS,
  RECORDING_STEREO_BITS,
  RECORDING_TIMESLICE_MS,
  type LocalRecording,
  type RecordingDiskState,
  type RecordingKind,
  type RecordingOpenFailure,
  type RecordingQuality,
  type RecordingTrack,
} from '@kite/shared';
import type { RecordingHost } from '@/platform';
import { chooseFormat, hasHardwareH264, STEREO_MIME, type FormatDeps } from './format';

/** Why a recording stopped by itself. */
export type RecordingStopReason = 'disk-full' | 'write-failed' | 'screen-ended';

/** Why a recording could not start. */
export type RecordingStartFailure = RecordingOpenFailure | 'no-format' | 'no-screen';

/** A start that failed, with a sentence for the person. */
export class RecordingStartError extends Error {
  /** Why. */
  readonly reason: RecordingStartFailure;

  /**
   * @param reason  Why.
   * @param message What to tell the person (the app's own words).
   */
  constructor(reason: RecordingStartFailure, message: string) {
    super(message);
    this.name = 'RecordingStartError';
    this.reason = reason;
  }
}

/** What a recording needs. */
export interface RecordingStart {
  /** The part's id (a UUID). */
  id: string;
  /** The session. */
  sessionId: string;
  /** The meeting (this call). */
  meetingId: string;
  /** Which part of the meeting, from 1. */
  part: number;
  /** Screen and sound, or sound only. */
  kind: RecordingKind;
  /** The quality the person chose. */
  quality: RecordingQuality;
  /** The display to record (screen only), or null for the main one. */
  displayId: string | null;
  /** True to write the stereo file (the session saves its transcript). */
  stereo: boolean;
  /** The microphone ("You"). */
  you: MediaStream;
  /** The other side ("Them"; its audio tracks only are used). */
  them: MediaStream;
}

/** Things that happen to a running recording. */
export interface RecordingEvents {
  /** The drive is getting full ('low'), or is fine again ('ok'). */
  onDisk?: (state: Exclude<RecordingDiskState, 'stop'>) => void;
  /** It stopped by itself (the drive is full, a write failed, the screen capture ended). */
  onStopped?: (reason: RecordingStopReason) => void;
}

/** A running recording. */
export interface ActiveRecording {
  /** The part's id. */
  readonly id: string;
  /** When it started (Unix ms). */
  readonly startedAt: number;
  /** The main file's name. */
  readonly fileName: string;
  /** The quality used (null for sound only). */
  readonly quality: RecordingQuality | null;
  /**
   * Feeds a new microphone or other-side stream into the mix (the call changed device or share).
   * @param channel Which side.
   * @param stream  The new stream.
   */
  replaceSource(channel: 'you' | 'them', stream: MediaStream): void;
  /**
   * Stops recording, sends the last pieces and has the shell finalise the files.
   * @returns The recording as the shell now has it, or null when it was unknown to the shell.
   */
  stop(): Promise<LocalRecording | null>;
}

/** Browser objects the recorder creates (tests pass fakes). */
export interface RecorderDeps extends FormatDeps {
  /** Creates the AudioContext the mix runs in (never played to the speakers). */
  createAudioContext: () => AudioContext;
  /** Creates a MediaRecorder. */
  createMediaRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  /** Joins tracks into a stream. */
  createStream: (tracks: MediaStreamTrack[]) => MediaStream;
  /** The clock, Unix ms. */
  now: () => number;
}

/**
 * The browser's own objects.
 * @returns Default dependencies.
 * Called from: startRecording() (default argument)
 */
export function defaultRecorderDeps(): RecorderDeps {
  return {
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    hardwareH264: hasHardwareH264,
    createAudioContext: () => new AudioContext({ sampleRate: 48_000 }),
    createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
    createStream: (tracks) => new MediaStream(tracks),
    now: () => Date.now(),
  };
}

/** The sentence for each start failure. */
export const START_FAILURE_TEXT: Readonly<Record<RecordingStartFailure, string>> = {
  'low-disk':
    'Not enough free space to record (about 2 GB is needed). Free some space, then try again.',
  busy: 'This recording is already running.',
  failed: 'Paramount AI could not create the recording files. Try again.',
  'no-format': 'This computer cannot record video here.',
  'no-screen': 'Paramount AI could not capture the screen to record it. Try again.',
};

/**
 * Starts recording.
 *
 * @param host   The desktop app's recording host.
 * @param start  What to record.
 * @param events What the caller hears about while it runs.
 * @param deps   Browser objects (tests only).
 * @returns The running recording.
 * @throws RecordingStartError when it cannot start (anything opened is released first).
 * Called from: useCallRecording.ts
 */
export async function startRecording(
  host: RecordingHost,
  start: RecordingStart,
  events: RecordingEvents = {},
  deps: RecorderDeps = defaultRecorderDeps(),
): Promise<ActiveRecording> {
  const format = await chooseFormat(start.kind, start.quality, deps);
  if (!format) throw new RecordingStartError('no-format', START_FAILURE_TEXT['no-format']);

  // 1. The screen's video (screen recordings only).
  let screen: MediaStream | null = null;
  if (format.spec) {
    try {
      screen = await host.openScreen(format.spec, start.displayId);
    } catch {
      throw new RecordingStartError('no-screen', START_FAILURE_TEXT['no-screen']);
    }
  }
  const stopScreen = () => {
    for (const track of screen?.getTracks() ?? []) track.stop();
  };

  // 2. The files.
  const startedAt = deps.now();
  const opened = await host
    .open({
      id: start.id,
      sessionId: start.sessionId,
      meetingId: start.meetingId,
      part: start.part,
      kind: start.kind,
      startedAt,
      container: format.container,
      stereo: start.stereo,
    })
    .catch(() => ({ ok: false as const, reason: 'failed' as const }));
  if (!opened.ok) {
    stopScreen();
    throw new RecordingStartError(opened.reason, START_FAILURE_TEXT[opened.reason]);
  }

  // 3. The sound: both sides mixed for the main file, and You left / Them right for the stereo file.
  const context = deps.createAudioContext();
  const mix = context.createMediaStreamDestination();
  const merger = start.stereo ? context.createChannelMerger(2) : null;
  const stereoOut = merger ? context.createMediaStreamDestination() : null;
  if (merger && stereoOut) merger.connect(stereoOut);
  const sources: Partial<Record<'you' | 'them', MediaStreamAudioSourceNode>> = {};
  /**
   * Connects one side's stream to the mix (and its stereo channel), replacing any earlier one.
   * @param channel Which side.
   * @param stream  Its stream (a stream without sound is left out).
   */
  const connect = (channel: 'you' | 'them', stream: MediaStream) => {
    sources[channel]?.disconnect();
    delete sources[channel];
    const audio = stream.getAudioTracks();
    if (audio.length === 0) return;
    const source = context.createMediaStreamSource(deps.createStream(audio));
    source.connect(mix);
    if (merger) source.connect(merger, 0, channel === 'you' ? 0 : 1);
    sources[channel] = source;
  };
  connect('you', start.you);
  connect('them', start.them);
  // A context made while the window is in the background can start suspended (capture.ts).
  if (context.state === 'suspended') void context.resume().catch(() => undefined);

  // 4. The recorders: pieces every second, each sent in order.
  const mixTrack = mix.stream.getAudioTracks()[0];
  const mainTracks = [...(screen?.getVideoTracks() ?? []), ...(mixTrack ? [mixTrack] : [])];
  const main = deps.createMediaRecorder(deps.createStream(mainTracks), {
    mimeType: format.mimeType,
    audioBitsPerSecond: RECORDING_AUDIO_BITS,
    ...(format.spec ? { videoBitsPerSecond: format.spec.videoBitsPerSecond } : {}),
  });
  const stereo = stereoOut
    ? deps.createMediaRecorder(stereoOut.stream, {
        mimeType: STEREO_MIME,
        audioBitsPerSecond: RECORDING_STEREO_BITS,
      })
    : null;

  let stopping = false;
  let stoppedBy: RecordingStopReason | null = null;
  let disk: RecordingDiskState = 'ok';
  let writes: Promise<unknown> = Promise.resolve();
  /**
   * Stops by itself (once), telling the caller why.
   * @param reason Why.
   */
  const autoStop = (reason: RecordingStopReason) => {
    if (stopping || stoppedBy) return;
    stoppedBy = reason;
    events.onStopped?.(reason);
  };
  /**
   * Sends one piece after the ones before it.
   * @param track Which file.
   * @param blob  The piece.
   */
  const send = (track: RecordingTrack, blob: Blob) => {
    if (blob.size === 0) return;
    writes = writes.then(async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const result = await host
        .write(start.id, track, bytes)
        .catch(() => ({ ok: false, disk, freeBytes: 0 }));
      if (!result.ok) {
        autoStop('write-failed');
        return;
      }
      if (result.disk === 'stop') {
        autoStop('disk-full');
      } else if (result.disk !== disk) {
        events.onDisk?.(result.disk);
      }
      disk = result.disk;
    });
  };
  main.ondataavailable = (event) => send('main', event.data);
  if (stereo) stereo.ondataavailable = (event) => send('stereo', event.data);
  // The screen capture can end without us (for example the display was unplugged).
  screen?.getVideoTracks()[0]?.addEventListener('ended', () => autoStop('screen-ended'));
  main.start(RECORDING_TIMESLICE_MS);
  stereo?.start(RECORDING_TIMESLICE_MS);

  /**
   * Stops one MediaRecorder and waits for its last piece.
   * @param recorder The recorder.
   * @returns When it has stopped.
   */
  const stopRecorder = (recorder: MediaRecorder) =>
    new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve();
        return;
      }
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });

  return {
    id: start.id,
    startedAt,
    fileName: opened.fileName,
    quality: format.quality,
    replaceSource: connect,
    async stop() {
      if (stopping) return null;
      stopping = true;
      await Promise.all([stopRecorder(main), ...(stereo ? [stopRecorder(stereo)] : [])]);
      // The last pieces arrive with the stop event; they are queued behind the earlier ones.
      await writes;
      stopScreen();
      for (const source of Object.values(sources)) source?.disconnect();
      void context.close().catch(() => undefined);
      const closed = await host.close(start.id).catch(() => ({ ok: false, recording: null }));
      return closed.recording;
    },
  };
}
