/**
 * File: packages/shared/src/recording.ts
 * Purpose: Meeting recording (desktop 1.5.0, ADR-0068): the qualities, the disk limits, and the typed
 *          contract between the live page (which records with MediaRecorder) and the desktop shell
 *          (which writes the files into Documents/Paramount AI/Recordings, finalises them and plays
 *          them). Video and audio never leave the computer; only the small synced record
 *          (apps/web/src/core/storage/types.ts StoredRecording) reaches the account.
 * Used by: apps/desktop/src/recordings/*, apps/desktop/src/preload.ts, apps/web/src/platform/desktop.ts,
 *          apps/web/src/core/recording/*, apps/web/src/features/meetings/*
 * Depends on: nothing (types and constants only)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §7.3, §7.4, §8.1
 */

/** What a recording holds: the screen with both sides' sound, or the sound only. */
export type RecordingKind = 'screen' | 'audio';

/** Every recording kind. */
export const RECORDING_KINDS: readonly RecordingKind[] = ['screen', 'audio'];

/**
 * The Connect card's choice (ADR-0068): no recording, the sound only, or the screen and the sound.
 * Off is the default and is never remembered as anything else.
 */
export type RecordChoice = 'off' | RecordingKind;

/** The video quality: 720p at 15 frames a second (the default), or 1080p at 30 ("High"). */
export type RecordingQuality = 'standard' | 'high';

/** The numbers behind a quality. */
export interface RecordingQualitySpec {
  /** Largest width, pixels (the screen is scaled down to fit, never up). */
  width: number;
  /** Largest height, pixels. */
  height: number;
  /** Frames a second at most. */
  frameRate: number;
  /** The video bitrate cap, bits a second (measured files stay well under it, ADR-0068). */
  videoBitsPerSecond: number;
}

/**
 * The two qualities. Measured on the i5-8350U laptop (benchmark-results.md, recording): hardware
 * H.264 720p15 ≈ 265 MB an hour and +0.24 of a core during a call; 1080p30 ≈ 840 MB and +0.53 core.
 */
export const RECORDING_QUALITIES: Readonly<Record<RecordingQuality, RecordingQualitySpec>> = {
  standard: { width: 1280, height: 720, frameRate: 15, videoBitsPerSecond: 1_500_000 },
  high: { width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 4_000_000 },
};

/** The mixed sound in the main file (both sides), bits a second. */
export const RECORDING_AUDIO_BITS = 96_000;

/** The separate stereo file (You left, Them right) for later re-transcription, bits a second. */
export const RECORDING_STEREO_BITS = 64_000;

/**
 * How often MediaRecorder hands over what it encoded, in ms. Each piece is appended to the file at
 * once, so a crash loses at most about this much (measured: killed at 14 s, 13.5 s played).
 */
export const RECORDING_TIMESLICE_MS = 1_000;

/** Free-space rules for the Recordings folder's drive (ADR-0068). */
export const RECORDING_DISK = {
  /** A recording does not start below this. */
  minStartBytes: 2_000_000_000,
  /** Below this the call bar warns that space is running low. */
  lowBytes: 1_000_000_000,
  /** At this the recording stops cleanly, so the file is kept and the computer keeps working. */
  stopBytes: 300_000_000,
} as const;

/** One of a recording's two files: the main file (video or sound) or the stereo sound file. */
export type RecordingTrack = 'main' | 'stereo';

/**
 * The main file's container while it is written: Matroska with hardware H.264 (.mkv), or WebM with
 * VP8 where this computer has no H.264 encoder, or WebM with Opus for a sound-only recording. Both are
 * written piece by piece (crash-safe); MP4 is not (Chromium keeps its data until the end).
 */
export type RecordingContainer = 'mkv' | 'webm';

/** What the page asks the shell to open when a recording starts. */
export interface RecordingOpenRequest {
  /** The recording's id (a UUID): one part of a meeting. */
  id: string;
  /** The session it belongs to (a UUID). */
  sessionId: string;
  /** The meeting (one call) its parts belong to (a UUID). */
  meetingId: string;
  /** Which part of the meeting, from 1: starting again in the same call makes the next part. */
  part: number;
  /** Screen and sound, or sound only. */
  kind: RecordingKind;
  /** When it started (Unix ms). */
  startedAt: number;
  /** The main file's container. */
  container: RecordingContainer;
  /** True to write the stereo sound file too (off when the session does not save its transcript). */
  stereo: boolean;
}

/** Why a recording could not start. */
export type RecordingOpenFailure = 'low-disk' | 'busy' | 'failed';

/** The shell's answer to an open. */
export type RecordingOpenResult =
  | {
      /** The files are open. */
      ok: true;
      /** The main file's name (no folder). */
      fileName: string;
      /** Free bytes on the drive now. */
      freeBytes: number;
    }
  | {
      /** The recording cannot start. */
      ok: false;
      /** Why. */
      reason: RecordingOpenFailure;
      /** Free bytes on the drive, when known. */
      freeBytes?: number;
    };

/** How full the drive is getting, as the call bar shows it. */
export type RecordingDiskState = 'ok' | 'low' | 'stop';

/** The shell's answer to one write. */
export interface RecordingWriteResult {
  /** False when the piece could not be written (the recording then stops). */
  ok: boolean;
  /** How full the drive is ('stop': the page stops the recording now). */
  disk: RecordingDiskState;
  /** Free bytes on the drive (checked every few seconds, not on every piece). */
  freeBytes: number;
}

/**
 * A recording's state on this computer:
 * - recording: being written (or the app stopped during it; the next start finalises it);
 * - complete: stopped and finalised (length known, seekable);
 * - recovered: the app or the computer stopped during it; finalised at the next start;
 * - missing: the file is no longer in the folder.
 */
export type LocalRecordingStatus = 'recording' | 'complete' | 'recovered' | 'missing';

/** One recording as the shell knows it (its index in the app's data folder). */
export interface LocalRecording {
  /** The recording's id. */
  id: string;
  /** Its session. */
  sessionId: string;
  /** Its meeting. */
  meetingId: string;
  /** Its part, from 1. */
  part: number;
  /** Screen and sound, or sound only. */
  kind: RecordingKind;
  /** When it started (Unix ms). */
  startedAt: number;
  /** Its length, ms (0 until it is finalised). */
  durationMs: number;
  /** The main file's size, bytes. */
  bytes: number;
  /** The main file's name (no folder). */
  fileName: string;
  /** True when a stereo sound file was written. */
  hasStereo: boolean;
  /** Its state. */
  status: LocalRecordingStatus;
}

/** The shell's answer when a recording is stopped and finalised. */
export interface RecordingCloseResult {
  /** False when the recording was not open (already closed, or unknown). */
  ok: boolean;
  /** The recording as it now is, or null when unknown. */
  recording: LocalRecording | null;
}

/** One display a screen recording can be made of. */
export interface RecordingDisplay {
  /** Electron's display id, as a string. */
  id: string;
  /** "Display 1 (1920 × 1080, main)". */
  label: string;
  /** True for the main display. */
  primary: boolean;
}

/** This computer as the account's recordings name it ("Saved on <name>"). */
export interface DeviceIdentity {
  /** A random id made once per installation (a UUID). */
  id: string;
  /** Its name: the computer's name until the person renames it. */
  name: string;
}

/** The longest device name kept, characters. */
export const DEVICE_NAME_MAX = 60;

/** What the player's Save as… did. */
export type RecordingSaveResult = 'saved' | 'cancelled' | 'missing';

/**
 * The private scheme the shell serves recordings on (to the player page only): the main file at
 * `kite-recording://file/<id>`, with byte ranges so the video can seek.
 */
export const RECORDING_SCHEME = 'kite-recording';

/**
 * The address the player page plays a recording from.
 * @param recordingId The recording's id.
 * @returns The address.
 * Called from: apps/web/src/features/meetings/RecordingPlayer.tsx; tests
 */
export function recordingFileUrl(recordingId: string): string {
  return `${RECORDING_SCHEME}://file/${recordingId}`;
}

/**
 * The main file's name for a recording: "Paramount AI 2026-11-10 14-30-05.mkv", with " part 2" for
 * later parts. No call details go into a file name (anyone using the computer can see the folder).
 * @param startedAt When it started (Unix ms), shown in local time.
 * @param part      The part, from 1.
 * @param container The container.
 * @returns The name.
 * Called from: apps/desktop/src/recordings/files.ts; tests
 */
export function recordingFileName(
  startedAt: number,
  part: number,
  container: RecordingContainer,
): string {
  const d = new Date(startedAt);
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  return `Paramount AI ${stamp}${part > 1 ? ` part ${part}` : ''}.${container}`;
}

/**
 * The stereo sound file's name next to a main file: "<main name without extension>.stereo.webm".
 * @param mainFileName The main file's name.
 * @returns The name.
 * Called from: apps/desktop/src/recordings/files.ts; tests
 */
export function stereoFileName(mainFileName: string): string {
  return `${mainFileName.replace(/\.[a-z0-9]+$/i, '')}.stereo.webm`;
}
